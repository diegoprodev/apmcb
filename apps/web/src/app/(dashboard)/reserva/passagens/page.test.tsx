// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

// R-34 / R-37 lote 4 (docs/auditoria/EVIDENCE_R37_BATCH4.md): /reserva/passagens
// é página de staff. Antes autorizava por `profiles.role` (lido direto do
// Supabase) e escolhia a reserva por `reserve_memberships[0]` — o Modo Usuário
// (D-02) era ignorado e o casco de staff (papel, reservas, JWT) ia para o
// cliente. Agora a autorização é o papel EFETIVO da sessão do BFF e a reserva
// vem de GET /api/reserves/active. A listagem em si já é buscada pelo cliente em
// GET /api/handovers (BFF). Handler REAL da página; só a borda é mockada.

const USER = "11111111-1111-1111-1111-111111111111";
const RESERVE = "33333333-3333-3333-3333-333333333333";
const OTHER_RESERVE = "44444444-4444-4444-4444-444444444444";
const state = {
  profileRole: "armeiro",
  effectiveRole: "armeiro" as string | null,
  sessionUserId: USER,
  cookie: "sealed" as string | null,
  supaSession: true,
  reserveStatus: 200,
  reserveThrows: false,
  reserveBody: { reserve: { id: RESERVE, nome: "Reserva Alfa", logo_url: null } } as unknown,
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
// Simula o RLS/JWT do usuário: profiles.role decide; memberships com várias reservas.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getSession: async () => ({
        data: { session: state.supaSession ? { access_token: "jwt-x", user: { id: USER } } : null },
      }),
    },
    from: (table: string) => {
      directFrom(table);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "limit"]) q[m] = () => q;
      q.single = async () => ({ data: { role: state.profileRole }, error: null });
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ reserve_id: OTHER_RESERVE }, { reserve_id: RESERVE }], error: null }).then(res);
      return q;
    },
  }),
}));
const ClientStub = vi.fn(() => null);
vi.mock("./_client", () => ({ PassagensClient: ClientStub }));

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(state, {
    profileRole: "armeiro", effectiveRole: "armeiro", sessionUserId: USER, cookie: "sealed", supaSession: true,
    reserveStatus: 200, reserveThrows: false,
    reserveBody: { reserve: { id: RESERVE, nome: "Reserva Alfa", logo_url: null } },
  });
  directFrom.mockClear();
  ClientStub.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/session/info")) return Response.json({ userId: state.sessionUserId, role: state.effectiveRole });
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
  for (const k of ([] as unknown[]).concat(el.props?.children ?? [])) { const p = find(k, pred); if (p) return p; }
  return null;
}
const clientProps = (tree: unknown) => find(tree, (el) => el.type === ClientStub)?.props ?? null;
async function render() {
  const { default: Page } = await import("./page");
  return Page();
}
const reserveCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/reserves/active"));

describe("/reserva/passagens — autorização pelo papel efetivo da sessão (R-37 lote 4)", () => {
  it("STAFF_NORMAL: recebe o casco com o papel efetivo e a reserva ATIVA da sessão (não memberships[0])", async () => {
    const p = clientProps(await render());
    expect(p?.role).toBe("armeiro");
    expect(p?.reserveId).toBe(RESERVE);
    expect(p?.token).toBe("jwt-x"); // escrita (criar passagem) continua usando o mesmo Bearer de antes
    expect((reserveCalls()[0][1] as RequestInit).headers).toMatchObject({ cookie: "apmcb_session=sealed" });
  });

  it("MODE_USER: mesmo staff em Modo Usuário (profiles.role=armeiro) é redirecionado; nada de casco, papel ou JWT para o cliente", async () => {
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/reserva$/);
    expect(ClientStub).not.toHaveBeenCalled();
    expect(reserveCalls()).toHaveLength(0);
  });

  it("USUARIO: usuário comum é redirecionado", async () => {
    state.profileRole = "usuario"; state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/reserva$/);
    expect(ClientStub).not.toHaveBeenCalled();
  });

  it("papel elevado só no perfil (profiles.role=admin_global, sessão=usuario) não autoriza", async () => {
    state.profileRole = "admin_global"; state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:/);
    expect(ClientStub).not.toHaveBeenCalled();
  });

  it("superadmin e auditor não entram (conjunto do BFF para criar/operar; sem ampliar)", async () => {
    for (const r of ["superadmin", "auditor"]) {
      state.effectiveRole = r; ClientStub.mockClear();
      await expect(render()).rejects.toThrow(/^REDIRECT:\/reserva$/);
      expect(ClientStub).not.toHaveBeenCalled();
    }
  });

  it("papéis de staff válidos renderizam com o papel efetivo", async () => {
    for (const r of ["armeiro", "admin_reserva", "admin_global"]) {
      state.effectiveRole = r;
      expect(clientProps(await render())?.role).toBe(r);
    }
  });

  it("identidade da sessão do BFF diferente da sessão Supabase: fail-closed", async () => {
    state.sessionUserId = "99999999-9999-9999-9999-999999999999";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/reserva$/);
    expect(ClientStub).not.toHaveBeenCalled();
  });

  it("sem cookie de sessão do BFF: nega", async () => {
    state.cookie = null; state.effectiveRole = null;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/reserva$/);
    expect(ClientStub).not.toHaveBeenCalled();
  });

  it("sem sessão Supabase: /login", async () => {
    state.supaSession = false;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/login$/);
  });

  it("falha/ausência da reserva ativa: casco renderiza sem reserveId (criar fica desabilitado), com log; nunca cai em memberships", async () => {
    for (const mode of ["500", "net", "null"]) {
      state.reserveStatus = 200; state.reserveThrows = false; state.reserveBody = { reserve: null };
      if (mode === "500") state.reserveStatus = 500;
      if (mode === "net") state.reserveThrows = true;
      (console.warn as ReturnType<typeof vi.fn>).mockClear();
      const p = clientProps(await render());
      expect(p?.reserveId).toBeNull();
      if (mode !== "null") expect(console.warn).toHaveBeenCalled();
    }
  });

  it("reserva ativa: 403 do BFF ou id não-string → reserveId null (nunca memberships)", async () => {
    state.reserveStatus = 403;
    expect(clientProps(await render())?.reserveId).toBeNull();
    state.reserveStatus = 200; state.reserveBody = { reserve: { id: 123 } };
    expect(clientProps(await render())?.reserveId).toBeNull();
  });

  it("nenhuma leitura direta do Supabase além do Auth: sem tabelas", async () => {
    await render();
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("guarda estática: a página não lê tabelas (sem .from) nem profiles/reserve_memberships", () => {
    const src = readFileSync(resolve(__dirname, "page.tsx"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\.from\(/);
    expect(src).not.toMatch(/reserve_memberships|"profiles"/);
  });
});
