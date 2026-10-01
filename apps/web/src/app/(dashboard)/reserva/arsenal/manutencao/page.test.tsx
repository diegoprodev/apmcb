// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

// R-34 / R-37 lote 6 (docs/auditoria/EVIDENCE_R37_BATCH6.md): /reserva/arsenal/manutencao
// é página de staff. Antes autorizava por `profiles.role` e lia `material_items`
// direto do Supabase com o JWT do usuário (RLS; o Modo Usuário — D-02 — era
// ignorado) para o TENANT inteiro. Agora a autorização é o papel EFETIVO da
// sessão do BFF e os itens vêm de GET /api/arsenal/items/manutencao (sessão,
// tenant e reserva aplicados no banco). Handler REAL da página; só a borda é mockada.

const USER = "11111111-1111-1111-1111-111111111111";
const TENANT = "22222222-2222-2222-2222-222222222222";
const state = {
  profileRole: "armeiro",
  effectiveRole: "armeiro" as string | null,
  sessionUserId: USER,
  cookie: "sealed" as string | null,
  status: 200,
  throws: false,
  body: null as unknown,
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
      q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: state.directRows, error: null }).then(res);
      return q;
    },
  }),
}));
const ClientStub = vi.fn(() => null);
const ButtonStub = vi.fn(() => null);
vi.mock("./_manutencao-client", () => ({ ManutencaoClient: ClientStub }));
vi.mock("./_registrar-ocorrencia-dialog", () => ({ RegistrarOcorrenciaButton: ButtonStub }));

const item = (id: string, status: string, extra: Record<string, unknown> = {}) => ({
  id, status_operacional: status, identificador_principal: `ID-${id}`, tipo_identificador: "numero_serie", condicao: "ruim",
  descricao_adicional: null, last_movement_at: "2026-09-30T00:00:00Z", material_nome: "Pistola", material_categoria: "arma",
  reserve_id: "r1", reserve_nome: "Alfa", ...extra,
});
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(state, {
    profileRole: "armeiro", effectiveRole: "armeiro", sessionUserId: USER, cookie: "sealed", status: 200, throws: false,
    body: { items: [item("a", "avariado"), item("b", "manutencao"), item("c", "extraviado"), item("d", "em_pericia")] },
    directRows: [{ id: "x", status_operacional: "avariado" }],
  });
  directFrom.mockClear(); ClientStub.mockClear(); ButtonStub.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/session/info")) return Response.json({ userId: state.sessionUserId, role: state.effectiveRole });
    if (u.includes("/api/arsenal/items/manutencao")) {
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
const listCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/arsenal/items/manutencao"));

describe("/reserva/arsenal/manutencao — autorização pelo papel efetivo da sessão (R-37 lote 6)", () => {
  it("STAFF_NORMAL: itens do BFF com o cookie da sessão, separados por aba; papel efetivo ao botão", async () => {
    const t = await render();
    const p = client(t);
    expect(rowIds(p)).toEqual(["a", "b"]); // aba padrão: danificados
    expect(p?.activeTabLabel).toBe("danificados");
    expect(find(t, (e) => e.type === ButtonStub)?.props.role).toBe("armeiro");
    expect(JSON.stringify(t)).toContain("Danificados");
    expect((listCalls()[0][1] as RequestInit).headers).toMatchObject({ cookie: "apmcb_session=sealed" });
  });

  it("abas: perdidos e administrativo", async () => {
    expect(rowIds(client(await render({ tab: "perdidos" })))).toEqual(["c"]);
    expect(rowIds(client(await render({ tab: "administrativo" })))).toEqual(["d"]);
    expect(rowIds(client(await render({ tab: "invalida" })))).toEqual(["a", "b"]);
  });

  it("admin_reserva: aceito, com o papel efetivo", async () => {
    state.effectiveRole = "admin_reserva";
    const t = await render();
    expect(find(t, (e) => e.type === ButtonStub)?.props.role).toBe("admin_reserva");
  });

  it("MODE_USER: mesmo staff (profiles.role=armeiro) em Modo Usuário não recebe dados de staff (redireciona)", async () => {
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(ClientStub).not.toHaveBeenCalled();
    expect(listCalls()).toHaveLength(0);
  });

  it("USUARIO / papel elevado só no perfil / admin_global (usa a rota de admin) / superadmin: redirecionam", async () => {
    for (const [profileRole, eff] of [["usuario", "usuario"], ["admin_reserva", "usuario"], ["admin_global", "admin_global"], ["superadmin", "superadmin"]]) {
      state.profileRole = profileRole; state.effectiveRole = eff; ClientStub.mockClear();
      await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
      expect(ClientStub).not.toHaveBeenCalled();
    }
  });

  it("IDENTIDADE da sessão do BFF diferente: fail-closed", async () => {
    state.sessionUserId = "99999999-9999-9999-9999-999999999999";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(ClientStub).not.toHaveBeenCalled();
  });

  it("sem sessão do BFF (sem cookie): nega", async () => {
    state.cookie = null; state.effectiveRole = null;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(listCalls()).toHaveLength(0);
  });

  it("401 do BFF → /login; 403 → /; ambos com log", async () => {
    state.status = 401;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/login$/);
    state.status = 403;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(console.warn).toHaveBeenCalled();
  });

  it("5xx, rede e forma inesperada: aviso de falha (nunca lista vazia), sem leitura direta, com log por caso", async () => {
    for (const mode of ["500", "net", "shape"]) {
      state.status = 200; state.throws = false; state.body = { items: [] };
      if (mode === "500") state.status = 500;
      if (mode === "net") state.throws = true;
      if (mode === "shape") state.body = { nao: "esperado" };
      ClientStub.mockClear(); (console.warn as ReturnType<typeof vi.fn>).mockClear();
      const t = await render();
      expect(client(t)).toBeNull();
      expect(JSON.stringify(t)).toContain("Não foi possível carregar");
      expect(console.warn).toHaveBeenCalled();
    }
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("zero itens legítimos: o cliente recebe lista vazia (estado vazio do próprio cliente, não erro)", async () => {
    state.body = { items: [] };
    const t = await render();
    expect(rowIds(client(t))).toEqual([]);
    expect(JSON.stringify(t)).not.toContain("Não foi possível carregar");
  });

  it("só os campos que o cliente usa; linhas inválidas e status fora das abas são ignorados", async () => {
    state.body = { items: [item("a", "avariado", { segredo: "x", tenant_id: "t" }), null, { sem: "id" }, item("z", "disponivel")] };
    const p = client(await render());
    expect(rowIds(p)).toEqual(["a"]);
    expect(Object.keys((p?.rows as Array<Record<string, unknown>>)[0]).sort()).toEqual([
      "condicao", "descricao_adicional", "id", "identificador_principal", "last_movement_at", "material_categoria", "material_nome",
      "reserve_id", "reserve_nome", "status_operacional", "tipo_identificador",
    ]);
  });

  it("nenhuma leitura direta do Supabase", async () => {
    await render();
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("guarda estática: a página não importa cliente Supabase, helper de leitura direta nem getSessionProfile", () => {
    const src = readFileSync(resolve(__dirname, "page.tsx"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/@\/lib\/supabase\/(server|client)|@supabase\//);
    expect(src).not.toMatch(/fetchManutencaoItems/);
    // import de tipo (apagado em build) é permitido; import de valor do helper de leitura direta, não.
    expect(src).not.toMatch(/import\s+(?!type\b)[^;]*material-items-manutencao/);
    expect(src).not.toMatch(/\.from\(|getSessionProfile/);
  });
});
