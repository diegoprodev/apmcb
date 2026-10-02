import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// D-04 (docs/auditoria/EVIDENCE_D04_RESERVE_REQUIRES_ADMIN.md): uma reserva não
// pode ser criada sem um admin_reserva; só pode ser acessada se tiver um; e o
// último admin de uma reserva não pode ser rebaixado/removido. Handlers REAIS.

const { adminRoutes } = await import("../../routes/admin.ts");
const { reservesRoutes } = await import("../../routes/reserves.ts");
const { profileRoutes } = await import("../../routes/profiles.ts");
const { nexusRoutes } = await import("../../routes/nexus.ts");
const { arsenalRoutes } = await import("../../routes/arsenal.ts");
const { reservesWithoutOtherAdmin, onlyReservesWithAdmin } = await import("../../lib/reserve-admin.ts");

const T_A = "d4a00000-0000-0000-0000-00000000000a";
const T_B = "d4b00000-0000-0000-0000-00000000000b";
const R_OK = "d4a10000-0000-0000-0000-0000000000a1";
const R_NOADMIN = "d4a20000-0000-0000-0000-0000000000a2";
const R_TWO = "d4a30000-0000-0000-0000-0000000000a3";
const U_GLOBAL = "d4000000-0000-0000-0000-0000000000a0";
const ADM1 = "d4000000-0000-0000-0000-0000000000a1"; // único admin de R_OK
const ADM2 = "d4000000-0000-0000-0000-0000000000a2"; // um dos dois de R_TWO
const ADM3 = "d4000000-0000-0000-0000-0000000000a3"; // o outro de R_TWO
const ARM = "d4000000-0000-0000-0000-0000000000a4";
const ADM_B = "d4000000-0000-0000-0000-0000000000b1";
const R_PENDING = "d4a40000-0000-0000-0000-0000000000a4"; // único admin = convite ainda não aceito
const R_SUSP = "d4a50000-0000-0000-0000-0000000000a5";    // único admin = conta inativa
const ADM_PEND = "d4000000-0000-0000-0000-0000000000c1";
const ADM_SUSP = "d4000000-0000-0000-0000-0000000000c2";

