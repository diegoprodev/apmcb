// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

// R-34 / R-37 lote 7 (docs/auditoria/EVIDENCE_R37_BATCH7.md): /admin/arsenal/manutencao
// autorizava por `profiles.role` e lia `material_items`/`reserves` direto do Supabase com
// o JWT do usuário (RLS; Modo Usuário — D-02 — ignorado). Agora: papel EFETIVO da sessão do
// BFF e dados de GET /api/arsenal/items/manutencao-admin. Handler REAL da página.

const USER = "11111111-1111-1111-1111-111111111111";
const state = {
  profileRole: "admin_global",
  effectiveRole: "admin_global" as string | null,
  sessionUserId: USER,
  cookie: "sealed" as string | null,
  status: 200,
  throws: false,
  body: null as unknown,
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
  getSessionProfile: async () => ({ role: state.profileRole, default_tenant_id: "t1" }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => { directFrom(table); throw new Error("acesso direto ao Supabase"); },
  }),
}));
const ClientStub = vi.fn(() => null);
const ButtonStub = vi.fn(() => null);
vi.mock("@/app/(dashboard)/reserva/arsenal/manutencao/_manutencao-client", () => ({ ManutencaoClient: ClientStub }));
vi.mock("@/app/(dashboard)/reserva/arsenal/manutencao/_registrar-ocorrencia-dialog", () => ({ RegistrarOcorrenciaButton: ButtonStub }));

const item = (id: string, status: string) => ({
  id, status_operacional: status, identificador_principal: `ID-${id}`, tipo_identificador: "numero_serie", condicao: "ruim",
  descricao_adicional: null, last_movement_at: "2026-09-30T00:00:00Z", material_nome: "Pistola", material_categoria: "arma",
  reserve_id: "r1", reserve_nome: "Alfa",
});
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(state, {
    profileRole: "admin_global", effectiveRole: "admin_global", sessionUserId: USER, cookie: "sealed", status: 200, throws: false,
    body: {
      items: [item("a", "avariado"), item("b", "manutencao"), item("c", "extraviado"), item("d", "em_pericia")],
      reserves: [{ id: "r1", nome: "Alfa", acronym: "A" }, { id: "r2", nome: "Bravo", acronym: "B" }],
    },
  });
  directFrom.mockClear(); ClientStub.mockClear(); ButtonStub.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/session/info")) return Response.json({ userId: state.sessionUserId, role: state.effectiveRole });
    if (u.includes("/api/arsenal/items/manutencao-admin")) {
      if (state.throws) throw new Error("ECONNREFUSED");
      return state.status === 200 ? Response.json(state.body) : new Response("{}", { status: state.status });
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
async function render(params: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  return Page({ searchParams: Promise.resolve(params) });
}
const client = (t: unknown) => find(t, (e) => e.type === ClientStub)?.props ?? null;
const rowIds = (p: Record<string, unknown> | null) => ((p?.rows as Array<{ id: string }>) ?? []).map((r) => r.id);
const listCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/arsenal/items/manutencao-admin"));

describe("/admin/arsenal/manutencao — papel efetivo da sessão (R-37 lote 7)", () => {
  it("admin_global: itens e reservas do BFF com o cookie; abas; papel efetivo ao botão; nada direto no Supabase", async () => {
    const t = await render();
    const p = client(t);
    expect(rowIds(p)).toEqual(["a", "b"]);
    expect((p?.reserves as unknown[]).length).toBe(2);
    expect(find(t, (e) => e.type === ButtonStub)?.props.role).toBe("admin_global");
    expect((listCalls()[0][1] as RequestInit).headers).toMatchObject({ cookie: "apmcb_session=sealed" });
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("abas perdidos / administrativo / inválida", async () => {
    expect(rowIds(client(await render({ tab: "perdidos" })))).toEqual(["c"]);
    expect(rowIds(client(await render({ tab: "administrativo" })))).toEqual(["d"]);
    expect(rowIds(client(await render({ tab: "x" })))).toEqual(["a", "b"]);
  });

  it("MODE_USER: admin_global (perfil) em Modo Usuário → redireciona, sem chamar o BFF de dados", async () => {
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(ClientStub).not.toHaveBeenCalled();
    expect(listCalls()).toHaveLength(0);
  });

  it("armeiro, admin_reserva, auditor, superadmin, usuario, sem papel: redirecionam", async () => {
    for (const eff of ["armeiro", "admin_reserva", "auditor", "superadmin", "usuario", null]) {
      state.effectiveRole = eff; ClientStub.mockClear();
      await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
      expect(ClientStub).not.toHaveBeenCalled();
    }
    expect(listCalls()).toHaveLength(0);
  });

  it("perfil rebaixado mas sessão do BFF ainda admin_global: vale o papel efetivo (profiles.role não decide)", async () => {
    state.profileRole = "usuario";
    expect(rowIds(client(await render()))).toEqual(["a", "b"]);
  });

  it("identidade da sessão do BFF diferente / sem cookie: fail-closed", async () => {
    state.sessionUserId = "99999999-9999-9999-9999-999999999999";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    state.sessionUserId = USER; state.cookie = null;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(ClientStub).not.toHaveBeenCalled();
  });

  it("401 → /login; 403 → /; ambos logados", async () => {
    state.status = 401;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/login$/);
    state.status = 403;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(console.warn).toHaveBeenCalled();
  });

  it("500, rede e corpo inesperado: aviso, nunca lista vazia", async () => {
    for (const mutate of [() => { state.status = 500; }, () => { state.status = 200; state.throws = true; }, () => { state.throws = false; state.body = { items: [] }; }, () => { state.body = null; }]) {
      mutate(); ClientStub.mockClear();
      const t = await render();
      expect(ClientStub).not.toHaveBeenCalled();
      expect(JSON.stringify(t)).toContain("Não foi possível carregar os itens em manutenção");
    }
  });

  it("vazio legítimo: renderiza o client com 0 linhas", async () => {
    state.body = { items: [], reserves: [] };
    expect(rowIds(client(await render()))).toEqual([]);
  });

  it("guarda estática: sem Supabase direto nem helper de leitura direta", () => {
    const src = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    expect(src).not.toMatch(/supabase\/server|createClient|fetchManutencaoItems|\.from\(/);
    expect(src).not.toMatch(/profile\??\.role|getSessionProfile/);
    expect(src).toContain("/api/arsenal/items/manutencao-admin");
  });
});
