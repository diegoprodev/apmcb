import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-41 (docs/auditoria/EVIDENCE_R41.md): scopedReserveIds descartava o erro da
// consulta de `reserves` e devolvia [] — "não foi possível determinar o escopo"
// virava "escopo vazio", e os handlers respondiam 200 com lista vazia. Agora a
// falha é um erro explícito (ReserveScopeLookupError): o GET /api/handovers
// responde 500 genérico com log e NÃO consulta service_handovers; vazio legítimo
// (consulta ok, sem reservas) continua sendo sucesso vazio.

const { handoversRoutes } = await import("../../routes/handovers.ts");
const { lendingRoutes } = await import("../../routes/lendings.ts");
const { scopedReserveIds, ReserveScopeLookupError } = await import("../../lib/reserve-scope.ts");

const T_A = "71a00000-0000-0000-0000-00000000000a";
const T_B = "71b00000-0000-0000-0000-00000000000b";
const T_EMPTY = "71e00000-0000-0000-0000-00000000000e";
const R_A1 = "71a10000-0000-0000-0000-0000000000a1";
const R_A2 = "71a20000-0000-0000-0000-0000000000a2";
const R_B1 = "71b10000-0000-0000-0000-0000000000b1";
const USER = "71000000-0000-0000-0000-0000000000a0";

const H = (id: string, tenant: string, reserve: string): Row =>
  ({ id, tenant_id: tenant, reserve_id: reserve, status: "concluida", created_at: "2026-09-30T00:00:00Z", saindo_id: USER, entrando_id: null });
const tables = {
  reserves: {
    columns: ["id", "nome", "acronym", "tenant_id"],
    rows: [
      { id: R_A1, nome: "A1", acronym: "A1", tenant_id: T_A },
      { id: R_A2, nome: "A2", acronym: "A2", tenant_id: T_A },
      { id: R_B1, nome: "B1", acronym: "B1", tenant_id: T_B },
    ],
  },
  // B1 e a de "mesma reserve_id em outro tenant" vêm primeiro e ocupariam o limit se o filtro fosse depois.
  service_handovers: {
    columns: ["id", "tenant_id", "reserve_id", "status", "created_at", "saindo_id", "entrando_id"],
    rows: [H("b1-1", T_B, R_B1), H("a1-tenant-b", T_B, R_A1), H("a1-1", T_A, R_A1), H("a2-1", T_A, R_A2)],
  },
  profiles: { columns: ["id"], rows: [] },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
let queried: string[] = [];
let failReserves: { code?: string; message: string } | null = null;
before(() => {
  const fake = createFakePostgrest(tables);
  supabase.from = ((t: string) => {
    queried.push(t);
    if (t === "reserves" && failReserves) {
      const failing: unknown = new Proxy({}, {
        get: (_t, k) => k === "then"
          ? (res: (v: unknown) => void) => res({ data: null, error: failReserves })
          : () => failing,
      });
      return failing;
    }
    return fake.from(t);
  }) as unknown as typeof supabase.from;
});
after(() => { supabase.from = ORIGINAL_FROM; });
beforeEach(() => { queried = []; failReserves = null; });

type Ctx = { userId: string; role: string; tenantId: string | null; reserveId: string | null };
function appFor(ctx: Ctx) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    c.set("userId", ctx.userId);
    c.set("role", ctx.role as HonoVariables["role"]);
    c.set("tenantId", ctx.tenantId);
    c.set("reserveId", ctx.reserveId);
    await next();
  });
  app.route("/api/handovers", handoversRoutes);
  return app;
}
async function list(ctx: Ctx, query = "") {
  const r = await appFor(ctx).request(`/api/handovers${query}`);
  const text = await r.text();
  return { status: r.status, text, body: r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null };
}
const MATRIZ_A: Ctx = { userId: USER, role: "admin_global", tenantId: T_A, reserveId: null };
const FILIAL_A1: Ctx = { userId: USER, role: "admin_reserva", tenantId: T_A, reserveId: R_A1 };

