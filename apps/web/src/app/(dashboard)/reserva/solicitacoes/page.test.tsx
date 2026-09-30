// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

// R-34 / R-37 lote 2 (docs/auditoria/EVIDENCE_R37_BATCH2.md): /reserva/solicitacoes
// é página de staff. Antes lia `material_requests` direto do Supabase com o JWT
// do usuário (RLS por profiles.role, ignora o Modo Usuário — D-02). Agora a
// autorização é o papel EFETIVO da sessão do BFF e os dados vêm de
// GET /api/ssa/requests (sessão, tenant e reserva aplicados no BFF, antes do
// limite). Handler REAL da página; só a borda é mockada.

const USER = "11111111-1111-1111-1111-111111111111";
const TENANT = "22222222-2222-2222-2222-222222222222";
const state = {
  profileRole: "armeiro",
  effectiveRole: "armeiro" as string | null,
  sessionUserId: USER,
  cookie: "sealed" as string | null,
  listStatus: 200,
  listThrows: false,
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
  getSessionProfile: async () => ({ role: state.profileRole, default_tenant_id: TENANT }),
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
vi.mock("./_solicitacoes-client", () => ({ SolicitacoesClient: ClientStub }));

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: "pendente", notes: null, denial_reason: null, armeiro_nota: null,
  remote_reason: null, is_external_request: false, reserve_id: "r", tenant_id: TENANT,
  cancellation_reason: null, totp_validated: true, requested_at: "2026-09-30T00:00:00Z",
  approved_at: null, rejected_at: null, delivered_at: null, cancelled_at: null, expires_at: null,
  military: { id: "m", nome_completo: "M", posto: null, matricula: "1" },
  reserva: null, items: [],
  ...extra,
});
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(state, {
    profileRole: "armeiro", effectiveRole: "armeiro", sessionUserId: USER, cookie: "sealed",
    listStatus: 200, listThrows: false,
    bffRows: [row("staff-1"), row("staff-2")], directRows: [row("staff-1"), row("staff-2")],
  });
  directFrom.mockClear();
  ClientStub.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith("/api/session/info")) {
      return Response.json({ userId: state.sessionUserId, role: state.effectiveRole });
    }
    if (String(url).includes("/api/ssa/requests")) {
      if (state.listThrows) throw new Error("ECONNREFUSED");
      return state.listStatus === 200 ? Response.json(state.bffRows) : new Response("{}", { status: state.listStatus });
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
const hasErrorBanner = (tree: unknown) =>
  !!find(tree, (el) => typeof el.props?.children === "string" && (el.props.children as string).includes("Não foi possível carregar as solicitações"));
async function render(params: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  return Page({ searchParams: Promise.resolve(params) });
}
const ids = (p: Record<string, unknown> | null) =>
  ((p?.initialRequests as Array<{ id: string }>) ?? []).map((o) => o.id);
const listCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/ssa/requests"));

describe("/reserva/solicitacoes — autorização pelo papel efetivo da sessão (R-37 lote 2)", () => {
  it("A/N. STAFF_NORMAL: vê as solicitações vindas do BFF, com o cookie da sessão", async () => {
    const tree = await render();
    expect(ids(clientProps(tree))).toEqual(["staff-1", "staff-2"]);
    expect(listCalls()).toHaveLength(1);
    expect((listCalls()[0][1] as RequestInit).headers).toMatchObject({ cookie: "apmcb_session=sealed" });
    expect(hasErrorBanner(tree)).toBe(false);
  });

  it("B. MODE_USER: mesmo staff em Modo Usuário não recebe dados de staff (redireciona)", async () => {
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(ClientStub).not.toHaveBeenCalled();
    expect(listCalls()).toHaveLength(0);
  });

  it("C. USUARIO comum é redirecionado", async () => {
    state.profileRole = "usuario";
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("H. identidade da sessão do BFF diferente → nega (fail-closed)", async () => {
    state.sessionUserId = "33333333-3333-3333-3333-333333333333";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(listCalls()).toHaveLength(0);
  });

  it("G. sem sessão do BFF → nega (fail-closed)", async () => {
    state.cookie = null;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("O. 401 do BFF na listagem → login", async () => {
    state.listStatus = 401;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/login$/);
  });

  it("P. 403 do BFF na listagem (papel caiu entre as chamadas) → redireciona, com log", async () => {
    state.listStatus = 403;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[reserva/solicitacoes]"), expect.objectContaining({ status: 403 }));
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("Q. 500 / BFF fora do ar / corpo inválido → aviso de erro visível, lista vazia e log POR CASO, nunca dado direto", async () => {
    const cases: Array<[string, () => void]> = [
      ["500", () => { state.listStatus = 500; }],
      ["rede", () => { state.listThrows = true; }],
    ];
    for (const [name, setup] of cases) {
      Object.assign(state, { listStatus: 200, listThrows: false });
      setup();
      ClientStub.mockClear();
      (console.warn as ReturnType<typeof vi.fn>).mockClear();
      const tree = await render();
      expect(ids(clientProps(tree)), name).toEqual([]);
      expect(hasErrorBanner(tree), name).toBe(true);
      expect(console.warn, name).toHaveBeenCalledWith(expect.stringContaining("[reserva/solicitacoes]"), expect.anything());
    }
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("K. limite e hasMore calculados sobre o que o BFF devolveu", async () => {
    state.bffRows = Array.from({ length: 25 }, (_, i) => row(`r${i}`));
    let p = clientProps(await render({ limit: "20" }));
    expect(ids(p)).toHaveLength(20);
    expect(p?.hasMore).toBe(true);
    ClientStub.mockClear();
    state.bffRows = Array.from({ length: 20 }, (_, i) => row(`r${i}`));
    p = clientProps(await render({ limit: "20" }));
    expect(p?.hasMore).toBe(false);
  });

  it("limite manual 50 é ajustado para 49 e 50 linhas do BFF dão hasMore=true", async () => {
    state.bffRows = Array.from({ length: 50 }, (_, i) => row(`r${i}`));
    const p = clientProps(await render({ limit: "50" }));
    expect(p?.currentLimit).toBe(49);
    expect(ids(p)).toHaveLength(49);
    expect(p?.hasMore).toBe(true);
  });

  it("highlight fora da janela do BFF: não aparece e deixa log (limitação documentada)", async () => {
    state.bffRows = [row("a"), row("b")];
    const p = clientProps(await render({ highlight: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }));
    expect(ids(p)).toEqual(["a", "b"]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("highlight fora"), expect.anything());
  });

  it("linha nula na resposta é ignorada, sem derrubar a página", async () => {
    state.bffRows = [row("ok"), null as unknown as Record<string, unknown>];
    expect(ids(clientProps(await render()))).toEqual(["ok"]);
  });

  it("deep-link ?highlight dentro do que o BFF devolveu entra na lista mesmo fora da 1ª página", async () => {
    const target = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    state.bffRows = [...Array.from({ length: 25 }, (_, i) => row(`r${i}`)), row(target)];
    const p = clientProps(await render({ limit: "20", highlight: target }));
    expect(ids(p)[0]).toBe(target);
    expect(ids(p)).toHaveLength(21);
  });

  it("repassa ao cliente só os campos que ele já recebia (sem foto_url/campos extras do BFF)", async () => {
    state.bffRows = [row("x", { totp_validated_at: "t", created_at: "c", updated_at: "u", military: { id: "m", nome_completo: "M", posto: null, matricula: "1", foto_url: "m/p.webp" } })];
    const r = (clientProps(await render())?.initialRequests as Array<Record<string, unknown>>)[0];
    expect(r).not.toHaveProperty("totp_validated_at");
    expect(r).not.toHaveProperty("updated_at");
    expect(r.military).toEqual({ id: "m", nome_completo: "M", posto: null, matricula: "1" });
  });

  it("M. nunca lê material_requests direto do Supabase com o JWT do usuário", async () => {
    await render({ highlight: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
    expect(directFrom).not.toHaveBeenCalled();
  });
});

describe("guarda estática do lote 2 (R-37)", () => {
  const src = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
  it("page.tsx não cria cliente Supabase nem consulta tabelas diretamente", () => {
    expect(src).not.toMatch(/@\/lib\/supabase\/(server|client)/);
    expect(src).not.toMatch(/@supabase\//);
    expect(src).not.toMatch(/\.from\(\s*["'`]/);
  });
});
