// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

// R-34 / R-37 lote 3 (docs/auditoria/EVIDENCE_R37_BATCH3.md): /reserva/saidas é
// página de staff. Antes lia `lendings` e `reserve_memberships` direto do
// Supabase com o JWT do usuário (RLS por profiles.role, ignora o Modo Usuário —
// D-02). Agora a autorização é o papel EFETIVO da sessão do BFF e os dados vêm de
// GET /api/lendings e GET /api/reserves/active (sessão, tenant e reserva
// aplicados no BFF, antes do limite). Handler REAL da página; só a borda é mockada.

const USER = "11111111-1111-1111-1111-111111111111";
const TENANT = "22222222-2222-2222-2222-222222222222";
const RESERVE = "33333333-3333-3333-3333-333333333333";
const state = {
  profileRole: "armeiro",
  effectiveRole: "armeiro" as string | null,
  sessionUserId: USER,
  cookie: "sealed" as string | null,
  listStatus: 200,
  listThrows: false,
  reserveStatus: 200,
  reserveThrows: false,
  reserveBody: { reserve: { id: RESERVE, nome: "Reserva Alfa", logo_url: "logos/a.png" } } as unknown,
  bffRows: [] as Array<Record<string, unknown>>,
  directRows: [] as Array<Record<string, unknown>>,
};
const directFrom = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "apmcb_session" && state.cookie ? { value: state.cookie } : undefined),
    getAll: () => [],
  }),
}));
vi.mock("@/lib/session-profile", () => ({
  getSessionUser: async () => ({ id: USER }),
  getSessionProfile: async () => ({
    role: state.profileRole, default_tenant_id: TENANT, active_reserve_id: RESERVE, nome_completo: "Armeiro Teste",
  }),
}));
// Simula o que o RLS entrega ao JWT do usuário: decide por profiles.role.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      directFrom(table);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "order", "eq", "in"]) q[m] = () => q;
      q.limit = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: state.directRows, error: null }).then(res);
      return q;
    },
  }),
}));
vi.mock("@/components/reserva/realtime-armeiro-sync", () => ({ RealtimeArmeiroSync: () => null }));
const ClientStub = vi.fn(() => null);
vi.mock("./_saidas-client", () => ({ SaidasClient: ClientStub }));

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, quantidade: 1, status_legacy: "ativo", issued_at: "2026-09-30T00:00:00Z", returned_at: null,
  local: null, notes: null, auth_mode: "totp", movement_id: null, material_request_id: null,
  material_type: { nome: "Pistola", categoria: "arma" },
  military: { id: "m1", nome_completo: "Militar", matricula: "1", posto: "Sd", foto_url: null },
  master: { nome_completo: "Armeiro", matricula: "2" },
  ...extra,
});
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(state, {
    profileRole: "armeiro", effectiveRole: "armeiro", sessionUserId: USER, cookie: "sealed",
    listStatus: 200, listThrows: false, reserveStatus: 200, reserveThrows: false,
    reserveBody: { reserve: { id: RESERVE, nome: "Reserva Alfa", logo_url: "logos/a.png" } },
    bffRows: [row("s1"), row("s2")], directRows: [row("s1"), row("s2")],
  });
  directFrom.mockClear();
  ClientStub.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/session/info")) return Response.json({ userId: state.sessionUserId, role: state.effectiveRole });
    if (u.includes("/api/lendings")) {
      if (state.listThrows) throw new Error("ECONNREFUSED");
      return state.listStatus === 200 ? Response.json(state.bffRows) : new Response("{}", { status: state.listStatus });
    }
    if (u.includes("/api/reserves/active")) {
      if (state.reserveThrows) throw new Error("ECONNREFUSED");
      return state.reserveStatus === 200 ? Response.json(state.reserveBody) : new Response("{}", { status: state.reserveStatus });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function find(tree: unknown, pred: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | null {
  const el = tree as ReactElement<{ children?: unknown }> | null;
  if (!el || typeof el !== "object") return null;
  if (pred(el as ReactElement<Record<string, unknown>>)) return el as ReactElement<Record<string, unknown>>;
  const kids = ([] as unknown[]).concat(el.props?.children ?? []);
  for (const k of kids) { const p = find(k, pred); if (p) return p; }
  return null;
}
const clientProps = (tree: unknown) => find(tree, (el) => el.type === ClientStub)?.props ?? null;
async function render(params: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  return Page({ searchParams: Promise.resolve(params) });
}
const ids = (p: Record<string, unknown> | null) => ((p?.saidas as Array<{ id: string }>) ?? []).map((o) => o.id);
const listCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/lendings"));
const reserveCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/reserves/active"));

describe("/reserva/saidas — autorização pelo papel efetivo da sessão (R-37 lote 3)", () => {
  it("A/T. STAFF_NORMAL: vê as saídas e a reserva vindas do BFF, com o cookie da sessão", async () => {
    const p = clientProps(await render());
    expect(ids(p)).toEqual(["s1", "s2"]);
    expect(p?.reserveName).toBe("Reserva Alfa");
    expect(p?.reserveId).toBe(RESERVE);
    expect(p?.tenantLogoUrl).toBe("logos/a.png");
    expect(p?.role).toBe("armeiro");
    expect(p?.armeiroName).toBe("Armeiro Teste");
    expect(listCalls()).toHaveLength(1);
    expect((listCalls()[0][1] as RequestInit).headers).toMatchObject({ cookie: "apmcb_session=sealed" });
    expect((reserveCalls()[0][1] as RequestInit).headers).toMatchObject({ cookie: "apmcb_session=sealed" });
  });

  it("B. MODE_USER: mesmo staff em Modo Usuário não recebe dados de staff (redireciona)", async () => {
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(ClientStub).not.toHaveBeenCalled();
    expect(listCalls()).toHaveLength(0);
    expect(reserveCalls()).toHaveLength(0);
  });

  it("C. USUARIO comum é redirecionado", async () => {
    state.profileRole = "usuario";
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("H. identidade da sessão do BFF diferente → nega (fail-closed)", async () => {
    state.sessionUserId = "44444444-4444-4444-4444-444444444444";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(listCalls()).toHaveLength(0);
  });

  it("G. sem sessão do BFF → nega (fail-closed)", async () => {
    state.cookie = null;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("Q. 401 do BFF na listagem → login", async () => {
    state.listStatus = 401;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/login$/);
  });

  it("R. 403 do BFF na listagem (papel caiu entre as chamadas) → redireciona, com log", async () => {
    state.listStatus = 403;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[reserva/saidas]"), expect.objectContaining({ status: 403 }));
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("S. 500 / BFF fora do ar → lista vazia com log por caso, nunca dado direto", async () => {
    for (const [name, setup] of [["500", () => { state.listStatus = 500; }], ["rede", () => { state.listThrows = true; }]] as Array<[string, () => void]>) {
      Object.assign(state, { listStatus: 200, listThrows: false });
      setup();
      ClientStub.mockClear();
      (console.warn as ReturnType<typeof vi.fn>).mockClear();
      const p = clientProps(await render());
      expect(ids(p), name).toEqual([]);
      expect(console.warn, name).toHaveBeenCalledWith(expect.stringContaining("[reserva/saidas]"), expect.anything());
    }
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("falha na consulta da reserva: a lista continua e a reserva fica indefinida, com log (captura biométrica desabilitada, como antes sem membership)", async () => {
    state.reserveStatus = 500;
    const p = clientProps(await render());
    expect(ids(p)).toEqual(["s1", "s2"]);
    expect(p?.reserveId).toBeUndefined();
    expect(p?.reserveName).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[reserva/saidas]"), expect.anything());
  });

  it("sem membership na reserva ativa (BFF devolve null): reserveId indefinido", async () => {
    state.reserveBody = { reserve: null };
    const p = clientProps(await render());
    expect(p?.reserveId).toBeUndefined();
    expect(p?.tenantLogoUrl).toBeUndefined();
  });

  it("K. pede ao BFF limit+1 e calcula hasMore sobre o que voltou; limite é ajustado a 10..30", async () => {
    state.bffRows = Array.from({ length: 11 }, (_, i) => row(`r${i}`));
    let p = clientProps(await render({ limit: "10" }));
    expect(String(listCalls()[0][0])).toContain("limit=11");
    expect(ids(p)).toHaveLength(10);
    expect(p?.hasMore).toBe(true);
    ClientStub.mockClear(); fetchMock.mockClear();
    state.bffRows = Array.from({ length: 10 }, (_, i) => row(`r${i}`));
    p = clientProps(await render({ limit: "10" }));
    expect(p?.hasMore).toBe(false);
    fetchMock.mockClear();
    await render({ limit: "500" });
    expect(String(listCalls()[0][0])).toContain("limit=31");
  });

  it("filtro de status: só ativo/devolvido chegam ao BFF", async () => {
    await render({ status: "devolvido" });
    expect(String(listCalls()[0][0])).toContain("status=devolvido");
    fetchMock.mockClear();
    await render({ status: "qualquer;coisa" });
    expect(String(listCalls()[0][0])).not.toContain("status=");
  });

  it("repassa ao cliente só os campos que ele usa (sem colunas extras do select *)", async () => {
    state.bffRows = [row("x", { tenant_id: TENANT, reserve_id: RESERVE, military_id: "m", master_id: "a", secret_internal: "x" })];
    const r = (clientProps(await render())?.saidas as Array<Record<string, unknown>>)[0];
    expect(Object.keys(r).sort()).toEqual(
      ["auth_mode", "id", "issued_at", "local", "master", "material_type", "military", "movement_id", "notes", "quantidade", "returned_at", "status_legacy"],
    );
  });

  it("M. nunca lê lendings/reserve_memberships direto do Supabase com o JWT do usuário", async () => {
    await render();
    expect(directFrom).not.toHaveBeenCalled();
  });
});

describe("guarda estática do lote 3 (R-37)", () => {
  const src = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
  it("page.tsx não cria cliente Supabase nem consulta tabelas diretamente", () => {
    expect(src).not.toMatch(/@\/lib\/supabase\/(server|client)/);
    expect(src).not.toMatch(/@supabase\//);
    expect(src).not.toMatch(/\.from\(\s*["'`]/);
  });
});