const tables = {
  admin_approval_requests: { columns: ["id", "status", "requestor_id", "material_type_id", "type", "payload"], rows: [
    { id: "req1", status: "pendente", requestor_id: ADM_PEND, material_type_id: null, type: "material_addition", payload: {} },
  ] as Row[] },
  tenants: { columns: ["id", "max_reserves"], rows: [{ id: T_A, max_reserves: 50 }] as Row[] },
  audit_logs: { columns: ["id", "action"], rows: [] as Row[] },
  profiles: {
    columns: ["id", "default_tenant_id", "role", "registration_status", "active_reserve_id", "invite_sent_at", "account_activated_at"],
    rows: [
      { id: ADM1, default_tenant_id: T_A, role: "admin_reserva", registration_status: "complete", active_reserve_id: null },
      { id: ADM2, default_tenant_id: T_A, role: "admin_reserva", registration_status: "complete", active_reserve_id: null },
      { id: ADM3, default_tenant_id: T_A, role: "admin_reserva", registration_status: "complete", active_reserve_id: null },
      { id: ARM, default_tenant_id: T_A, role: "armeiro", registration_status: "complete", active_reserve_id: null },
      { id: ADM_B, default_tenant_id: T_B, role: "admin_reserva", registration_status: "complete", active_reserve_id: null },
      { id: ADM_PEND, default_tenant_id: T_A, role: "admin_reserva", registration_status: "pending_biometric", active_reserve_id: null, invite_sent_at: "2026-10-01T00:00:00Z", account_activated_at: null },
      { id: ADM_SUSP, default_tenant_id: T_A, role: "admin_reserva", registration_status: "inactive", active_reserve_id: null, invite_sent_at: "2026-09-01T00:00:00Z", account_activated_at: "2026-09-02T00:00:00Z" },
    ] as Row[],
  },
  reserves: {
    columns: ["id", "nome", "acronym", "tenant_id", "status", "org_unit_id"],
    rows: [
      { id: R_OK, nome: "OK", acronym: "OK", tenant_id: T_A, status: "ativa", org_unit_id: null },
      { id: R_NOADMIN, nome: "Sem admin", acronym: "SA", tenant_id: T_A, status: "ativa", org_unit_id: null },
      { id: R_TWO, nome: "Dois", acronym: "D2", tenant_id: T_A, status: "ativa", org_unit_id: null },
      { id: R_PENDING, nome: "Pendente", acronym: "PE", tenant_id: T_A, status: "ativa", org_unit_id: null },
      { id: R_SUSP, nome: "Suspenso", acronym: "SU", tenant_id: T_A, status: "ativa", org_unit_id: null },
    ] as Row[],
  },
  reserve_memberships: {
    columns: ["id", "user_id", "reserve_id", "role"],
    rows: [
      { id: "m1", user_id: ADM1, reserve_id: R_OK, role: "admin_reserva" },
      { id: "m2", user_id: ARM, reserve_id: R_NOADMIN, role: "armeiro" },
      { id: "m3", user_id: ADM2, reserve_id: R_TWO, role: "admin_reserva" },
      { id: "m4", user_id: ADM3, reserve_id: R_TWO, role: "admin_reserva" },
      { id: "m5", user_id: ARM, reserve_id: R_OK, role: "armeiro" },
      { id: "m6", user_id: ADM_PEND, reserve_id: R_PENDING, role: "admin_reserva" },
      { id: "m7", user_id: ADM_SUSP, reserve_id: R_SUSP, role: "admin_reserva" },
    ] as Row[],
  },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
let fake: ReturnType<typeof createFakePostgrest>;
let failTable: string | null = null;
let failOp: string | null = null;
let deletes: string[] = [];
before(() => {
  fake = createFakePostgrest(tables);
  supabase.from = ((t: string) => {
    const base = fake.from(t) as Record<string, unknown>;
    const failing = (): unknown => {
      const f: unknown = new Proxy({}, { get: (_t, k) => k === "then"
        ? (res: (v: unknown) => void) => res({ data: null, error: { code: "XX000", message: `relation secret_${t} exploded` } })
        : () => f });
      return f;
    };
    if (failTable === t && failOp === null) return failing();
    return new Proxy(base, { get: (target, k) => {
      if (k === "insert" && failTable === t && failOp === "insert") return () => failing();
      if (k === "delete") return () => {
        deletes.push(t);
        const q: Record<string, unknown> = {};
        const chain = (): unknown => new Proxy(q, { get: (_x, kk) => kk === "then" ? (res: (v: unknown) => void) => res({ data: null, error: null }) : () => chain() });
        return chain();
      };
      return (target as Record<string | symbol, unknown>)[k];
    } });
  }) as unknown as typeof supabase.from;
});
after(() => { supabase.from = ORIGINAL_FROM; });
const SNAPSHOT = JSON.stringify({ p: tables.profiles.rows, r: tables.reserves.rows, m: tables.reserve_memberships.rows, a: tables.admin_approval_requests.rows });
beforeEach(() => {
  failTable = null; failOp = null; deletes = [];
  const snap = JSON.parse(SNAPSHOT) as { p: Row[]; r: Row[]; m: Row[]; a: Row[] };
  tables.admin_approval_requests.rows.splice(0, tables.admin_approval_requests.rows.length, ...snap.a);
  tables.profiles.rows.splice(0, tables.profiles.rows.length, ...snap.p);
  tables.reserves.rows.splice(0, tables.reserves.rows.length, ...snap.r);
  tables.reserve_memberships.rows.splice(0, tables.reserve_memberships.rows.length, ...snap.m);
  fake.calls.length = 0;
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
  app.route("/api/admin", adminRoutes);
  app.route("/api/reserves", reservesRoutes);
  app.route("/api/profiles", profileRoutes);
  app.route("/api/nexus", nexusRoutes);
  app.route("/api/arsenal", arsenalRoutes);
  return app;
}
const GLOBAL: Ctx = { userId: U_GLOBAL, role: "admin_global", tenantId: T_A, reserveId: null };
const NEXUS: Ctx = { userId: U_GLOBAL, role: "superadmin", tenantId: null, reserveId: null };
async function nexusCookie(): Promise<string> {
  const res = new Response(null);
  const session = await getIronSession<SessionData>(new Request("http://localhost/seal"), res, sessionOptions);
  Object.assign(session, { nexusAuthorized: true, nexusAuthorizedAt: Date.now() });
  await session.save();
  return res.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`))!.split(";")[0];
}
async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (ctx.role === "superadmin") headers.cookie = await nexusCookie();
  const r = await appFor(ctx).request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, text, body: (r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null) as Record<string, unknown> | null };
}
const inserts = (t: string) => fake.calls.filter((c) => c.table === t && c.select === "insert").length;

describe("D-04 — criar reserva exige admin_reserva", () => {
  it("sem admin_reserva_id: 400 (validação), nada gravado", async () => {
    const r = await send(GLOBAL, "POST", "/api/admin/reserves", { nome: "Nova" });
    assert.equal(r.status, 400);
    assert.equal(inserts("reserves"), 0);
  });

  it("admin válido do tenant: 201, reserva e membership admin_reserva criadas", async () => {
    const r = await send(GLOBAL, "POST", "/api/admin/reserves", { nome: "Nova", admin_reserva_id: ADM1 });
    assert.equal(r.status, 201, r.text);
    const rid = (r.body!.reserve as { id?: string }).id!;
    const m = tables.reserve_memberships.rows.find((x) => x.reserve_id === rid);
    assert.deepEqual([m?.user_id, m?.role], [ADM1, "admin_reserva"]);
  });

  it("admin de OUTRO tenant, armeiro (papel errado) ou inexistente: 422, sem escrita", async () => {
    for (const id of [ADM_B, ARM, "d4000000-0000-0000-0000-0000000000ff"]) {
      const r = await send(GLOBAL, "POST", "/api/admin/reserves", { nome: "Nova", admin_reserva_id: id });
      assert.equal(r.status, 422, id);
    }
    assert.equal(inserts("reserves"), 0);
    assert.equal(inserts("reserve_memberships"), 0);
  });

  it("falha ao gravar a membership: a reserva é desfeita (nunca fica reserva sem admin) e responde 500 sem vazar o erro", async () => {
    failTable = "reserve_memberships"; failOp = "insert";
    const r = await send(GLOBAL, "POST", "/api/admin/reserves", { nome: "Nova", admin_reserva_id: ADM1 });
    assert.equal(r.status, 500);
    assert.ok(!r.text.includes("secret_"));
    assert.deepEqual(deletes, ["reserves"]);
  });

  it("erro de banco ao validar o admin: 500, sem criar a reserva", async () => {
    failTable = "profiles";
    const r = await send(GLOBAL, "POST", "/api/admin/reserves", { nome: "Nova", admin_reserva_id: ADM1 });
    assert.equal(r.status, 500);
    assert.ok(!r.text.includes("secret_"));
    assert.equal(inserts("reserves"), 0);
  });
});

describe("D-04 — reserva sem admin_reserva não é acessível", () => {
  it("switch para reserva sem admin_reserva: 409 para armeiro membro E para admin_global", async () => {
    assert.equal((await send({ userId: ARM, role: "armeiro", tenantId: T_A, reserveId: null }, "POST", `/api/reserves/switch/${R_NOADMIN}`)).status, 409);
    assert.equal((await send(GLOBAL, "POST", `/api/reserves/switch/${R_NOADMIN}`)).status, 409);
  });

  it("switch para reserva COM admin_reserva não é barrado pela regra", async () => {
    const r = await send({ userId: ARM, role: "armeiro", tenantId: T_A, reserveId: null }, "POST", `/api/reserves/switch/${R_OK}`);
    assert.notEqual(r.status, 409, r.text);
    assert.notEqual(r.status, 403, r.text);
  });

  it("falha ao consultar os admins: 500 fail-closed (não libera, não diz 'sem admin')", async () => {
    failTable = "reserve_memberships";
    const r = await send(GLOBAL, "POST", `/api/reserves/switch/${R_OK}`);
    assert.equal(r.status, 500);
    assert.ok(!r.text.includes("secret_"));
  });
});

describe("D-04 — o último admin_reserva não pode ser rebaixado nem removido", () => {
  it("helper: reservesWithoutOtherAdmin respeita o excluído", async () => {
    assert.deepEqual(await reservesWithoutOtherAdmin([R_OK, R_TWO, R_NOADMIN], ADM1), [R_OK, R_NOADMIN]);
    assert.deepEqual(await reservesWithoutOtherAdmin([R_TWO], ADM2), []);
    assert.deepEqual(await reservesWithoutOtherAdmin([], ADM1), []);
  });

  it("rebaixar o único admin de R_OK: 409, perfil intacto", async () => {
    const r = await send(GLOBAL, "PATCH", `/api/profiles/${ADM1}`, { role: "armeiro" });
    assert.equal(r.status, 409, r.text);
    assert.equal(tables.profiles.rows.find((p) => p.id === ADM1)!.role, "admin_reserva");
  });

  it("rebaixar um dos DOIS admins de R_TWO: a guarda não barra", async () => {
    const r = await send(GLOBAL, "PATCH", `/api/profiles/${ADM2}`, { role: "armeiro" });
    assert.notEqual(r.status, 409, r.text);
  });

  it("erro de banco na guarda: 500 fail-closed, perfil intacto", async () => {
    failTable = "reserve_memberships";
    const r = await send(GLOBAL, "PATCH", `/api/profiles/${ADM1}`, { role: "armeiro" });
    assert.equal(r.status, 500);
    assert.equal(tables.profiles.rows.find((p) => p.id === ADM1)!.role, "admin_reserva");
  });

  it("convite pendente: switch 409 amigável (code pending_invite); conta inativa: 409 no_admin", async () => {
    const pend = await send(GLOBAL, "POST", `/api/reserves/switch/${R_PENDING}`);
    assert.equal(pend.status, 409);
    assert.equal(pend.body!.code, "pending_invite");
    assert.match(String(pend.body!.error), /convite do administrador da reserva ainda não foi aceito/);
    const susp = await send(GLOBAL, "POST", `/api/reserves/switch/${R_SUSP}`);
    assert.equal(susp.status, 409);
    assert.equal(susp.body!.code, "no_admin");
  });

  it("aceite do convite libera a reserva (account_activated_at preenchido)", async () => {
    tables.profiles.rows.find((p) => p.id === ADM_PEND)!.account_activated_at = "2026-10-02T00:00:00Z";
    const r = await send({ userId: ARM, role: "armeiro", tenantId: T_A, reserveId: null }, "POST", `/api/reserves/switch/${R_PENDING}`);
    assert.notEqual(r.status, 409, r.text);
  });

  it("reserva com convite pendente: não recebe membro (PATCH reserve_ids, convite com reserve_id, Nexus), mas o admin_reserva pode ser adicionado", async () => {
    const add = await send(GLOBAL, "PATCH", `/api/profiles/${ARM}`, { reserve_ids: [R_OK, R_PENDING] });
    assert.equal(add.status, 409, add.text);
    assert.equal(add.body!.code, "pending_invite");
    const inv = await send(GLOBAL, "POST", "/api/admin/users/invite", { email: "x@y.test", role: "armeiro", reserve_id: R_PENDING });
    assert.equal(inv.status, 409, inv.text);
    const nx = await send(NEXUS, "POST", `/api/nexus/reserves/${R_PENDING}/members`, { user_id: ARM, role: "armeiro" });
    assert.equal(nx.status, 409, nx.text);
    const nxAdmin = await send(NEXUS, "POST", `/api/nexus/reserves/${R_PENDING}/members`, { user_id: ADM1, role: "admin_reserva" });
    assert.notEqual(nxAdmin.status, 409, nxAdmin.text);
  });

  it("reserva com convite pendente: aprovar solicitação (que cria material) é 409 antes de reivindicar", async () => {
    const r = await send({ userId: ADM1, role: "admin_reserva", tenantId: T_A, reserveId: R_PENDING }, "PATCH", "/api/arsenal/requests/req1/approve", {});
    assert.equal(r.status, 409, r.text);
    assert.equal(r.body!.code, "pending_invite");
    assert.equal(tables.admin_approval_requests.rows[0].status, "pendente");
  });

  it("A1. PATCH com role + reserve_ids para reserva pendente: 409 SEM escrita parcial (perfil e memberships intactos)", async () => {
    const before = JSON.stringify(tables.reserve_memberships.rows);
    const r = await send(GLOBAL, "PATCH", `/api/profiles/${ARM}`, { role: "armeiro", registration_status: "complete", reserve_ids: [R_PENDING] });
    assert.equal(r.status, 409, r.text);
    assert.equal(fake.calls.filter((c) => c.select === "update" || c.select === "insert").length, 0, "nenhuma escrita antes do gate");
    assert.equal(JSON.stringify(tables.reserve_memberships.rows), before);
  });

  it("A2. aprovar material_addition com payload.reserve_id de reserva pendente (admin sem reserva ativa/matriz): 409 antes do claim; outros tipos não são barrados", async () => {
    Object.assign(tables.admin_approval_requests.rows[0], { payload: { reserve_id: R_PENDING }, requestor_id: ADM1 });
    const r = await send({ userId: U_GLOBAL, role: "admin_reserva", tenantId: T_A, reserveId: R_OK }, "PATCH", "/api/arsenal/requests/req1/approve", {});
    assert.equal(r.status, 409, r.text);
    assert.equal(r.body!.code, "pending_invite");
    assert.equal(tables.admin_approval_requests.rows[0].status, "pendente");
    tables.admin_approval_requests.rows[0].type = "stock_adjustment";
    const other = await send({ userId: ADM1, role: "admin_reserva", tenantId: T_A, reserveId: R_PENDING }, "PATCH", "/api/arsenal/requests/req1/approve", {});
    assert.notEqual(other.body?.code, "pending_invite", other.text);
  });

  it("A3. /users/invite: reserva de OUTRO tenant ou inexistente → 400 sem oráculo (mesma resposta), nada gravado; armeiro não escolhe reserva pelo corpo", async () => {
    const mkRes = (id: string, tenant: string) => tables.reserves.rows.push({ id, nome: "Outro", acronym: "OT", tenant_id: tenant, status: "ativa", org_unit_id: null });
    mkRes("d4b90000-0000-0000-0000-0000000000b9", T_B);
    const cross = await send(GLOBAL, "POST", "/api/admin/users/invite", { email: "x@y.test", role: "armeiro", reserve_id: "d4b90000-0000-0000-0000-0000000000b9" });
    const ghost = await send(GLOBAL, "POST", "/api/admin/users/invite", { email: "x@y.test", role: "armeiro", reserve_id: "d4ff0000-0000-0000-0000-0000000000ff" });
    assert.equal(cross.status, 400, cross.text);
    assert.deepEqual(cross.body, ghost.body);
    assert.equal(inserts("reserve_memberships"), 0);
    // armeiro: o reserve_id do corpo (pendente) é ignorado — vale a reserva ativa da sessão (R_OK, ok): não vira 409 por R_PENDING
    const arm = await send({ userId: ARM, role: "armeiro", tenantId: T_A, reserveId: R_OK }, "POST", "/api/admin/users/invite", { email: "x@y.test", role: "usuario", reserve_id: R_PENDING });
    assert.notEqual(arm.body?.code, "pending_invite", arm.text);
  });

  it("A3b. /users/invite por admin_reserva/armeiro: sem reserva ativa → 400; reserva ativa onde NÃO é admin/membro (switch aceita qualquer membership) → 400, nada gravado", async () => {
    const inv = (ctx: Ctx) => send(ctx, "POST", "/api/admin/users/invite", { email: "x@y.test", role: "usuario" });
    assert.equal((await inv({ userId: ADM1, role: "admin_reserva", tenantId: T_A, reserveId: null })).status, 400);
    assert.equal((await inv({ userId: ADM1, role: "admin_reserva", tenantId: T_A, reserveId: R_TWO })).status, 400); // ADM1 é admin só de R_OK
    assert.equal((await inv({ userId: ARM, role: "armeiro", tenantId: T_A, reserveId: R_TWO })).status, 400); // ARM não é membro de R_TWO
    assert.equal(inserts("reserve_memberships"), 0);
  });

  it("M2. admin legado com cadastro 'complete' e convite reenviado (sem account_activated_at) continua ATIVO", async () => {
    const p = tables.profiles.rows.find((x) => x.id === ADM1)!;
    Object.assign(p, { invite_sent_at: "2026-10-01T00:00:00Z", account_activated_at: null });
    const r = await send({ userId: ARM, role: "armeiro", tenantId: T_A, reserveId: null }, "POST", `/api/reserves/switch/${R_OK}`);
    assert.notEqual(r.status, 409, r.text);
  });

  it("M3. remover/rebaixar o ÚNICO admin PENDENTE (convite errado) é permitido; o único ATIVO continua protegido", async () => {
    const del = await send(NEXUS, "DELETE", `/api/nexus/reserves/${R_PENDING}/members/${ADM_PEND}`);
    assert.equal(del.status, 200, del.text);
    const demote = await send(GLOBAL, "PATCH", `/api/profiles/${ADM_PEND}`, { role: "armeiro" });
    assert.notEqual(demote.status, 409, demote.text);
    assert.equal((await send(GLOBAL, "PATCH", `/api/profiles/${ADM1}`, { role: "armeiro" })).status, 409);
  });

  it("erro de banco ao validar o estado do admin: 500 fail-closed nos gates", async () => {
    failTable = "reserve_memberships";
    const nx = await send(NEXUS, "POST", `/api/nexus/reserves/${R_OK}/members`, { user_id: ARM, role: "armeiro" });
    assert.equal(nx.status, 500);
  });

  it("A1. rebaixar X e depois Y (admins de R_TWO): o 1º passa, o 2º é 409 — a membership de X não sobra como cobertura fantasma", async () => {
    const first = await send(GLOBAL, "PATCH", `/api/profiles/${ADM2}`, { role: "armeiro" });
    assert.notEqual(first.status, 409, first.text);
    assert.equal(tables.profiles.rows.find((p) => p.id === ADM2)!.role, "armeiro");
    assert.equal(tables.reserve_memberships.rows.find((m) => m.id === "m3")!.role, "armeiro", "membership de X rebaixada junto");
    const second = await send(GLOBAL, "PATCH", `/api/profiles/${ADM3}`, { role: "armeiro" });
    assert.equal(second.status, 409, second.text);
    assert.equal(tables.profiles.rows.find((p) => p.id === ADM3)!.role, "admin_reserva");
  });

  it("A1. membership 'admin_reserva' de quem já NÃO é admin (perfil rebaixado) não cobre a reserva (helper)", async () => {
    tables.profiles.rows.find((p) => p.id === ADM2)!.role = "armeiro"; // membership m3 continua admin_reserva
    try {
      assert.deepEqual(await reservesWithoutOtherAdmin([R_TWO], ADM3), [R_TWO]);
      assert.deepEqual(await reservesWithoutOtherAdmin([R_TWO], null), []);
    } finally { tables.profiles.rows.find((p) => p.id === ADM2)!.role = "admin_reserva"; }
  });

  it("A2. login/exchange: só reservas com admin_reserva podem ser a reserva ativa", async () => {
    const ms = [
      { reserve_id: R_OK, created_at: "2026-01-01" },
      { reserve_id: R_NOADMIN, created_at: "2025-01-01" }, // a mais antiga, mas sem admin
    ];
    assert.deepEqual(await onlyReservesWithAdmin(ms), [ms[0]]);
    assert.deepEqual(await onlyReservesWithAdmin([ms[1]]), []);
  });

  it("A3. Nexus cria reserva: exige admin_reserva_id válido do tenant; cria membership; desfaz se a membership falhar", async () => {
    const path = `/api/nexus/tenants/${T_A}/reserves`;
    const base = { nome: "Nexus Reserva", acronym: "NX" };
    assert.equal((await send(NEXUS, "POST", path, base)).status, 400);
    for (const id of [ADM_B, ARM]) assert.equal((await send(NEXUS, "POST", path, { ...base, admin_reserva_id: id })).status, 422, id);
    assert.equal(inserts("reserves"), 0);
    const ok = await send(NEXUS, "POST", path, { ...base, admin_reserva_id: ADM1 });
    assert.equal(ok.status, 201, ok.text);
    const rid = (ok.body!.reserve as { id: string }).id;
    assert.equal(tables.reserve_memberships.rows.find((m) => m.reserve_id === rid)?.role, "admin_reserva");
    failTable = "reserve_memberships"; failOp = "insert"; deletes = [];
    const bad = await send(NEXUS, "POST", path, { ...base, acronym: "NY", admin_reserva_id: ADM1 });
    assert.equal(bad.status, 500);
    assert.deepEqual(deletes, ["reserves"]);
  });

  it("A4a. Nexus remove membro: o último admin_reserva é 409 e nada é gravado; um dos dois pode sair; armeiro sai", async () => {
    const del = (rid: string, uid: string) => send(NEXUS, "DELETE", `/api/nexus/reserves/${rid}/members/${uid}`);
    assert.equal((await del(R_OK, ADM1)).status, 409);
    assert.equal((await del(R_TWO, ADM2)).status, 200);
    assert.equal((await del(R_OK, ARM)).status, 200);
    failTable = "reserve_memberships";
    assert.equal((await del(R_OK, ADM1)).status, 500);
  });

  it("A4b. excluir reserva: o admin_reserva obrigatório não bloqueia (só outro staff bloqueia)", () => {
    const src = readFileSync(new URL("../../routes/admin.ts", import.meta.url), "utf8");
    assert.ok(src.includes('STAFF_RESERVE_ROLES.filter((r) => r !== "admin_reserva")'));
  });

  it("guarda estática: wiring nos três pontos", () => {
    const rd = (f: string) => readFileSync(new URL(`../../routes/${f}`, import.meta.url), "utf8");
    assert.ok(rd("admin.ts").includes("admin_reserva_id: z.string().uuid()"));
    assert.ok(rd("reserves.ts").includes("reserveNotOperable(reserve.id)"));
    assert.ok(rd("profiles.ts").includes("reservesWithoutOtherAdmin("));
    assert.equal((rd("auth.ts").match(/onlyReservesWithAdmin\(/g) ?? []).length, 2, "login e exchange");
    assert.ok(rd("nexus.ts").includes("admin_reserva_id: z.string().uuid()"));
  });
});
