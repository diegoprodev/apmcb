import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-37 lote 4 (docs/auditoria/EVIDENCE_R37_BATCH4.md): /reserva/passagens lista
// em GET /api/handovers (BFF). Handler REAL da rota, contexto de sessão já
// resolvido injetado (papel EFETIVO, tenant, reserva ativa). A resolução da
// sessão (Modo Usuário, Bearer, identidade mista, duas sessões) é coberta por
// mode-user-auth-paths: /api/handovers/* está atrás do mesmo authMiddleware.
// Modelo: service_handovers tem UMA reserva (reserve_id), tenant, saindo_id e
// entrando_id — não há reserva de origem/destino.

const { handoversRoutes } = await import("../../routes/handovers.ts");

const T_A = "51a00000-0000-0000-0000-00000000000a";
const T_B = "51b00000-0000-0000-0000-00000000000b";
const R_A1 = "51a10000-0000-0000-0000-0000000000a1";
const R_A2 = "51a20000-0000-0000-0000-0000000000a2";
const R_B1 = "51b10000-0000-0000-0000-0000000000b1";
const ARM_A1 = "51000000-0000-0000-0000-00000000005a"; // armeiro, participa de a1-mine
const ARM_A1_OTHER = "51000000-0000-0000-0000-00000000005c";
const STAFF_B1 = "51000000-0000-0000-0000-00000000005b";

const H = (id: string, tenant: string, reserve: string, extra: Row = {}): Row =>
  ({ id, tenant_id: tenant, reserve_id: reserve, status: "aguardando_assinatura_saida", created_at: "2026-09-30T00:00:00Z", saindo_id: ARM_A1_OTHER, entrando_id: null, ...extra });

// O fake não ordena: a ordem do array imita `created_at desc`. As linhas fora do
// escopo de A1 vêm primeiro (60 de A2 + B1 + mesma reserve_id em outro tenant) e
// ocupariam os 50 do limit se o corte acontecesse antes do filtro.
const HANDOVERS: Row[] = [
  H("b1-1", T_B, R_B1),
  H("a1-tenant-b", T_B, R_A1),
  ...Array.from({ length: 60 }, (_, i) => H(`a2-bulk-${String(i).padStart(2, "0")}`, T_A, R_A2)),
  H("a1-mine", T_A, R_A1, { saindo_id: ARM_A1 }),
  H("a1-mine-entrando", T_A, R_A1, { entrando_id: ARM_A1, status: "concluida" }),
  H("a1-others", T_A, R_A1),
];
const tables = {
  service_handovers: { columns: ["id", "tenant_id", "reserve_id", "status", "created_at", "saindo_id", "entrando_id"], rows: HANDOVERS },
  profiles: { columns: ["id"], rows: [] },
  reserves: {
    columns: ["id", "nome", "acronym", "tenant_id"],
    rows: [
      { id: R_A1, nome: "A1", acronym: "A1", tenant_id: T_A },
      { id: R_A2, nome: "A2", acronym: "A2", tenant_id: T_A },
      { id: R_B1, nome: "B1", acronym: "B1", tenant_id: T_B },
    ],
  },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
before(() => { const fake = createFakePostgrest(tables); supabase.from = ((t: string) => fake.from(t)) as unknown as typeof supabase.from; });
after(() => { supabase.from = ORIGINAL_FROM; });

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
  const body = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  return { status: r.status, body: body as { handovers?: Array<{ id: string }>; error?: string } | null };
}
async function ids(ctx: Ctx, query = ""): Promise<string[]> {
  const r = await list(ctx, query);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body!.handovers!.map((x) => x.id).sort();
}

const ADMIN_A1: Ctx = { userId: ARM_A1_OTHER, role: "admin_reserva", tenantId: T_A, reserveId: R_A1 };
const A1_ALL = ["a1-mine", "a1-mine-entrando", "a1-others"];

