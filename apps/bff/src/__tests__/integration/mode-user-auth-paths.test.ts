import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { supabase } from "../../services/supabase.ts";
import { createFakePostgrest } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-28 / D-02 (docs/auditoria/EVIDENCE_R28.md): Modo Usuário é redução de
// privilégio POR SESSÃO. Handler REAL: authMiddleware + rotas reais.
// Privilégio de staff só existe dentro de uma sessão web (iron-session); um
// Bearer sem sessão não carrega o contexto operacional da sessão e não pode
// restaurar staff. Roda via bun (middleware/rotas usam imports sem extensão).

const USERS: Record<string, { id: string; role: string; tenant: string }> = {
  "tok-admin": { id: "95000000-0000-0000-0000-00000000000a", role: "admin_global", tenant: "95000000-0000-0000-0000-0000000000aa" },
  "tok-usuario": { id: "95000000-0000-0000-0000-00000000000b", role: "usuario", tenant: "95000000-0000-0000-0000-0000000000bb" },
};

// SupabaseAuthProvider captura o `fetch` global na construção (import do
// middleware) — o mock de /auth/v1/user precisa existir ANTES do import. Se
// outro arquivo tiver construído o provider antes, os casos de Bearer falham
// (401), nunca passam por engano.
const ORIGINAL_FETCH = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/auth/v1/user")) {
    const auth = new Headers(init?.headers).get("Authorization") ?? "";
    const u = USERS[auth.replace("Bearer ", "")];
    return u ? Response.json({ id: u.id, email: `${u.role}@x` }) : new Response("{}", { status: 401 });
  }
  return ORIGINAL_FETCH(input, init);
}) as typeof fetch;
const { authMiddleware } = await import("../../middleware/auth.ts");
const { dashboardRoutes } = await import("../../routes/dashboard.ts");
const { sessionRoutes } = await import("../../routes/session.ts");
const { cautelamentosRoutes } = await import("../../routes/cautelamentos.ts");

