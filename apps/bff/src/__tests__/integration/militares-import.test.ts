import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Import de militares (CSV/XLSX → linhas) + adicionar à reserva + lista "sem reserva".
// Handlers REAIS; GoTrue (fetch) e Resend simulados; banco = fake-postgrest.
process.env.RESEND_API_KEY = "re_test"; process.env.FROM_EMAIL = "no-reply@test.dev"; process.env.EMAIL_ENABLED = "true";
process.env.FRONTEND_URL = "https://app.test";

const { militaresImportRoutes } = await import("../../routes/militares-import.ts");

const T = "e1a00000-0000-0000-0000-00000000000a";
const T_B = "e1b00000-0000-0000-0000-00000000000b";
const R1 = "e1a10000-0000-0000-0000-0000000000a1"; // admin ativo
const R2 = "e1a20000-0000-0000-0000-0000000000a2"; // admin ativo
const R_PEND = "e1a30000-0000-0000-0000-0000000000a3"; // convite pendente
const R_OTHER = "e1b10000-0000-0000-0000-0000000000b1"; // outro tenant
const GLOBAL = "e1000000-0000-0000-0000-0000000000a0";
const ADM1 = "e1000000-0000-0000-0000-0000000000a1"; // admin de R1 e R2
const ADM_P = "e1000000-0000-0000-0000-0000000000a2"; // admin pendente de R_PEND
const ARM1 = "e1000000-0000-0000-0000-0000000000a3"; // armeiro de R1
const ADM_O = "e1000000-0000-0000-0000-0000000000b1";
const MIL_FREE = "e1000000-0000-0000-0000-0000000000f1"; // militar sem reserva
const MIL_IN = "e1000000-0000-0000-0000-0000000000f2";   // militar já membro de R1

const profileCols = ["id", "default_tenant_id", "role", "registration_status", "nome_completo", "matricula", "posto", "email", "invite_sent_at", "account_activated_at", "active_reserve_id", "nome_de_guerra", "unidade", "telefone", "foto_url"];
const tables = {
  profiles: { columns: profileCols, rows: [
    { id: ADM1, default_tenant_id: T, role: "admin_reserva", registration_status: "complete", matricula: "A1", email: "adm1@x.test" },
    { id: ADM_P, default_tenant_id: T, role: "admin_reserva", registration_status: "pending_biometric", matricula: "A2", email: "p@x.test", invite_sent_at: "2026-10-01T00:00:00Z", account_activated_at: null },
    { id: ARM1, default_tenant_id: T, role: "armeiro", registration_status: "complete", matricula: "A3", email: "arm@x.test" },
    { id: ADM_O, default_tenant_id: T_B, role: "admin_reserva", registration_status: "complete", matricula: "B1", email: "o@x.test" },
    { id: MIL_FREE, default_tenant_id: T, role: "usuario", registration_status: "complete", matricula: "M100", nome_completo: "Livre", email: "livre@x.test", invite_sent_at: null, account_activated_at: null },
    { id: MIL_IN, default_tenant_id: T, role: "usuario", registration_status: "complete", matricula: "M200", nome_completo: "Membro", email: "membro@x.test" },
    { id: "e1000000-0000-0000-0000-0000000000f3", default_tenant_id: T_B, role: "usuario", registration_status: "complete", matricula: "M300", nome_completo: "OutroTenant" },
  ] as Row[] },
  reserves: { columns: ["id", "nome", "acronym", "tenant_id", "status"], rows: [
    { id: R1, nome: "Alfa", acronym: "A", tenant_id: T, status: "ativa" },
    { id: R2, nome: "Bravo", acronym: "B", tenant_id: T, status: "ativa" },
    { id: R_PEND, nome: "Pendente", acronym: "P", tenant_id: T, status: "ativa" },
    { id: R_OTHER, nome: "Outra", acronym: "O", tenant_id: T_B, status: "ativa" },
  ] as Row[] },
  reserve_memberships: { columns: ["id", "user_id", "reserve_id", "role"], rows: [
    { id: "m1", user_id: ADM1, reserve_id: R1, role: "admin_reserva" },
    { id: "m2", user_id: ADM1, reserve_id: R2, role: "admin_reserva" },
    { id: "m3", user_id: ADM_P, reserve_id: R_PEND, role: "admin_reserva" },
    { id: "m4", user_id: ARM1, reserve_id: R1, role: "armeiro" },
    { id: "m5", user_id: ADM_O, reserve_id: R_OTHER, role: "admin_reserva" },
    { id: "m6", user_id: MIL_IN, reserve_id: R1, role: "usuario" },
  ] as Row[] },
  tenant_memberships: { columns: ["id", "tenant_id", "user_id", "role"], rows: [] as Row[] },
  audit_logs: { columns: ["id", "actor_id", "action", "resource_type", "resource_id", "metadata"], rows: [] as Row[] },
  notifications: { columns: ["id", "user_id", "type", "title", "body", "tenant_id", "metadata"], rows: [] as Row[] },
  tenants: { columns: ["id", "nome"], rows: [{ id: T, nome: "PMPB" }] as Row[] },
  email_log: { columns: ["id"], rows: [] as Row[] },
};
const SNAP = JSON.stringify(tables);
const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_FETCH = globalThis.fetch;
let fake: ReturnType<typeof createFakePostgrest>;
let emailsSent: string[] = [];
let authCreated = 0;
let failResend = false;
const admin = supabase.auth.admin as unknown as Record<string, unknown>;
const ORIGINAL_ADMIN = { ...admin };

