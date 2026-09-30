import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-37 lote 3 (docs/auditoria/EVIDENCE_R37_BATCH3.md): /reserva/saidas passou a
// ler de GET /api/lendings (com `limit`) e GET /api/reserves/active. Handler
// REAL das rotas, contexto de sessão já resolvido injetado (papel EFETIVO,
// tenant, reserva ativa — como o authMiddleware entrega; Modo Usuário = papel
// efetivo "usuario"). A resolução da sessão em si (Modo Usuário, Bearer,
// identidade mista, duas sessões) é coberta por mode-user-auth-paths: as rotas
// estão atrás do mesmo authMiddleware (index.ts: /api/lendings/*, /api/reserves/*).

const { lendingRoutes } = await import("../../routes/lendings.ts");
const { reservesRoutes } = await import("../../routes/reserves.ts");

const T_A = "41a00000-0000-0000-0000-00000000000a";
const T_B = "41b00000-0000-0000-0000-00000000000b";
const R_A1 = "41a10000-0000-0000-0000-0000000000a1";
const R_A2 = "41a20000-0000-0000-0000-0000000000a2";
const R_B1 = "41b10000-0000-0000-0000-0000000000b1";
const STAFF_A1 = "41000000-0000-0000-0000-00000000005a";
const STAFF_B1 = "41000000-0000-0000-0000-00000000005b";
const OTHER_USER = "41000000-0000-0000-0000-0000000000ee";
const MIL = "41000000-0000-0000-0000-0000000000d1";

const L = (id: string, tenant: string, reserve: string, status = "ativo"): Row =>
  ({ id, tenant_id: tenant, reserve_id: reserve, military_id: MIL, master_id: STAFF_A1, status_legacy: status, issued_at: "2026-09-30T00:00:00Z" });

// O fake não ordena: a ordem do array imita `order(issued_at desc)` — as linhas
// que NÃO pertencem ao escopo de A1 vêm primeiro e ocupariam todo o limit se o
// corte acontecesse antes do filtro (as de A1 são as mais antigas).
const LENDINGS: Row[] = [
  L("b1-1", T_B, R_B1),
  // Mesma reserva_id de A1, mas em OUTRO tenant: o filtro de tenant tem que barrar.
  L("a1-tenant-b", T_B, R_A1),
  ...Array.from({ length: 60 }, (_, i) => L(`a2-bulk-${String(i).padStart(2, "0")}`, T_A, R_A2)),
  L("a1-1", T_A, R_A1, "ativo"),
  L("a1-2", T_A, R_A1, "devolvido"),
  L("a1-3", T_A, R_A1, "ativo"),
];

