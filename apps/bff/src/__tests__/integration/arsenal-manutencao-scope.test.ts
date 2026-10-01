import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-37 lote 6 (docs/auditoria/EVIDENCE_R37_BATCH6.md): /reserva/arsenal/manutencao
// passou a ler de GET /api/arsenal/items/manutencao. Handler REAL da rota;
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
  reserves: { columns: ["id", "nome", "acronym", "tenant_id"], rows: [{ id: R_A1, nome: "Alfa", acronym: "A", tenant_id: T_A }] as Row[] },
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
type Body = { items?: Array<Record<string, unknown> & { id: string }>; error?: string };
async function get(ctx: Ctx) {
  const r = await appFor(ctx).request("/api/arsenal/items/manutencao");
  const text = await r.text();
  return { status: r.status, text, body: (r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null) as Body | null };
}
const ids = (b: Body | null) => (b?.items ?? []).map((i) => i.id).sort();

const ARM_A1: Ctx = { userId: USER, role: "armeiro", tenantId: T_A, reserveId: R_A1 };

describe("R-37 lote 6 — GET /api/arsenal/items/manutencao: papel efetivo, tenant e reserva", () => {
  it("A. armeiro A1: só os itens em triagem da reserva A1 do tenant A (nem as 60 de A2 à frente, nem B1, nem a de mesma reserve_id em outro tenant, nem disponível/cautelado)", async () => {
    const r = await get(ARM_A1);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(ids(r.body), ["a1-admin", "a1-avariado", "a1-perdido"]);
  });

  it("admin_reserva A1: o mesmo escopo; admin_reserva A2 só A2", async () => {
    assert.deepEqual(ids((await get({ ...ARM_A1, role: "admin_reserva" })).body), ["a1-admin", "a1-avariado", "a1-perdido"]);
    assert.equal((await get({ ...ARM_A1, role: "admin_reserva", reserveId: R_A2 })).body!.items!.length, 60);
  });

  it("D. staff do tenant B (B1): só B1 (a de mesma reserve_id em outro tenant só aparece para o tenant dela)", async () => {
    assert.deepEqual(ids((await get({ userId: USER, role: "armeiro", tenantId: T_B, reserveId: R_B1 })).body), ["b1-1"]);
  });

  it("B/C. papel efetivo usuario (Modo Usuário ou militar comum): 403 sem nenhuma consulta", async () => {
    const r = await get({ ...ARM_A1, role: "usuario" });
    assert.equal(r.status, 403);
    assert.deepEqual(queried, []);
  });

  it("admin_global, auditor e superadmin ficam fora desta rota (403)", async () => {
    for (const role of ["admin_global", "auditor", "superadmin"]) assert.equal((await get({ ...ARM_A1, role })).status, 403, role);
  });

  it("G. sem tenant na sessão: 403, sem consulta", async () => {
    assert.equal((await get({ ...ARM_A1, tenantId: null })).status, 403);
    assert.deepEqual(queried, []);
  });

  it("sem reserva ativa: lista vazia legítima (200), sem consultar material_items", async () => {
    const r = await get({ ...ARM_A1, reserveId: null });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { items: [] });
    assert.ok(!queried.includes("material_items"));
  });

  it("vazio legítimo ≠ erro: reserva sem itens em triagem → 200 {items: []}; falha do banco → 500", async () => {
    const empty = await get({ userId: USER, role: "armeiro", tenantId: T_A, reserveId: "a1a30000-0000-0000-0000-0000000000a3" });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.body, { items: [] });
    failTable = "material_items";
    const err = await get(ARM_A1);
    assert.equal(err.status, 500);
    assert.deepEqual(err.body, { error: "Erro ao buscar itens em manutenção" });
    assert.ok(!err.text.includes("secret_"));
  });

  it("escala: >1000 itens em triagem na reserva vêm completos (paginação, sem duplicar)", async () => {
    const extra: Row[] = Array.from({ length: 1100 }, (_, i) => I(`bulk-${String(i).padStart(4, "0")}`, T_A, R_A1));
    tables.material_items.rows.push(...extra);
    try {
      const r = await get(ARM_A1);
      assert.equal(r.status, 200);
      assert.equal(r.body!.items!.length, 3 + 1100);
      assert.equal(new Set(r.body!.items!.map((i) => i.id)).size, 1103);
    } finally { tables.material_items.rows.splice(tables.material_items.rows.length - extra.length, extra.length); }
  });

  it("campos: só os que a página usa (nada de número de série secreto, tenant ou reserve_id do dono)", async () => {
    const r = await get(ARM_A1);
    assert.ok(!r.text.includes("SEGREDO") && !r.text.includes("numero_serie_secreto") && !r.text.includes("tenant_id"));
    assert.deepEqual(Object.keys(r.body!.items![0]).sort(), [
      "condicao", "descricao_adicional", "id", "identificador_principal", "last_movement_at", "material_categoria", "material_nome",
      "reserve_id", "reserve_nome", "status_operacional", "tipo_identificador",
    ]);
  });

  it("embed de reserves com hint de coluna (material_items tem 2 FKs para reserves; sem hint = PGRST201)", () => {
    const src = readFileSync(new URL("../../routes/arsenal.ts", import.meta.url), "utf8");
    const chunk = src.slice(src.indexOf('"/items/manutencao"'), src.indexOf("PATCH /api/arsenal/items/:id/ocorrencia"));
    assert.ok(chunk.includes("reserve:reserves!current_unit_id(id, nome, acronym)"));
  });

  it("lista de status do BFF == ALL_TRACKED_STATUSES do web (sem divergência silenciosa entre as abas)", () => {
    const web = readFileSync(new URL("../../../../web/src/lib/material-item-status.ts", import.meta.url), "utf8");
    const block = web.slice(web.indexOf("export const TAB_STATUSES"), web.indexOf("export const TAB_LABEL"));
    const webStatuses = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((x) => !["danificados", "perdidos", "administrativo"].includes(x)).sort();
    const bff = readFileSync(new URL("../../routes/arsenal.ts", import.meta.url), "utf8");
    const line = bff.match(/const MANUTENCAO_STATUSES = \[([^\]]+)\]/)![1];
    const bffStatuses = [...line.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(bffStatuses, webStatuses);
  });

  it("guarda estática: tenant e reserva no banco, ordem total (last_movement_at, id), logFailure", () => {
    const src = readFileSync(new URL("../../routes/arsenal.ts", import.meta.url), "utf8");
    const chunk = src.slice(src.indexOf('"/items/manutencao"'), src.indexOf("PATCH /api/arsenal/items/:id/ocorrencia"));
    assert.ok(chunk.includes('.eq("tenant_id", tenantId)') && chunk.includes('.in("reserve_id", reserveIds)'));
    assert.match(chunk, /\.order\("last_movement_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)\s*\.range\(/);
    assert.ok(chunk.includes('"arsenal.manutencao.failure"'));
  });
});