describe("R-41 — scopedReserveIds: vazio legítimo ≠ falha", () => {
  it("consulta ok com reservas: devolve as do tenant (matriz)", async () => {
    assert.deepEqual((await scopedReserveIds("admin_global", null, T_A)).sort(), [R_A1, R_A2]);
  });

  it("consulta ok sem reservas: sucesso vazio (não é erro)", async () => {
    assert.deepEqual(await scopedReserveIds("admin_global", null, T_EMPTY), []);
  });

  it("filial e não-matriz: só a reserva da sessão, sem consultar o banco", async () => {
    assert.deepEqual(await scopedReserveIds("admin_reserva", R_A1, T_A), [R_A1]);
    assert.deepEqual(await scopedReserveIds("armeiro", null, T_A), []);
    assert.deepEqual(queried, []);
  });

  it("erro de query: lança ReserveScopeLookupError (nunca [])", async () => {
    failReserves = { code: "57014", message: "canceling statement: secret_table timeout" };
    await assert.rejects(() => scopedReserveIds("admin_global", null, T_A), (e: unknown) => {
      assert.ok(e instanceof ReserveScopeLookupError);
      assert.ok(!(e as Error).message.includes("secret_table"), "mensagem do erro não carrega o texto cru do banco");
      return true;
    });
  });
});

describe("R-41 — GET /api/handovers: falha do escopo é erro explícito e não consulta os dados", () => {
  it("R41_BEFORE_DB_ERROR. matriz, erro na consulta de reserves: 500 genérico (antes: 200 com lista vazia)", async () => {
    failReserves = { code: "57014", message: "canceling statement: secret_table timeout" };
    const r = await list(MATRIZ_A);
    assert.equal(r.status, 500, r.text);
    assert.ok(!r.text.includes("secret_table") && !r.text.includes("canceling"));
    assert.deepEqual(r.body, { error: "Erro ao buscar passagens" });
  });

  it("F. falha de escopo: service_handovers NÃO é consultada", async () => {
    failReserves = { message: "boom" };
    await list(MATRIZ_A);
    assert.ok(queried.includes("reserves"));
    assert.ok(!queried.includes("service_handovers"), `consultou: ${queried.join(",")}`);
  });

  it("B. matriz de tenant sem reservas (consulta ok): 200 []", async () => {
    const r = await list({ ...MATRIZ_A, tenantId: T_EMPTY });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { handovers: [] });
  });

  it("A/matriz. consulta ok: só as reservas do tenant da sessão (nem B1, nem a de mesma reserve_id em outro tenant)", async () => {
    const r = await list(MATRIZ_A);
    assert.equal(r.status, 200);
    assert.deepEqual((r.body.handovers as Array<{ id: string }>).map((h) => h.id).sort(), ["a1-1", "a2-1"]);
  });

  it("filial (admin_reserva A1): só A1 do tenant A; não depende da consulta de reserves", async () => {
    failReserves = { message: "boom" }; // não deve importar: filial não consulta reserves
    const r = await list(FILIAL_A1);
    assert.equal(r.status, 200);
    assert.deepEqual((r.body.handovers as Array<{ id: string }>).map((h) => h.id), ["a1-1"]);
  });

  it("usuario (Modo Usuário/usuário comum): 403, sem consulta de escopo nem de dados", async () => {
    const r = await list({ ...MATRIZ_A, role: "usuario" });
    assert.equal(r.status, 403);
    assert.deepEqual(queried, []);
  });

  it("outro caller (GET /api/lendings, lote 3) não vira 200 vazio: sem tratamento próprio, o erro sobe (500) e lendings não é consultada", async () => {
    failReserves = { message: "boom" };
    const app = appFor(MATRIZ_A);
    app.route("/api/lendings", lendingRoutes);
    const r = await app.request("/api/lendings");
    assert.equal(r.status, 500);
    assert.ok(!queried.includes("lendings"));
  });

  it("guarda estática: a falha usa logFailure e trata ReserveScopeLookupError", () => {
    const src = readFileSync(new URL("../../routes/handovers.ts", import.meta.url), "utf8");
    assert.ok(src.includes("ReserveScopeLookupError"));
    assert.ok(src.includes('"handovers.list.scope_failure"'));
  });
});
