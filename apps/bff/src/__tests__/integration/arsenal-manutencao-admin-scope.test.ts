import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-37 lote 7 (docs/auditoria/EVIDENCE_R37_BATCH7.md): /admin/arsenal/manutencao
// passou a ler de GET /api/arsenal/items/manutencao-admin. Handler REAL da rota;
// contexto de sessão (papel EFETIVO, tenant, reserva ativa) injetado como o
// authMiddleware entrega. Modo Usuário/Bearer/identidade mista/multisessão:
// mode-user-auth-paths (/api/arsenal/* está atrás do mesmo authMiddleware).

const { arsenalRoutes } = await import("../../routes/arsenal.ts");

const T_A = "a1a00000-0000-0000-0000-00000000000a";
const T_B = "a1b00000-0000-0000-0000-00000000000b";
const R_A1 = "a1a10000-0000-0000-0000-0000000000a1";
const R_A2 = "a1a20000-0000-0000-0000-0000000000a2";
const R_B1 = "a1b10000-0000-0000-0000-0000000000b1";
const USER = "a1000000-0000-0000-0000-0000000000a0";

const I = (id: string, tenant: string, reserve: string, status = "avariado", extra: Row = {}): Row => ({
  id, tenant_id: tenant, reserve_id: reserve, current_unit_id: reserve, status_operacional: status,
  identificador_principal: `ID-${id}`, tipo_identificador: "numero_serie", condicao: "ruim", descricao_adicional: null,
  last_movement_at: "2026-09-30T00:00:00Z", material_type_id: "mt1", numero_serie_secreto: "SEGREDO", ...extra,
});
const ITEMS: Row[] = [
  // Fora do escopo de A1 e na frente: ocupariam qualquer corte feito antes do filtro.
  I("b1-1", T_B, R_B1),
  I("a1-tenant-b", T_B, R_A1),                 // mesma reserve_id, OUTRO tenant
  ...Array.from({ length: 60 }, (_, i) => I(`a2-${String(i).padStart(2, "0")}`, T_A, R_A2)),
  I("a1-avariado", T_A, R_A1, "avariado"),
  I("a1-perdido", T_A, R_A1, "extraviado"),
  I("a1-admin", T_A, R_A1, "aguardando_baixa"),
  I("a1-disponivel", T_A, R_A1, "disponivel"),  // fora da triagem
  I("a1-cautelado", T_A, R_A1, "cautelado"),
];
const tables = {
  material_items: { columns: Object.keys(ITEMS[0]), rows: ITEMS },
  material_types: { columns: ["id", "nome", "categoria"], rows: [{ id: "mt1", nome: "Pistola", categoria: "arma" }] as Row[] },
  reserves: { columns: ["id", "nome", "acronym", "tenant_id", "status"], rows: [
    { id: R_A1, nome: "Alfa", acronym: "A", tenant_id: T_A, status: "ativa" },
    { id: R_A2, nome: "Bravo", acronym: "B", tenant_id: T_A, status: "ativa" },
    { id: "a1a40000-0000-0000-0000-0000000000a4", nome: "Inativa", acronym: "I", tenant_id: T_A, status: "inativa" },
    { id: R_B1, nome: "OutroTenant", acronym: "O", tenant_id: T_B, status: "ativa" },
  ] as Row[] },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
let fake: ReturnType<typeof createFakePostgrest>;
let queried: string[] = [];
let failTable: string | null = null;
before(() => {
  fake = createFakePostgrest(tables);
  supabase.from = ((t: string) => {
    queried.push(t);
    if (failTable === t) {
      const failing: unknown = new Proxy({}, { get: (_t, k) => k === "then"
        ? (res: (v: unknown) => void) => res({ data: null, error: { code: "XX000", message: `relation secret_${t} exploded` } })
        : () => failing });
      return failing;
    }
    return fake.from(t);
  }) as unknown as typeof supabase.from;
});
after(() => { supabase.from = ORIGINAL_FROM; });
beforeEach(() => { queried = []; failTable = null; });

type Ctx = { userId: string; role: string; tenantId: string | null; reserveId: string | null };
function appFor(ctx: Ctx) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    c.set("userId", ctx.userId); c.set("role", ctx.role as HonoVariables["role"]);
    c.set("tenantId", ctx.tenantId); c.set("reserveId", ctx.reserveId);
    await next();
  });
  app.route("/api/arsenal", arsenalRoutes);
  return app;
}
type Body = { items?: Array<Record<string, unknown> & { id: string }>; reserves?: Array<{ id: string; nome: string; acronym: string }>; error?: string };
async function get(ctx: Ctx) {
  const r = await appFor(ctx).request("/api/arsenal/items/manutencao-admin");
  const text = await r.text();
  return { status: r.status, text, body: (r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null) as Body | null };
}
const ids = (b: Body | null) => (b?.items ?? []).map((i) => i.id).sort();

