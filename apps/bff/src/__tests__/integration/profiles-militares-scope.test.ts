import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-37 lote 5 (docs/auditoria/EVIDENCE_R37_BATCH5.md): /reserva/militares passou a
// ler de GET /api/profiles/militares. Handler REAL da rota; contexto de sessão
// (papel EFETIVO, tenant, reserva ativa) injetado como o authMiddleware entrega.
// Modo Usuário/Bearer/identidade mista/multisessão: mode-user-auth-paths
// (/api/profiles/* está atrás do mesmo authMiddleware, index.ts).

const { profileRoutes } = await import("../../routes/profiles.ts");

const T_A = "91a00000-0000-0000-0000-00000000000a";
const T_B = "91b00000-0000-0000-0000-00000000000b";
const R_A1 = "91a10000-0000-0000-0000-0000000000a1";
const R_A2 = "91a20000-0000-0000-0000-0000000000a2";
const R_B1 = "91b10000-0000-0000-0000-0000000000b1";
const STAFF = "91000000-0000-0000-0000-0000000000a0";

const P = (id: string, tenant: string, extra: Row = {}): Row => ({
  id, default_tenant_id: tenant, role: "usuario", nome_completo: `Militar ${id}`, matricula: id, foto_url: null,
  registration_status: "ativo", totp_configured: true, posto: "Sd", email: `${id}@x.br`, nome_de_guerra: null,
  unidade: null, telefone: null, invite_sent_at: null, account_activated_at: null, password_hash: "SEGREDO", ...extra,
});
const PROFILES: Row[] = [
  // Fora do escopo de A1 e na frente, para ocupar qualquer corte feito antes do filtro.
  P("m-b1", T_B), P("m-b-lostmember", T_B), // membership em R_A1, mas do tenant B
  P("m-a2", T_A),
  P("m-staff", T_A, { role: "armeiro" }),   // staff não é "militar"
  P("m-a1", T_A), P("m-a1-a2", T_A), P("m-nomem", T_A),
];
const tables = {
  profiles: { columns: Object.keys(PROFILES[0]), rows: PROFILES },
  reserve_memberships: { columns: ["id", "user_id", "reserve_id", "role"], rows: [
    { id: "1", user_id: "m-b1", reserve_id: R_B1, role: "usuario" },
    { id: "2", user_id: "m-b-lostmember", reserve_id: R_A1, role: "usuario" },
    { id: "3", user_id: "m-a2", reserve_id: R_A2, role: "usuario" },
    { id: "4", user_id: "m-a1", reserve_id: R_A1, role: "usuario" },
    { id: "5", user_id: "m-a1-a2", reserve_id: R_A1, role: "usuario" },
    { id: "6", user_id: "m-a1-a2", reserve_id: R_A2, role: "usuario" },
    { id: "7", user_id: "m-staff", reserve_id: R_A1, role: "armeiro" },
  ] as Row[] },
  lendings: { columns: ["id", "tenant_id", "reserve_id", "military_id", "status_legacy"], rows: [
    { id: "l1", tenant_id: T_A, reserve_id: R_A1, military_id: "m-a1", status_legacy: "ativo" },
    { id: "l2", tenant_id: T_A, reserve_id: R_A1, military_id: "m-a1", status_legacy: "ativo" },
    { id: "l3", tenant_id: T_A, reserve_id: R_A1, military_id: "m-a1", status_legacy: "devolvido" },
    { id: "l4", tenant_id: T_A, reserve_id: R_A2, military_id: "m-a1-a2", status_legacy: "ativo" },
    { id: "l5", tenant_id: T_A, reserve_id: R_A1, military_id: "m-a1-a2", status_legacy: "ativo" },
    { id: "l6", tenant_id: T_B, reserve_id: R_A1, military_id: "m-a1", status_legacy: "ativo" }, // mesma reserve_id, outro tenant
  ] as Row[] },
  biometric_templates: { columns: ["id", "tenant_id", "user_id", "finger_index"], rows: [
    { id: "b1", tenant_id: T_A, user_id: "m-a1", finger_index: 2 },
    { id: "b2", tenant_id: T_A, user_id: "m-a1", finger_index: 7 },
    { id: "b3", tenant_id: T_B, user_id: "m-a1", finger_index: 9 }, // outro tenant: nunca entra
  ] as Row[] },
  reserves: { columns: ["id", "nome", "tenant_id", "status"], rows: [
    { id: R_A1, nome: "Alfa", tenant_id: T_A, status: "ativa" },
    { id: R_A2, nome: "Bravo", tenant_id: T_A, status: "ativa" },
    { id: "91a30000-0000-0000-0000-0000000000a3", nome: "Inativa", tenant_id: T_A, status: "inativa" },
    { id: R_B1, nome: "Beta", tenant_id: T_B, status: "ativa" },
  ] as Row[] },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
let fake: ReturnType<typeof createFakePostgrest>;
let queried: string[] = [];
let failTable: string | null = null;
before(() => {
  fake = createFakePostgrest(tables, { reverseFk: { reserve_memberships: "user_id" } });
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
  app.route("/api/profiles", profileRoutes);
  return app;
}
type Body = { militares?: Array<Record<string, unknown> & { id: string }>; reserve_id?: string | null; reserve_options?: Array<{ id: string; nome: string }>; error?: string };
async function get(ctx: Ctx) {
  const r = await appFor(ctx).request("/api/profiles/militares");
  const text = await r.text();
  return { status: r.status, text, body: (r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null) as Body | null };
}
const ids = (b: Body | null) => (b?.militares ?? []).map((m) => m.id);

const ARM_A1: Ctx = { userId: STAFF, role: "armeiro", tenantId: T_A, reserveId: R_A1 };
const MATRIZ_A: Ctx = { userId: STAFF, role: "admin_global", tenantId: T_A, reserveId: null };

describe("R-37 lote 5 — GET /api/profiles/militares: papel efetivo, tenant e reserva", () => {
  it("A. staff A1: só quem tem membership em A1 no tenant A (sem staff, sem B, sem o do tenant B com membership em A1, sem quem não tem lotação)", async () => {
    const r = await get(ARM_A1);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(ids(r.body).sort(), ["m-a1", "m-a1-a2"]);
  });

  it("E. outra reserva do mesmo tenant: staff A1 não vê o militar exclusivo de A2", async () => {
    assert.ok(!ids((await get(ARM_A1)).body).includes("m-a2"));
    assert.deepEqual(ids((await get({ ...ARM_A1, reserveId: R_A2 })).body).sort(), ["m-a1-a2", "m-a2"]); // o fake não ordena
  });

  it("D. staff do tenant B (B1): só os de B1", async () => {
    assert.deepEqual(ids((await get({ userId: STAFF, role: "admin_reserva", tenantId: T_B, reserveId: R_B1 })).body), ["m-b1"]);
  });

  it("F. matriz (admin_global sem reserva ativa): o tenant inteiro, só role usuario, nenhum do outro tenant; opções de reserva ativas do tenant", async () => {
    const r = await get(MATRIZ_A);
    assert.equal(r.status, 200);
    assert.deepEqual(ids(r.body).sort(), ["m-a1", "m-a1-a2", "m-a2", "m-nomem"]);
    assert.deepEqual(r.body?.reserve_options?.map((o) => o.nome), ["Alfa", "Bravo"]);
    assert.equal(r.body?.reserve_id, null);
  });

  it("N2. admin_global EM filial A1: confinado à A1 e sem opções de reserva", async () => {
    const r = await get({ ...MATRIZ_A, reserveId: R_A1 });
    assert.deepEqual(ids(r.body), ["m-a1", "m-a1-a2"]);
    assert.deepEqual(r.body?.reserve_options, []);
  });

  it("opções de reserva só para admin_global em matriz", async () => {
    assert.deepEqual((await get(ARM_A1)).body?.reserve_options, []);
  });

  it("empréstimos ativos: contados por tenant e reserva (filial); a matriz conta todas as do tenant; 'devolvido' e outro tenant nunca contam", async () => {
    const filial = (await get(ARM_A1)).body!.militares!;
    assert.equal(filial.find((m) => m.id === "m-a1")!.active_count, 2);
    assert.equal(filial.find((m) => m.id === "m-a1-a2")!.active_count, 1); // l5 (A1); l4 é de A2
    const matriz = (await get(MATRIZ_A)).body!.militares!;
    assert.equal(matriz.find((m) => m.id === "m-a1-a2")!.active_count, 2);
    assert.equal(matriz.find((m) => m.id === "m-a1")!.active_count, 2);
  });

  it("digitais: só do tenant da sessão (a do tenant B, mesmo user_id, nunca entra)", async () => {
    const m = (await get(ARM_A1)).body!.militares!.find((x) => x.id === "m-a1")!;
    assert.deepEqual((m.registered_fingers as number[]).sort(), [2, 7]);
  });

  it("só os campos da página: nada de hash de senha, role, tenant ou memberships", async () => {
    const r = await get(ARM_A1);
    assert.ok(!r.text.includes("SEGREDO") && !r.text.includes("password_hash") && !r.text.includes("reserve_memberships"));
    assert.deepEqual(Object.keys(r.body!.militares![0]).sort(), [
      "account_activated_at", "active_count", "email", "foto_url", "id", "invite_sent_at", "matricula", "nome_completo", "nome_de_guerra",
      "posto", "registered_fingers", "registration_status", "telefone", "totp_configured", "unidade",
    ]);
  });

  it("B/C. papel efetivo usuario (Modo Usuário ou militar comum): 403 sem nenhuma consulta", async () => {
    const r = await get({ ...ARM_A1, role: "usuario" });
    assert.equal(r.status, 403);
    assert.deepEqual(queried, []);
  });

  it("G. sem tenant na sessão: 403, sem consulta", async () => {
    assert.equal((await get({ ...ARM_A1, tenantId: null })).status, 403);
    assert.deepEqual(queried, []);
  });

  it("staff não-matriz sem reserva ativa: lista vazia (200), sem consultar profiles", async () => {
    const r = await get({ ...ARM_A1, reserveId: null });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body?.militares, []);
    assert.ok(!queried.includes("profiles"));
  });

  it("falha na consulta de reservas (opções da matriz): 500 genérico e sem vazar", async () => {
    failTable = "reserves";
    const r = await get(MATRIZ_A);
    assert.equal(r.status, 500);
    assert.ok(!r.text.includes("secret_"));
  });

  it("filial não depende da consulta de `reserves` (usa a reserva da sessão)", async () => {
    failTable = "reserves";
    const r = await get(ARM_A1);
    assert.equal(r.status, 200);
    assert.ok(!queried.includes("reserves"));
  });

  it("auditor (fora do roleGuard) e papel ausente: 403", async () => {
    assert.equal((await get({ ...ARM_A1, role: "auditor" })).status, 403);
    assert.equal((await get({ ...ARM_A1, role: "superadmin" })).status, 403);
  });

  it("escala: >1000 militares na matriz vêm completos (paginação) e as consultas de empréstimos/digitais vão em blocos de ≤50 ids", async () => {
    const extra: Row[] = Array.from({ length: 1100 }, (_, i) => P(`bulk-${String(i).padStart(4, "0")}`, T_A));
    tables.profiles.rows.push(...extra);
    try {
      const r = await get(MATRIZ_A);
      assert.equal(r.status, 200, r.text.slice(0, 200));
      assert.equal(r.body!.militares!.length, 4 + 1100);
      const lists = fake.calls.flatMap((c) => c.filters).filter((f) => /^(military_id|user_id)=in\./.test(f));
      assert.ok(lists.length >= 2 * Math.ceil(1104 / 50));
      for (const f of lists) assert.ok(f.split(",").length <= 50, "bloco de ids grande demais");
    } finally {
      tables.profiles.rows.splice(tables.profiles.rows.length - extra.length, extra.length);
    }
  });

  it("resposta de empréstimos no teto de 1000 linhas: falha alto (500), nunca contagem truncada em silêncio", async () => {
    const extra: Row[] = Array.from({ length: 1000 }, (_, i) => ({ id: `cap-${i}`, tenant_id: T_A, reserve_id: R_A1, military_id: "m-a1", status_legacy: "ativo" }));
    tables.lendings.rows.push(...extra);
    try {
      const r = await get(ARM_A1);
      assert.equal(r.status, 500);
      assert.ok(!r.text.includes("teto"));
    } finally { tables.lendings.rows.splice(tables.lendings.rows.length - extra.length, extra.length); }
  });

  it("erro de banco em profiles/lendings/biometric_templates: 500 genérico, sem vazar o erro", async () => {
    for (const t of ["profiles", "lendings", "biometric_templates"]) {
      failTable = t; queried = [];
      const r = await get(ARM_A1);
      assert.equal(r.status, 500, t);
      assert.ok(!r.text.includes("secret_"), t);
      assert.deepEqual(r.body, { error: "Erro ao buscar usuários" });
    }
  });

  it("guarda estática: ordem determinística (nome, id), tenant e role no banco, logFailure", () => {
    const src = readFileSync(new URL("../../routes/profiles.ts", import.meta.url), "utf8");
    const chunk = src.slice(src.indexOf('"/militares"'));
    assert.match(chunk, /\.order\("nome_completo"\)\s*\.order\("id"\)\s*\.range\(/);
    assert.ok(chunk.includes('.eq("default_tenant_id", tenantId)') && chunk.includes('.eq("role", "usuario")'));
    assert.ok(chunk.includes('"profiles.militares.failure"'));
  });
});