before(() => {
  fake = createFakePostgrest(tables);
  supabase.from = ((t: string) => fake.from(t)) as unknown as typeof supabase.from;
  admin.getUserById = async () => ({ data: { user: { email: "x.interno@apmcb.sistema" } }, error: null });
  admin.updateUserById = async () => ({ data: {}, error: null });
  admin.generateLink = async () => ({ data: { properties: { hashed_token: "a".repeat(56) } }, error: null });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/auth/v1/admin/users") && init?.method === "POST") { authCreated++; return Response.json({ id: `e1999999-0000-0000-0000-${String(authCreated).padStart(12, "0")}` }); }
    if (u.includes("/auth/v1/admin/users") && init?.method === "DELETE") return new Response(null, { status: 200 });
    if (u.includes("api.resend.com")) {
      if (failResend) return new Response("boom", { status: 500 });
      const body = JSON.parse(String(init?.body)) as { to: string };
      emailsSent.push(body.to);
      return Response.json({ id: "rid" });
    }
    return ORIGINAL_FETCH(url as string, init);
  }) as typeof fetch;
});
after(() => { supabase.from = ORIGINAL_FROM; globalThis.fetch = ORIGINAL_FETCH; Object.assign(admin, ORIGINAL_ADMIN); });
beforeEach(() => {
  const snap = JSON.parse(SNAP) as typeof tables;
  for (const k of Object.keys(tables) as Array<keyof typeof tables>) tables[k].rows.splice(0, tables[k].rows.length, ...snap[k].rows);
  fake.calls.length = 0; emailsSent = []; authCreated = 0; failResend = false;
});

