import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-46 (docs/auditoria/EVIDENCE_R46.md): GET /api/arsenal/items/disponiveis listava
// os itens disponíveis do TENANT inteiro; o BFF usa service role (sem a RLS por
// reserva), então um armeiro da reserva A enumerava identificadores de armamento
// das reservas B e C. Handler REAL; contexto de sessão (papel EFETIVO, tenant,
// reserva ativa) injetado como o authMiddleware entrega. Modo Usuário/Bearer:
// mode-user-auth-paths (/api/arsenal/* está atrás do mesmo authMiddleware).

const { arsenalRoutes } = await import("../../routes/arsenal.ts");

const T_A = "b1a00000-0000-0000-0000-00000000000a";
const T_B = "b1b00000-0000-0000-0000-00000000000b";
const R_A = "b1a10000-0000-0000-0000-0000000000a1";
const R_B = "b1a20000-0000-0000-0000-0000000000a2";
const R_C = "b1a30000-0000-0000-0000-0000000000a3";
const R_TB = "b1b10000-0000-0000-0000-0000000000b1";
const USER = "b1000000-0000-0000-0000-0000000000a0";

const I = (id: string, tenant: string, reserve: string, status = "disponivel", extra: Row = {}): Row => ({
  id, tenant_id: tenant, reserve_id: reserve, current_unit_id: reserve, status_operacional: status,
  identificador_principal: `SN-${id}`, material_type_id: "mt1", cautela_elegivel: true, numero_serie_interno: "SEGREDO", ...extra,
});
const ITEMS: Row[] = [
  // 350 itens das reservas B e C na frente: ocupam o limit de 300 se o corte vier antes do filtro.
  ...Array.from({ length: 350 }, (_, i) => I(`bc-${String(i).padStart(3, "0")}`, T_A, i % 2 ? R_B : R_C)),
  I("tb-1", T_B, R_TB),
  I("tb-same-reserve-id", T_B, R_A),            // mesma reserve_id, OUTRO tenant
  I("a-1", T_A, R_A), I("a-2", T_A, R_A),
  I("a-cautelado", T_A, R_A, "cautelado"),       // fora de "disponivel"
  I("a-avariado", T_A, R_A, "avariado"),
  I("a-nao-elegivel", T_A, R_A, "disponivel", { cautela_elegivel: false }),
];
const tables = {
  material_items: { columns: Object.keys(ITEMS[0]), rows: ITEMS },
  material_types: { columns: ["id", "nome", "categoria", "cautela_habilitada", "ativo"], rows: [{ id: "mt1", nome: "Pistola", categoria: "arma", cautela_habilitada: true, ativo: true }] as Row[] },
  reserves: { columns: ["id", "nome", "acronym", "tenant_id"], rows: [
    { id: R_A, nome: "A", acronym: "A", tenant_id: T_A }, { id: R_B, nome: "B", acronym: "B", tenant_id: T_A },
    { id: R_C, nome: "C", acronym: "C", tenant_id: T_A }, { id: R_TB, nome: "TB", acronym: "TB", tenant_id: T_B },
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
async function get(ctx: Ctx, query = "") {
  const r = await appFor(ctx).request(`/api/arsenal/items/disponiveis${query}`);
  const text = await r.text();
  const body = r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null;
  return { status: r.status, text, body: body as Array<Record<string, unknown> & { id: string }> | { error: string } | null };
}
const ids = (b: unknown) => (Array.isArray(b) ? (b as Array<{ id: string }>).map((x) => x.id) : []).sort();

const ARM_A: Ctx = { userId: USER, role: "armeiro", tenantId: T_A, reserveId: R_A };
const ADM_A: Ctx = { userId: USER, role: "admin_global", tenantId: T_A, reserveId: null };

describe("R-46 — GET /api/arsenal/items/disponiveis: escopo de reserva e tenant da sessão", () => {
  it("R46. armeiro da reserva A: só itens disponíveis de A (nada de B/C, apesar dos 350 à frente do limit; nem outro tenant, nem a de mesma reserve_id em outro tenant)", async () => {
    const r = await get(ARM_A);
    assert.equal(r.status, 200, r.text.slice(0, 200));
    assert.deepEqual(ids(r.body), ["a-1", "a-2", "a-nao-elegivel"]);
  });

  it("admin_reserva A: o mesmo escopo", async () => {
    assert.deepEqual(ids((await get({ ...ARM_A, role: "admin_reserva" })).body), ["a-1", "a-2", "a-nao-elegivel"]);
  });

  it("admin_global EM filial A: confinado à reserva ativa (não enxerga B/C)", async () => {
    assert.deepEqual(ids((await get({ ...ADM_A, reserveId: R_A })).body), ["a-1", "a-2", "a-nao-elegivel"]);
  });

  it("admin_global na matriz (sem reserva ativa): tenant A inteiro (A, B, C), nunca o tenant B — preservado", async () => {
    const r = await get(ADM_A);
    assert.equal(r.status, 200);
    const got = ids(r.body);
    assert.ok(got.some((x) => x.startsWith("bc-")) && !got.includes("tb-1") && !got.includes("tb-same-reserve-id")); // o fake não ordena: só confere reservas B/C visíveis e nada do tenant B
    assert.equal(got.length, 300); // limit de 300 preservado
  });

  it("tenant B: só o próprio tenant", async () => {
    assert.deepEqual(ids((await get({ userId: USER, role: "armeiro", tenantId: T_B, reserveId: R_TB })).body), ["tb-1"]);
    assert.deepEqual(ids((await get({ userId: USER, role: "armeiro", tenantId: T_B, reserveId: R_A })).body), ["tb-same-reserve-id"]);
  });

  it("status: só `disponivel` (cautelado/avariado nunca entram)", async () => {
    const got = ids((await get(ARM_A)).body);
    assert.ok(!got.includes("a-cautelado") && !got.includes("a-avariado"));
  });

  it("consumer cautela (?for=cautela): continua filtrando por elegibilidade/tipo, agora dentro da reserva", async () => {
    assert.deepEqual(ids((await get(ARM_A, "?for=cautela")).body), ["a-1", "a-2"]);
  });

  it("consumer 'Registrar ocorrência' (?q=): busca só dentro da reserva; o número de B/C não é enumerável", async () => {
    assert.deepEqual(ids((await get(ARM_A, "?q=sn-a-1")).body), ["a-1"]);
    assert.deepEqual(ids((await get(ARM_A, "?q=bc-")).body), []);
  });

  it("B/C. papel efetivo usuario (Modo Usuário ou militar comum): 403 sem consulta", async () => {
    const r = await get({ ...ARM_A, role: "usuario" });
    assert.equal(r.status, 403);
    assert.deepEqual(queried, []);
  });

  it("sem tenant na sessão: 400, sem consulta", async () => {
    assert.equal((await get({ ...ARM_A, tenantId: null })).status, 400);
    assert.deepEqual(queried, []);
  });

  it("sem reserva ativa (não-matriz): lista vazia legítima, sem consultar material_items", async () => {
    const r = await get({ ...ARM_A, reserveId: null });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, []);
    assert.ok(!queried.includes("material_items"));
  });

  it("erro de banco: 500 genérico (não vira lista vazia) e sem vazar", async () => {
    failTable = "material_items";
    const r = await get(ARM_A);
    assert.equal(r.status, 500);
    assert.ok(!r.text.includes("secret_"));
    assert.deepEqual(r.body, { error: "Erro ao buscar materiais disponíveis" });
  });

  it("matriz: erro ao calcular o escopo (reserves) → 500, material_items não consultada (R-41)", async () => {
    failTable = "reserves";
    const r = await get(ADM_A);
    assert.equal(r.status, 500);
    assert.ok(!queried.includes("material_items"));
  });

  it("campos (o fake não projeta colunas; confere o select): só o que o seletor usa, sem número de série interno nem tenant", () => {
    const src = readFileSync(new URL("../../routes/arsenal.ts", import.meta.url), "utf8");
    const chunk = src.slice(src.indexOf('"/items/disponiveis"'), src.indexOf("GET /api/arsenal/items/manutencao"));
    const selects = [...chunk.matchAll(/"(id, identificador_principal[^"]*)"/g)].map((m) => m[1]);
    assert.equal(selects.length, 2);
    for (const sel of selects) assert.ok(!/tenant_id|numero_serie|validade_item/.test(sel.replace(/cautela_habilitada/g, "")), sel);
  });

  it("guarda estática: tenant e reserva no banco, ordem com tiebreak, embed com hint de coluna, logFailure", () => {
    const src = readFileSync(new URL("../../routes/arsenal.ts", import.meta.url), "utf8");
    const chunk = src.slice(src.indexOf('"/items/disponiveis"'), src.indexOf("GET /api/arsenal/items/manutencao"));
    assert.ok(chunk.includes('.eq("tenant_id", tenantId)') && chunk.includes('.in("reserve_id", reserveIds)'));
    assert.match(chunk, /\.order\("identificador_principal"\)\s*\.order\("id"\)\s*\.limit\(300\)/);
    assert.equal(chunk.split("reserve:reserves!reserve_id(nome, acronym)").length - 1, 2, "os dois selects (cautela e geral) com hint");
    assert.ok(!/reserve:reserves\(/.test(chunk), "nenhum embed de reserves sem hint");
    assert.equal(chunk.split('"arsenal.disponiveis.failure"').length - 1, 2, "logFailure no erro de escopo e no de banco");
  });
});
