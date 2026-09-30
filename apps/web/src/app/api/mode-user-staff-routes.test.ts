// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// R-28 / D-02 / R-31: rotas de staff do servidor Next (service role / RLS)
// autorizam pelo papel EFETIVO da sessão web — Modo Usuário vale aqui também.
// Antes: autorizavam por profiles.role, e uma sessão em Modo Usuário seguia
// criando usuário/material como staff. Handlers reais; só a borda é mockada
// (cookies, Supabase SSR e o GET /api/session/info do BFF).

const USER = "33333333-3333-3333-3333-333333333333";
const OTHER = "44444444-4444-4444-4444-444444444444";
const state = {
  profileRole: "admin_global",
  info: null as null | { userId: string; role: string },
  cookie: "sealed" as string | null,
};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "apmcb_session" && state.cookie ? { value: state.cookie } : undefined),
    getAll: () => [],
  }),
}));

vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: () => ({ env: {} }) }));

// Chain PostgREST mínimo: profiles devolve o papel "global"; o resto, vazio.
function chain(table: string) {
  const result =
    table === "profiles"
      ? { data: { role: state.profileRole, default_tenant_id: "t", active_reserve_id: "r" }, error: null }
      : { data: [], error: null, count: 5 };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "lte", "or", "limit", "order", "ilike"]) q[m] = () => q;
  q.single = async () => result;
  q.maybeSingle = async () => result;
  q.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return q;
}
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from: chain,
  }),
}));

beforeEach(() => {
  state.profileRole = "admin_global";
  state.info = null;
  state.cookie = "sealed";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).endsWith("/api/session/info") && state.info) return Response.json(state.info);
    return new Response("{}", { status: 401 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const post = (path: string, body: unknown) =>
  new NextRequest(`https://apmcb.pmpb.online${path}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const get = (path: string) => new NextRequest(`https://apmcb.pmpb.online${path}`);

async function callAll() {
  const users = await import("./admin/users/route");
  const almox = await import("./admin/almoxarifado/route");
  const search = await import("./admin/search-profiles/route");
  const aging = await import("./reserva/aging-count/route");
  const u = await users.POST(post("/api/admin/users", {}));
  const a = await almox.POST(post("/api/admin/almoxarifado", {}));
  const s = await search.GET(get("/api/admin/search-profiles?q=x"));
  const g = await aging.GET();
  return { users: u.status, almox: a.status, search: s.status, aging: (await g.json()) as { count: number } };
}

describe("R-31 — rotas de staff do Next respeitam o Modo Usuário da sessão", () => {
  it("STAFF (sessão sem Modo Usuário): passa do gate de papel", async () => {
    state.profileRole = "admin_reserva";
    state.info = { userId: USER, role: "admin_reserva" };
    const r = await callAll();
    expect(r.users).toBe(400); // passou do 403; parou na validação do body vazio
    expect(r.almox).toBe(400);
    expect(r.search).toBe(200);
    expect(r.aging.count).toBe(5);
  });

  it("MODE_USER_WEB_FLOW: profiles.role staff, sessão em Modo Usuário → nega", async () => {
    state.profileRole = "admin_reserva";
    state.info = { userId: USER, role: "usuario" };
    const r = await callAll();
    expect(r.users).toBe(403);
    expect(r.almox).toBe(403);
    expect(r.search).toBe(403);
    expect(r.aging.count).toBe(0);
  });

  it("MIXED_IDENTITY: sessão do BFF de outra identidade → nega (não mistura)", async () => {
    state.profileRole = "admin_reserva";
    state.info = { userId: OTHER, role: "admin_reserva" };
    const r = await callAll();
    expect([r.users, r.almox, r.search]).toEqual([403, 403, 403]);
    expect(r.aging.count).toBe(0);
  });

  it("sem sessão do BFF (só sb-*) → nega, fail-closed", async () => {
    state.profileRole = "admin_reserva";
    state.cookie = null;
    const r = await callAll();
    expect([r.users, r.almox, r.search]).toEqual([403, 403, 403]);
    expect(r.aging.count).toBe(0);
  });
});