type Ctx = { userId: string; role: string; tenantId: string | null; reserveId: string | null };
function appFor(ctx: Ctx) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    c.set("userId", ctx.userId); c.set("role", ctx.role as HonoVariables["role"]);
    c.set("tenantId", ctx.tenantId); c.set("reserveId", ctx.reserveId);
    await next();
  });
  app.route("/api/admin", militaresImportRoutes);
  return app;
}
async function call(ctx: Ctx, method: string, path: string, body?: unknown) {
  const r = await appFor(ctx).request(`/api/admin${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, text, body: (r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null) as Record<string, any> | null };
}
const G: Ctx = { userId: GLOBAL, role: "admin_global", tenantId: T, reserveId: null };
const ADM: Ctx = { userId: ADM1, role: "admin_reserva", tenantId: T, reserveId: R1 };
const ARM: Ctx = { userId: ARM1, role: "armeiro", tenantId: T, reserveId: R1 };
const ROWS = [{ nome_completo: "Fulano Silva", email: "fulano@x.test", matricula: "7001" }, { nome_completo: "Beltrano Souza", email: "beltrano@x.test", matricula: "7002" }];
const profileByMat = (m: string) => tables.profiles.rows.find((p) => p.matricula === m);

describe("reserve-targets: reservas que o chamador pode alimentar", () => {
  it("admin_global: todas as ativas do tenant; admin_reserva: as que administra; armeiro: as de que é membro; nunca outro tenant", async () => {
    const g = await call(G, "GET", "/reserve-targets");
    assert.deepEqual((g.body!.reserves as Array<{ id: string }>).map((r) => r.id).sort(), [R1, R2, R_PEND].sort());
    const a = await call(ADM, "GET", "/reserve-targets");
    assert.deepEqual((a.body!.reserves as Array<{ id: string }>).map((r) => r.id).sort(), [R1, R2].sort());
    assert.equal(a.body!.default_reserve_id, R1, "reserva oficial = a ativa da sessão");
    const r = await call(ARM, "GET", "/reserve-targets");
    assert.deepEqual((r.body!.reserves as Array<{ id: string }>).map((x) => x.id), [R1]);
    assert.equal((g.body!.reserves as Array<{ id: string; admin_state: string }>).find((x) => x.id === R_PEND)!.admin_state, "pending_invite");
  });
  it("usuario/auditor/superadmin: 403; sem tenant: 403", async () => {
    for (const role of ["usuario", "auditor", "superadmin"]) assert.equal((await call({ ...G, role }, "GET", "/reserve-targets")).status, 403, role);
    assert.equal((await call({ ...G, tenantId: null }, "GET", "/reserve-targets")).status, 403);
  });
});

describe("import: CSV/XLSX → militares", () => {
  it("com reserva: cria o perfil (usuario) com e-mail de contato, vincula como membro e envia o convite automaticamente", async () => {
    const r = await call(ADM, "POST", "/militares/import", { reserve_id: R1, rows: ROWS });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body!.counts, { created_invited: 2 });
    assert.deepEqual(emailsSent.sort(), ["beltrano@x.test", "fulano@x.test"]);
    const p = profileByMat("7001")!;
    assert.deepEqual([p.role, p.default_tenant_id, p.email], ["usuario", T, "fulano@x.test"]);
    assert.ok(tables.reserve_memberships.rows.some((m) => m.user_id === p.id && m.reserve_id === R1 && m.role === "usuario"));
    assert.ok(tables.audit_logs.rows.some((a) => a.action === "admin.militares.imported"));
  });

  it("sem reserva: só cria o perfil — sem membership e sem e-mail", async () => {
    const r = await call(G, "POST", "/militares/import", { reserve_id: null, rows: ROWS });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(r.body!.counts, { created_no_reserve: 2 });
    assert.deepEqual(emailsSent, []);
    assert.equal(tables.reserve_memberships.rows.some((m) => m.user_id === profileByMat("7001")!.id), false);
  });

  it("admin_global escolhe qualquer reserva do tenant; admin_reserva/armeiro só as suas; outro tenant e inexistente → 400 igual, nada gravado", async () => {
    assert.equal((await call(G, "POST", "/militares/import", { reserve_id: R2, rows: [ROWS[0]] })).status, 200);
    tables.profiles.rows.splice(0, tables.profiles.rows.length, ...(JSON.parse(SNAP) as typeof tables).profiles.rows);
    const before = tables.profiles.rows.length;
    authCreated = 0;
    const cross = await call(ADM, "POST", "/militares/import", { reserve_id: R_OTHER, rows: ROWS });
    const ghost = await call(ADM, "POST", "/militares/import", { reserve_id: "e1ff0000-0000-0000-0000-0000000000ff", rows: ROWS });
    const notMine = await call(ARM, "POST", "/militares/import", { reserve_id: R2, rows: ROWS }); // armeiro só de R1
    for (const x of [cross, ghost, notMine]) assert.equal(x.status, 400, x.text);
    assert.deepEqual(cross.body, ghost.body);
    assert.equal(tables.profiles.rows.length, before);
    assert.equal(authCreated, 0);
  });

  it("D-04: reserva com convite do admin pendente → 409 amigável, nada criado", async () => {
    const r = await call(G, "POST", "/militares/import", { reserve_id: R_PEND, rows: ROWS });
    assert.equal(r.status, 409, r.text);
    assert.equal(r.body!.code, "pending_invite");
    assert.match(String(r.body!.error), /convite do administrador/);
    assert.equal(authCreated, 0);
    assert.equal(profileByMat("7001"), undefined);
  });

  it("linhas problemáticas viram status por linha sem derrubar o lote: matrícula existente, e-mail em uso, duplicata no arquivo", async () => {
    const rows = [
      { nome_completo: "Novo Um", email: "novo1@x.test", matricula: "8001" },
      { nome_completo: "Já Existe", email: "outro@x.test", matricula: "M100" },        // matrícula já cadastrada
      { nome_completo: "Email Usado", email: "livre@x.test", matricula: "8003" },     // e-mail já cadastrado
      { nome_completo: "Repetido", email: "novo1@x.test", matricula: "8004" },        // e-mail repetido no arquivo
      { nome_completo: "Novo Dois", email: "novo2@x.test", matricula: "8005" },
    ];
    const r = await call(ADM, "POST", "/militares/import", { reserve_id: R1, rows });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((r.body!.results as Array<{ status: string }>).map((x) => x.status), ["created_invited", "exists", "email_in_use", "duplicate_in_file", "created_invited"]);
    assert.deepEqual(emailsSent.sort(), ["novo1@x.test", "novo2@x.test"]);
  });

  it("falha do e-mail: o militar fica cadastrado e vinculado, linha 'created_invite_failed' (reenviar depois)", async () => {
    failResend = true;
    const r = await call(ADM, "POST", "/militares/import", { reserve_id: R1, rows: [ROWS[0]] });
    assert.equal(r.status, 200, r.text);
    assert.equal((r.body!.results as Array<{ status: string }>)[0].status, "created_invite_failed");
    assert.ok(profileByMat("7001"));
  });

  it("validação POR LINHA: mínimo nome + e-mail + matrícula; fórmula e tamanhos inválidos viram 'error' na linha sem derrubar o bloco; vazio e >50 linhas → 400", async () => {
    const rows = [
      { nome_completo: "A", email: "a@x.test", matricula: "1" },
      { nome_completo: "Nome Ok", email: "invalido", matricula: "2" },
      { nome_completo: "Nome Ok", email: "b@x.test", matricula: "" },
      { nome_completo: "=HYPERLINK(1)", email: "c@x.test", matricula: "3" },
      { nome_completo: "Posto Fórmula", email: "d@x.test", matricula: "4", posto: "+1" },
      { nome_completo: "Matrícula Hífen", email: "h@x.test", matricula: "-123" },
      { nome_completo: "Bom Nome", email: "bom@x.test", matricula: "9001" },
    ];
    const r = await call(ADM, "POST", "/militares/import", { reserve_id: R1, rows });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((r.body!.results as Array<{ status: string }>).map((x) => x.status), ["error", "error", "error", "error", "error", "error", "created_invited"]);
    assert.equal(authCreated, 1);
    for (const bad of [[], Array.from({ length: 51 }, (_, i) => ({ nome_completo: "Nome Ok", email: `u${i}@x.test`, matricula: `${i}` }))]) {
      assert.equal((await call(ADM, "POST", "/militares/import", { reserve_id: R1, rows: bad })).status, 400);
    }
    for (const role of ["usuario", "auditor"]) assert.equal((await call({ ...ADM, role }, "POST", "/militares/import", { reserve_id: R1, rows: ROWS })).status, 403, role);
    assert.equal((await call({ ...ADM, tenantId: null }, "POST", "/militares/import", { reserve_id: R1, rows: ROWS })).status, 403);
  });

  it("sem oráculo entre tenants: matrícula/e-mail que existem em OUTRO tenant não são reportados como 'exists'/'email_in_use' (resposta genérica)", async () => {
    const rows = [
      { nome_completo: "Colide Matrícula", email: "novo-a@x.test", matricula: "M300" },   // M300 é do tenant B
    ];
    const r = await call(ADM, "POST", "/militares/import", { reserve_id: R1, rows });
    assert.equal(r.status, 200, r.text);
    const row = (r.body!.results as Array<{ status: string; message: string }>)[0];
    assert.notEqual(row.status, "exists");
    assert.notEqual(row.status, "email_in_use");
    assert.ok(!/cadastrad/i.test(row.message), row.message);
  });

  it("falha ao vincular à reserva: sem convite e a linha não promete 'membro'", async () => {
    const realFrom = supabase.from;
    supabase.from = ((t: string) => {
      const base = realFrom(t) as unknown as Record<string, unknown>;
      if (t !== "reserve_memberships") return base as never;
      return new Proxy(base, { get: (target, k) => k === "upsert"
        ? () => ({ then: (res: (v: unknown) => void) => res({ data: null, error: { code: "XX000", message: "boom" } }) })
        : (target as Record<string | symbol, unknown>)[k] }) as never;
    }) as unknown as typeof supabase.from;
    try {
      const r = await call(ADM, "POST", "/militares/import", { reserve_id: R1, rows: [ROWS[0]] });
      assert.equal(r.status, 200, r.text);
      assert.equal((r.body!.results as Array<{ status: string }>)[0].status, "created_invite_failed");
      assert.deepEqual(emailsSent, []);
    } finally { supabase.from = realFrom; }
  });
});

describe("adicionar à reserva (depois) + filtro 'sem reserva'", () => {
  it("lista só militares do tenant SEM nenhuma reserva (nem staff nem de outro tenant)", async () => {
    const r = await call(ARM, "GET", "/militares/sem-reserva");
    assert.equal(r.status, 200, r.text);
    assert.deepEqual((r.body!.militares as Array<{ id: string }>).map((m) => m.id), [MIL_FREE]);
  });

  it("adicionar: vira membro (usuario) e o convite sai automaticamente para o e-mail do cadastro", async () => {
    const r = await call(ADM, "POST", `/militares/${MIL_FREE}/add-to-reserve`, { reserve_id: R2 });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body!.invite, "sent");
    assert.deepEqual(emailsSent, ["livre@x.test"]);
    assert.ok(tables.reserve_memberships.rows.some((m) => m.user_id === MIL_FREE && m.reserve_id === R2 && m.role === "usuario"));
    assert.equal((await call(ARM, "GET", "/militares/sem-reserva")).body!.militares.length, 0);
  });

  it("conta já ativada não recebe novo convite; sem e-mail real → invite no_email", async () => {
    tables.profiles.rows.find((p) => p.id === MIL_FREE)!.account_activated_at = "2026-09-01T00:00:00Z";
    assert.equal((await call(ADM, "POST", `/militares/${MIL_FREE}/add-to-reserve`, { reserve_id: R1 })).body!.invite, "already_active");
    assert.deepEqual(emailsSent, []);
    tables.reserve_memberships.rows.splice(tables.reserve_memberships.rows.findIndex((m) => m.user_id === MIL_FREE), 1);
    Object.assign(tables.profiles.rows.find((p) => p.id === MIL_FREE)!, { account_activated_at: null, email: null });
    assert.equal((await call(ADM, "POST", `/militares/${MIL_FREE}/add-to-reserve`, { reserve_id: R1 })).body!.invite, "no_email");
  });

  it("autoridade: armeiro só na reserva dele; admin_reserva só nas que administra; admin_global em todas do tenant; outro tenant/militar de outro tenant → negado", async () => {
    assert.equal((await call(ARM, "POST", `/militares/${MIL_FREE}/add-to-reserve`, { reserve_id: R2 })).status, 400);
    assert.equal((await call(ADM, "POST", `/militares/${MIL_FREE}/add-to-reserve`, { reserve_id: R_PEND })).status, 400);
    assert.equal((await call(ADM, "POST", `/militares/${MIL_FREE}/add-to-reserve`, { reserve_id: R_OTHER })).status, 400);
    assert.equal((await call(G, "POST", `/militares/e1000000-0000-0000-0000-0000000000f3/add-to-reserve`, { reserve_id: R1 })).status, 404, "militar de outro tenant");
    assert.equal(tables.reserve_memberships.rows.filter((m) => m.user_id === MIL_FREE).length, 0);
    assert.equal((await call(G, "POST", `/militares/${MIL_FREE}/add-to-reserve`, { reserve_id: R2 })).status, 200);
  });

  it("só entra por aqui quem está SEM reserva: militar já membro de OUTRA reserva → 409 (não é puxado)", async () => {
    const r = await call(ADM, "POST", `/militares/${MIL_IN}/add-to-reserve`, { reserve_id: R2 });
    assert.equal(r.status, 409, r.text);
    assert.match(String(r.body!.error), /já é membro de uma reserva/);
    assert.equal(tables.reserve_memberships.rows.some((m) => m.user_id === MIL_IN && m.reserve_id === R2), false);
  });

  it("D-04: reserva com convite pendente → 409 amigável; já membro → 409; alvo que não é militar (staff) → 404", async () => {
    const pend = await call(G, "POST", `/militares/${MIL_FREE}/add-to-reserve`, { reserve_id: R_PEND });
    assert.equal(pend.status, 409);
    assert.equal(pend.body!.code, "pending_invite");
    assert.equal((await call(ADM, "POST", `/militares/${MIL_IN}/add-to-reserve`, { reserve_id: R1 })).status, 409);
    assert.equal((await call(G, "POST", `/militares/${ARM1}/add-to-reserve`, { reserve_id: R1 })).status, 404);
  });

  it("papéis fora (usuario/auditor/superadmin) → 403 em todas as rotas novas, sem consulta", async () => {
    for (const role of ["usuario", "auditor", "superadmin"]) {
      fake.calls.length = 0;
      for (const [m, p, b] of [["GET", "/militares/sem-reserva"], ["POST", `/militares/${MIL_FREE}/add-to-reserve`, { reserve_id: R1 }], ["POST", "/militares/import", { reserve_id: R1, rows: ROWS }]] as Array<[string, string, unknown?]>) {
        assert.equal((await call({ ...G, role }, m, p, b)).status, 403, `${role} ${p}`);
      }
      assert.equal(fake.calls.length, 0, role);
    }
  });
});