describe("R-37 lote 4 — GET /api/handovers: escopo por papel efetivo, tenant, reserva e participação", () => {
  it("A/E/F/K. admin_reserva A1: só as 3 de A1 do tenant A (nem as 60 de A2 à frente, nem B1, nem a de mesma reserve_id em outro tenant)", async () => {
    assert.deepEqual(await ids(ADMIN_A1), A1_ALL);
  });

  it("armeiro A1: só as passagens em que participa (saindo ou entrando)", async () => {
    assert.deepEqual(await ids({ userId: ARM_A1, role: "armeiro", tenantId: T_A, reserveId: R_A1 }), ["a1-mine", "a1-mine-entrando"]);
  });

  it("B. mesmo staff com papel efetivo usuario (Modo Usuário): 403, nada listado", async () => {
    const r = await list({ ...ADMIN_A1, role: "usuario" });
    assert.equal(r.status, 403);
  });

  it("C. usuario comum: 403", async () => {
    assert.equal((await list({ userId: ARM_A1, role: "usuario", tenantId: T_A, reserveId: R_A1 })).status, 403);
  });

  it("D. staff do tenant B: só B1, nada do tenant A", async () => {
    assert.deepEqual(await ids({ userId: STAFF_B1, role: "admin_reserva", tenantId: T_B, reserveId: R_B1 }), ["b1-1"]);
  });

  it("?reserve_id do cliente só refina dentro do escopo: outra reserva do mesmo tenant → vazio; mesma reserve_id mas tenant da sessão é o que vale", async () => {
    assert.deepEqual(await ids(ADMIN_A1, `?reserve_id=${R_A2}`), []);
    assert.deepEqual(await ids(ADMIN_A1, `?reserve_id=${R_B1}`), []);
    assert.deepEqual(await ids(ADMIN_A1, `?reserve_id=${R_A1}`), A1_ALL);
  });

  it("status refina dentro do escopo", async () => {
    assert.deepEqual(await ids(ADMIN_A1, "?status=concluida"), ["a1-mine-entrando"]);
  });

  it("N. matriz (admin_global sem reserva ativa) do tenant A: A1+A2, nenhuma do B, limitado a 50", async () => {
    const r = await list({ userId: ARM_A1_OTHER, role: "admin_global", tenantId: T_A, reserveId: null });
    assert.equal(r.status, 200);
    assert.equal(r.body!.handovers!.length, 50);
    assert.ok(r.body!.handovers!.every((h) => h.id.startsWith("a")) && !r.body!.handovers!.some((h) => h.id === "a1-tenant-b"));
  });

  it("N2. admin_global EM filial A1 fica confinado a A1 (não herda a matriz)", async () => {
    assert.deepEqual(await ids({ userId: ARM_A1_OTHER, role: "admin_global", tenantId: T_A, reserveId: R_A1 }), A1_ALL);
  });

  it("staff não-matriz sem reserva ativa: lista vazia, nunca o tenant inteiro", async () => {
    assert.deepEqual(await ids({ ...ADMIN_A1, reserveId: null }), []);
  });

  it("falha do banco: 500 genérico (sem detalhe do Postgres)", async () => {
    const orig = supabase.from;
    const failing: unknown = new Proxy({}, {
      get: (_t, k) => k === "then"
        ? (res: (v: unknown) => void) => res({ data: null, error: { code: "XX000", message: "relation secret_table does not exist" } })
        : () => failing,
    });
    supabase.from = (() => failing) as unknown as typeof supabase.from;
    try {
      const r = await appFor(ADMIN_A1).request("/api/handovers");
      assert.equal(r.status, 500);
      assert.ok(!JSON.stringify(await r.json()).includes("secret_table"));
    } finally { supabase.from = orig; }
  });

  it("guarda estática: desempate por id e falha com logFailure", () => {
    const src = readFileSync(new URL("../../routes/handovers.ts", import.meta.url), "utf8");
    const start = src.indexOf('handoversRoutes.get(\n  "/",');
    const chunk = src.slice(start, src.indexOf("GET /api/handovers/:id", start));
    assert.ok(chunk.includes('.order("id", { ascending: false })'));
    assert.ok(chunk.includes('"handovers.list.failure"'));
  });
});