const tables = {
  lendings: { columns: ["id", "tenant_id", "reserve_id", "military_id", "master_id", "status_legacy", "issued_at", "material_type_id"], rows: LENDINGS },
  profiles: { columns: ["id"], rows: [] },
  material_types: { columns: ["id"], rows: [] },
  reserves: {
    columns: ["id", "nome", "logo_url", "tenant_id"],
    rows: [
      { id: R_A1, nome: "Reserva A1", logo_url: "logos/a1.png", tenant_id: T_A },
      { id: R_A2, nome: "Reserva A2", logo_url: null, tenant_id: T_A },
      { id: R_B1, nome: "Reserva B1", logo_url: "logos/b1.png", tenant_id: T_B },
    ],
  },
  reserve_memberships: {
    columns: ["user_id", "reserve_id"],
    rows: [
      { user_id: STAFF_A1, reserve_id: R_A1 },
      { user_id: STAFF_B1, reserve_id: R_B1 },
      // Membership existe, mas a reserva é de OUTRO tenant em relação à sessão usada no caso de tenant trocado.
      { user_id: OTHER_USER, reserve_id: R_B1 },
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
  app.route("/api/lendings", lendingRoutes);
  app.route("/api/reserves", reservesRoutes);
  return app;
}
async function list(ctx: Ctx, query = "") {
  const r = await appFor(ctx).request(`/api/lendings${query}`);
  const body = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  return { status: r.status, body };
}
async function ids(ctx: Ctx, query = ""): Promise<string[]> {
  const r = await list(ctx, query);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return (r.body as Array<{ id: string }>).map((x) => x.id).sort();
}

const STAFF_A1_CTX: Ctx = { userId: STAFF_A1, role: "armeiro", tenantId: T_A, reserveId: R_A1 };
const A1_ALL = ["a1-1", "a1-2", "a1-3"];

describe("R-37 lote 3 — GET /api/lendings: escopo por papel efetivo, tenant, reserva, status e limite", () => {
  it("A/E/F/J/K. staff A1 com limit=11: só as 3 de A1 do tenant A, nada de A2 (60 mais recentes), nem B1, nem a de mesma reserve_id em outro tenant", async () => {
    assert.deepEqual(await ids(STAFF_A1_CTX, "?limit=11"), A1_ALL);
  });

  it("J. sem limit: lista completa do escopo (comportamento anterior preservado)", async () => {
    assert.deepEqual(await ids(STAFF_A1_CTX), A1_ALL);
  });

  it("status: filtra por status_legacy dentro do escopo e antes do limite", async () => {
    assert.deepEqual(await ids(STAFF_A1_CTX, "?status=ativo&limit=11"), ["a1-1", "a1-3"]);
    assert.deepEqual(await ids(STAFF_A1_CTX, "?status=devolvido&limit=11"), ["a1-2"]);
  });

  it("B. mesmo staff com papel efetivo usuario (Modo Usuário): 403", async () => {
    assert.equal((await list({ ...STAFF_A1_CTX, role: "usuario" }, "?limit=11")).status, 403);
  });

  it("C. usuario comum: 403", async () => {
    assert.equal((await list({ userId: MIL, role: "usuario", tenantId: T_A, reserveId: R_A1 })).status, 403);
  });

  it("D. staff do tenant B: só B1, nada do tenant A", async () => {
    assert.deepEqual(await ids({ userId: STAFF_B1, role: "armeiro", tenantId: T_B, reserveId: R_B1 }, "?limit=11"), ["b1-1"]);
  });

  it("N. matriz (admin_global sem reserva ativa) do tenant A: A1+A2 do tenant A, nenhuma do B, e o limite respeita o escopo", async () => {
    const matriz: Ctx = { userId: STAFF_A1, role: "admin_global", tenantId: T_A, reserveId: null };
    assert.equal((await ids(matriz)).length, 63);
    const limited = await ids(matriz, "?limit=5");
    assert.equal(limited.length, 5);
    assert.ok(limited.every((id) => id.startsWith("a")) && !limited.includes("a1-tenant-b"));
  });

  it("N2. admin_global EM filial A1 fica confinado a A1 (não herda a matriz)", async () => {
    assert.deepEqual(await ids({ userId: STAFF_A1, role: "admin_global", tenantId: T_A, reserveId: R_A1 }, "?limit=11"), A1_ALL);
  });

  it("staff não-matriz sem reserva ativa: lista vazia, nunca o tenant inteiro", async () => {
    assert.deepEqual(await ids({ userId: STAFF_A1, role: "armeiro", tenantId: T_A, reserveId: null }, "?limit=11"), []);
  });

  it("G. sem tenant na sessão: 400", async () => {
    assert.equal((await list({ ...STAFF_A1_CTX, tenantId: null }, "?limit=11")).status, 400);
  });

  it("limit inválido (0, abc, 1.5, 101) → 400 com log, nada listado", async () => {
    for (const bad of ["0", "abc", "1.5", "101", "-3"]) {
      assert.equal((await list(STAFF_A1_CTX, `?limit=${bad}`)).status, 400, `limit=${bad}`);
    }
  });

  it("falha do banco na listagem: 500 genérico (sem error.message do Postgres)", async () => {
    const orig = supabase.from;
    const failing: unknown = new Proxy({}, {
      get: (_t, k) => k === "then"
        ? (res: (v: unknown) => void) => res({ data: null, error: { code: "XX000", message: "relation secret_table does not exist" } })
        : () => failing,
    });
    supabase.from = (() => failing) as unknown as typeof supabase.from;
    try {
      const r = await appFor(STAFF_A1_CTX).request("/api/lendings?limit=11");
      assert.equal(r.status, 500);
      assert.ok(!JSON.stringify(await r.json()).includes("secret_table"));
    } finally { supabase.from = orig; }
  });

  it("L/T. a listagem pede ao banco os campos que a página usa (military.id/foto_url, master.matricula)", () => {
    const src = readFileSync(new URL("../../routes/lendings.ts", import.meta.url), "utf8");
    const start = src.indexOf('lendingRoutes.get("/", roleGuard');
    const chunk = src.slice(start, src.indexOf("lendingRoutes.post(", start));
    assert.ok(chunk.includes("lendings_military_id_fkey(id, nome_completo, matricula, posto, foto_url)"));
    assert.ok(chunk.includes("lendings_master_id_fkey(nome_completo, matricula)"));
    assert.ok(chunk.includes('.order("id", { ascending: false })'), "desempate por id");
  });
});

describe("R-37 lote 3 — GET /api/reserves/active: reserva da sessão, com membership, no tenant", () => {
  const active = async (ctx: Ctx) => {
    const r = await appFor(ctx).request("/api/reserves/active");
    const body = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
    return { status: r.status, body: body as { reserve?: { id: string; nome: string; logo_url: string | null } | null } };
  };

  it("O. armeiro com membership na reserva ativa: id, nome e logo", async () => {
    const r = await active(STAFF_A1_CTX);
    assert.equal(r.status, 200);
    // O fake não projeta colunas (devolve a linha inteira); compara só o que a rota promete.
    const { id, nome, logo_url } = r.body.reserve!;
    assert.deepEqual({ id, nome, logo_url }, { id: R_A1, nome: "Reserva A1", logo_url: "logos/a1.png" });
  });

  it("O. admin_global em filial SEM membership na reserva ativa: null (mesma semântica da leitura antiga)", async () => {
    const r = await active({ userId: "41000000-0000-0000-0000-00000000005f", role: "admin_global", tenantId: T_A, reserveId: R_A1 });
    assert.deepEqual(r.body, { reserve: null });
  });

  it("membership de OUTRO usuário na reserva não conta", async () => {
    const r = await active({ userId: "41000000-0000-0000-0000-00000000005c", role: "armeiro", tenantId: T_A, reserveId: R_A1 });
    assert.deepEqual(r.body, { reserve: null });
  });

  it("F. membership existe mas a reserva é de outro tenant em relação à sessão: null", async () => {
    const r = await active({ userId: OTHER_USER, role: "armeiro", tenantId: T_A, reserveId: R_B1 });
    assert.deepEqual(r.body, { reserve: null });
  });

  it("sem reserva ativa: null", async () => {
    assert.deepEqual((await active({ ...STAFF_A1_CTX, reserveId: null })).body, { reserve: null });
  });

  it("B/C. papel efetivo usuario (Modo Usuário ou militar comum): 403", async () => {
    assert.equal((await active({ ...STAFF_A1_CTX, role: "usuario" })).status, 403);
  });

  it("G. sem tenant na sessão: 403", async () => {
    assert.equal((await active({ ...STAFF_A1_CTX, tenantId: null })).status, 403);
  });
});