const ADM_MATRIZ: Ctx = { userId: USER, role: "admin_global", tenantId: T_A, reserveId: null };
const resIds = (b: Body | null) => (b?.reserves ?? []).map((r) => r.id).sort();

describe("R-37 lote 7 — GET /api/arsenal/items/manutencao-admin", () => {
  it("matriz (admin_global sem reserva ativa): itens do tenant A inteiro (A1 + A2), nenhum do tenant B; reservas ativas só do tenant A", async () => {
    const r = await get(ADM_MATRIZ);
    assert.equal(r.status, 200, r.text);
    const got = ids(r.body);
    assert.equal(got.length, 63);
    assert.ok(got.includes("a1-avariado") && got.includes("a2-00"));
    assert.ok(!got.includes("b1-1") && !got.includes("a1-tenant-b"));
    assert.ok(!got.includes("a1-disponivel") && !got.includes("a1-cautelado"));
    assert.deepEqual(resIds(r.body), [R_A1, R_A2].sort());
  });

  it("modo filial (admin_global com reserva ativa A1): confinado a A1, também na lista de reservas", async () => {
    const r = await get({ ...ADM_MATRIZ, reserveId: R_A1 });
    assert.deepEqual(ids(r.body), ["a1-admin", "a1-avariado", "a1-perdido"]);
    assert.deepEqual(resIds(r.body), [R_A1]);
  });

  it("tenant B: só o seu", async () => {
    const r = await get({ ...ADM_MATRIZ, tenantId: T_B });
    assert.deepEqual(ids(r.body), ["b1-1"]);
    assert.deepEqual(resIds(r.body), [R_B1]);
  });

  it("papéis fora: armeiro, admin_reserva, usuario (Modo Usuário), auditor, superadmin → 403 sem consulta", async () => {
    for (const role of ["armeiro", "admin_reserva", "usuario", "auditor", "superadmin"]) {
      queried = [];
      assert.equal((await get({ ...ADM_MATRIZ, role })).status, 403, role);
      assert.deepEqual(queried, [], role);
    }
  });

  it("sem tenant na sessão: 403 sem consulta", async () => {
    const r = await get({ ...ADM_MATRIZ, tenantId: null });
    assert.equal(r.status, 403);
    assert.deepEqual(queried, []);
  });

  it("falha do banco (escopo, itens ou reservas) → 500 genérico, sem vazar o erro e sem lista vazia", async () => {
    for (const t of ["reserves", "material_items"]) {
      failTable = t;
      const r = await get(ADM_MATRIZ);
      assert.equal(r.status, 500, t);
      assert.deepEqual(r.body, { error: "Erro ao buscar itens em manutenção" }, t);
      assert.ok(!r.text.includes("secret_"), t);
    }
  });

  it("falha SÓ na consulta de reservas (modo filial: o escopo não consulta reserves) → 500, nunca items sem reserves", async () => {
    failTable = "reserves";
    const r = await get({ ...ADM_MATRIZ, reserveId: R_A1 });
    assert.equal(r.status, 500);
    assert.deepEqual(r.body, { error: "Erro ao buscar itens em manutenção" });
    assert.ok(!r.text.includes("secret_"));
  });

  it("não vaza colunas internas (numero_serie_secreto) e mantém o formato do endpoint de reserva", async () => {
    const r = await get({ ...ADM_MATRIZ, reserveId: R_A1 });
    assert.ok(!r.text.includes("SEGREDO"));
    assert.ok(r.body!.items!.some((i) => i.id === "a1-avariado"));
  });

  it("endpoint de reserva continua sem 'reserves' no corpo", async () => {
    const app = appFor({ ...ADM_MATRIZ, role: "armeiro", reserveId: R_A1 });
    const r = await app.request("/api/arsenal/items/manutencao");
    assert.equal(r.status, 200);
    assert.equal("reserves" in (await r.json()), false);
  });

  it("guarda estática: rota admin registrada com roleGuard('admin_global') e reaproveita o mesmo escopo", () => {
    const src = readFileSync(new URL("../../routes/arsenal.ts", import.meta.url), "utf8");
    assert.match(src, /"\/items\/manutencao-admin",\s*roleGuard\("admin_global"\)/);
    assert.match(src, /\.in\("id", reserveIds\)/);
  });
});