const EMPTY = ["cautelamentos", "material_items", "lendings", "audit_events", "service_handovers", "ocorrencias", "material_types"];
const tables = {
  profiles: { columns: ["id", "role", "active_reserve_id", "sessions_invalidated_at", "default_tenant_id"], rows: Object.values(USERS).map((u) => ({ id: u.id, role: u.role, active_reserve_id: null, sessions_invalidated_at: null, default_tenant_id: u.tenant })) },
  tenant_memberships: { columns: ["tenant_id", "user_id"], rows: Object.values(USERS).map((u) => ({ tenant_id: u.tenant, user_id: u.id })) },
  revoked_sessions: { columns: ["session_id"], rows: [] },
  reserves: { columns: ["id", "tenant_id"], rows: [] },
  tenant_branding: { columns: ["tenant_id", "primary_hex", "secondary_hex", "tenant_logo_url", "reserve_logo_url"], rows: [] },
  ...Object.fromEntries(EMPTY.map((t) => [t, { columns: ["id", "tenant_id", "reserve_id", "status", "status_operacional", "identificador_principal", "issued_at", "created_at", "data_ultima_conferencia", "validade_item", "lending_id", "material_type_id", "military_id", "militar_id"], rows: [] }])),
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
before(() => { const fake = createFakePostgrest(tables); supabase.from = ((t: string) => fake.from(t)) as unknown as typeof supabase.from; });
after(() => { supabase.from = ORIGINAL_FROM; globalThis.fetch = ORIGINAL_FETCH; });

const app = new Hono<{ Variables: HonoVariables }>();
app.use("*", requestIdMiddleware);
app.use("/api/dashboard/*", authMiddleware);
app.use("/api/session/*", authMiddleware);
app.use("/api/cautelamentos/*", authMiddleware);
app.route("/api/dashboard", dashboardRoutes);
app.route("/api/session", sessionRoutes);
app.route("/api/cautelamentos", cautelamentosRoutes);

let sessionSeq = 0;
async function seal(token: string, mode?: "usuario"): Promise<string> {
  const u = USERS[token];
  const req = new Request("http://localhost/seal");
  const res = new Response(null);
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  Object.assign(session, {
    userId: u.id, role: u.role as SessionData["role"], tenantId: u.tenant, reserveId: null,
    supabaseAccessToken: token, sessionId: `sess-${++sessionSeq}`, issuedAt: Date.now(),
    ...(mode ? { activeMode: "usuario", originalRole: u.role as SessionData["originalRole"] } : {}),
  } satisfies Partial<SessionData>);
  await session.save();
  return res.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`))!.split(";")[0];
}
const call = (path: string, headers: Record<string, string>) => app.request(path, { headers });
const command = (h: Record<string, string>) => call("/api/dashboard/command", h);
async function info(h: Record<string, string>) {
  const r = await call("/api/session/info", h);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

describe("R-28 / D-02 — Modo Usuário por sessão × caminhos de autenticação (authMiddleware real)", () => {
  it("STAFF_SESSION_NORMAL: admin_global por sessão → staff (200)", async () => {
    assert.equal((await command({ cookie: await seal("tok-admin") })).status, 200);
  });

  it("MODE_USER_SESSION: sessão em Modo Usuário → papel efetivo usuario (403 em rota de staff)", async () => {
    const cookie = await seal("tok-admin", "usuario");
    assert.equal((await command({ cookie })).status, 403);
    const i = await info({ cookie });
    assert.equal(i.body.role, "usuario");
    assert.equal(i.body.activeMode, "usuario");
  });

  it("MODE_USER_SESSION_PLUS_BEARER: Bearer junto da sessão em Modo Usuário não restaura staff", async () => {
    assert.equal((await command({ cookie: await seal("tok-admin", "usuario"), Authorization: "Bearer tok-admin" })).status, 403);
  });

  it("MODE_USER_BEARER_ONLY (bypass original): Bearer sem sessão não concede staff", async () => {
    // Antes: 200 com papel admin_global — Bearer sem sessão restaurava staff.
    assert.equal((await command({ Authorization: "Bearer tok-admin" })).status, 403);
    assert.equal((await info({ Authorization: "Bearer tok-admin" })).body.role, "usuario");
  });

  it("STAFF_BEARER_LEGITIMATE: Bearer segue autenticando para capacidades de usuário (ex.: branding)", async () => {
    assert.equal((await call("/api/dashboard/branding", { Authorization: "Bearer tok-admin" })).status, 200);
    assert.equal((await call("/api/dashboard/branding", { Authorization: "Bearer tok-usuario" })).status, 200);
  });

  it("TWO_SESSIONS_SAME_USER: sessão A em Modo Usuário e sessão B staff do MESMO usuário não se contaminam", async () => {
    const a = await seal("tok-admin", "usuario");
    const b = await seal("tok-admin");
    assert.equal((await command({ cookie: a })).status, 403, "A deveria continuar usuario");
    assert.equal((await command({ cookie: b })).status, 200, "B deveria continuar staff");
    assert.equal((await command({ cookie: a })).status, 403, "A, de novo, depois de B");
    assert.equal((await info({ cookie: b })).body.role, "admin_global");
  });

  it("MIXED_IDENTITY: sessão do usuário A + Bearer do admin B → só a identidade da sessão (sem mistura)", async () => {
    const cookie = await seal("tok-usuario");
    assert.equal((await command({ cookie, Authorization: "Bearer tok-admin" })).status, 403);
    const i = await info({ cookie, Authorization: "Bearer tok-admin" });
    assert.equal(i.body.userId, USERS["tok-usuario"].id);
    assert.equal(i.body.role, "usuario");
    assert.equal(i.body.originalRole, null);
  });

  it("MIXED_IDENTITY inversa: sessão staff do admin A + Bearer do usuário B → identidade/tenant só de A", async () => {
    const cookie = await seal("tok-admin");
    const i = await info({ cookie, Authorization: "Bearer tok-usuario" });
    assert.equal(i.body.userId, USERS["tok-admin"].id);
    assert.equal(i.body.role, "admin_global");
    assert.equal((await command({ cookie, Authorization: "Bearer tok-usuario" })).status, 200);
  });

  it("MODE_ENDPOINT_BEARER_ONLY: Bearer sem sessão não cria sessão de staff via POST /api/session/mode", async () => {
    // Antes: o fallback Bearer de /mode gravava uma iron-session nova com
    // profiles.role (sem sessionId) e devolvia o Set-Cookie — staff em 2 requisições.
    const r = await app.request("/api/session/mode", {
      method: "POST",
      headers: { Authorization: "Bearer tok-admin", "content-type": "application/json" },
      body: JSON.stringify({ mode: "staff" }),
    });
    assert.equal(r.status, 401);
    assert.ok(!r.headers.getSetCookie().some((v) => v.startsWith(`${sessionOptions.cookieName}=`)), "não pode emitir apmcb_session");
  });

  it("MODE_ENDPOINT_SESSION: a própria sessão entra e sai do Modo Usuário (fluxo legítimo do toggle)", async () => {
    let cookie = await seal("tok-admin");
    const post = async (mode: string) => {
      const r = await app.request("/api/session/mode", {
        method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ mode }),
      });
      const next = r.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`));
      if (next) cookie = next.split(";")[0];
      return r.status;
    };
    assert.equal(await post("usuario"), 200);
    assert.equal((await command({ cookie })).status, 403);
    assert.equal(await post("staff"), 200);
    assert.equal((await command({ cookie })).status, 200);
  });

  it("R-32: Bearer de staff (efetivo usuario) acessa as próprias cautelas em /api/cautelamentos/ativos", async () => {
    // Antes: Bearer de admin_global → papel admin_global → 403 no roleGuard
    // ("usuario","armeiro","admin_reserva") — /efetivo quebrava para admin.
    const r = await call("/api/cautelamentos/ativos", { Authorization: "Bearer tok-admin" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { cautelamentos: [] });
  });

  it("USUARIO_NORMAL: usuario por sessão e por Bearer continua usuario", async () => {
    assert.equal((await command({ cookie: await seal("tok-usuario") })).status, 403);
    assert.equal((await command({ Authorization: "Bearer tok-usuario" })).status, 403);
    assert.equal((await info({ Authorization: "Bearer tok-usuario" })).body.role, "usuario");
  });
});
