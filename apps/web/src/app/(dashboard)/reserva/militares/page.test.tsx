// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

// R-34 / R-37 lote 5 (docs/auditoria/EVIDENCE_R37_BATCH5.md): /reserva/militares
// é página de staff. Antes lia `profiles`, `lendings`, `biometric_templates` e
// `reserves` direto do Supabase com o JWT do usuário (RLS por profiles.role,
// ignora o Modo Usuário — D-02). Agora a autorização é o papel EFETIVO da
// sessão do BFF e os dados vêm de GET /api/profiles/militares (sessão, tenant e
// reserva aplicados no BFF). Handler REAL da página; só a borda é mockada.

const USER = "11111111-1111-1111-1111-111111111111";
const TENANT = "22222222-2222-2222-2222-222222222222";
const RESERVE = "33333333-3333-3333-3333-333333333333";
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
  getSessionProfile: async () => ({ role: state.profileRole, default_tenant_id: TENANT, active_reserve_id: RESERVE, nome_completo: "Staff" }),
}));
// Simula o que o RLS entrega ao JWT do usuário: decide por profiles.role.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      directFrom(table);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "order", "eq", "in", "limit"]) q[m] = () => q;
      q.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: table === "profiles" ? state.directRows : [], error: null }).then(res);
      return q;
    },
  }),
}));
const TableStub = vi.fn(() => null);
const ToolbarStub = vi.fn(() => null);
vi.mock("./_militares-table", () => ({ MilitaresTable: TableStub }));
vi.mock("@/app/(dashboard)/admin/usuarios/_user-actions", () => ({ AdminUserToolbar: ToolbarStub }));
const ImportStub = vi.fn(() => null);
const SemReservaStub = vi.fn(() => null);
vi.mock("@/components/militares/import-militares-dialog", () => ({ ImportMilitaresButton: ImportStub }));
vi.mock("@/components/militares/sem-reserva-panel", () => ({ SemReservaPanel: SemReservaStub }));

const mil = (id: string, extra: Record<string, unknown> = {}) => ({
  id, nome_completo: `Militar ${id}`, matricula: id, foto_url: null, registration_status: "ativo", totp_configured: true,
  posto: "Sd", email: `${id}@x.br`, nome_de_guerra: null, unidade: null, telefone: null,
  invite_sent_at: null, account_activated_at: null, registered_fingers: [1], active_count: 2, ...extra,
});
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(state, {
    profileRole: "armeiro", effectiveRole: "armeiro", sessionUserId: USER, cookie: "sealed", status: 200, throws: false,
    body: { militares: [mil("m1"), mil("m2")], reserve_id: RESERVE, reserve_options: [] },
    directRows: [
      { id: "m1", nome_completo: "Militar m1", matricula: "m1", registration_status: "ativo", totp_configured: true },
      { id: "m2", nome_completo: "Militar m2", matricula: "m2", registration_status: "ativo", totp_configured: true },
    ],
  });
  directFrom.mockClear(); TableStub.mockClear(); ToolbarStub.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.endsWith("/api/session/info")) return Response.json({ userId: state.sessionUserId, role: state.effectiveRole });
    if (u.includes("/api/profiles/militares")) {
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
async function render() { const { default: Page } = await import("./page"); return Page(); }
const table = (t: unknown) => find(t, (e) => e.type === TableStub)?.props ?? null;
const toolbar = (t: unknown) => find(t, (e) => e.type === ToolbarStub)?.props ?? null;
const ids = (p: Record<string, unknown> | null) => ((p?.militares as Array<{ id: string }>) ?? []).map((m) => m.id);
const listCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("/api/profiles/militares"));

describe("/reserva/militares — autorização pelo papel efetivo da sessão (R-37 lote 5)", () => {
  it("STAFF_NORMAL: lista vinda do BFF com o cookie da sessão; dedos, contagem e reserva da sessão", async () => {
    const t = await render();
    const p = table(t);
    expect(ids(p)).toEqual(["m1", "m2"]);
    const first = (p?.militares as Array<Record<string, unknown>>)[0];
    expect(first).toMatchObject({ registeredFingers: [1], activeCount: 2, reserve_id: RESERVE, nome_completo: "Militar m1" });
    expect(p?.currentUserId).toBe(USER);
    expect(p?.callerRole).toBe("master");
    expect(p?.editCallerRole).toBe("armeiro");
    expect(toolbar(t)).toMatchObject({ callerRole: "armeiro", activeReserveId: RESERVE, reserveOptions: [] });
    expect((listCalls()[0][1] as RequestInit).headers).toMatchObject({ cookie: "apmcb_session=sealed" });
  });

  it("D-05: Importar e o filtro 'Sem reserva' aparecem; armeiro NÃO exporta, admin_reserva e admin_global exportam", async () => {
    for (const [eff, canExport] of [["armeiro", false], ["admin_reserva", true], ["admin_global", true]] as const) {
      state.effectiveRole = eff; TableStub.mockClear();
      const t = await render();
      expect(find(t, (e) => e.type === ImportStub)).not.toBeNull();
      expect(find(t, (e) => e.type === SemReservaStub)).not.toBeNull();
      expect(table(t)?.canExport, eff).toBe(canExport);
      expect(find(t, (e) => e.type === SemReservaStub)?.props.canExport, eff).toBe(canExport);
    }
  });

  it("MODE_USER: mesmo staff (profiles.role=armeiro) em Modo Usuário não recebe dados de staff (redireciona)", async () => {
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(TableStub).not.toHaveBeenCalled();
    expect(listCalls()).toHaveLength(0);
  });

  it("USUARIO / papel elevado só no perfil / superadmin: redirecionam", async () => {
    for (const [profileRole, eff] of [["usuario", "usuario"], ["admin_global", "usuario"], ["superadmin", "superadmin"]]) {
      state.profileRole = profileRole; state.effectiveRole = eff; TableStub.mockClear();
      await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
      expect(TableStub).not.toHaveBeenCalled();
    }
  });

  it("papéis de staff válidos: papel efetivo repassado (admin_global → callerRole admin)", async () => {
    state.effectiveRole = "admin_global";
    const t = await render();
    expect(table(t)?.callerRole).toBe("admin");
    expect(table(t)?.editCallerRole).toBe("admin_global");
    state.effectiveRole = "admin_reserva";
    expect(table(await render())?.editCallerRole).toBe("admin_reserva");
  });

  it("matriz (admin_global sem reserva ativa): opções de reserva vindas do BFF vão para o cadastro", async () => {
    state.effectiveRole = "admin_global";
    state.body = { militares: [mil("m1")], reserve_id: null, reserve_options: [{ id: RESERVE, nome: "Alfa" }] };
    const t = await render();
    expect(toolbar(t)).toMatchObject({ callerRole: "admin_global", activeReserveId: null, reserveOptions: [{ id: RESERVE, nome: "Alfa" }] });
    expect((table(t)?.militares as Array<Record<string, unknown>>)[0].reserve_id).toBeNull();
  });

  it("IDENTIDADE da sessão do BFF diferente: fail-closed", async () => {
    state.sessionUserId = "99999999-9999-9999-9999-999999999999";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(TableStub).not.toHaveBeenCalled();
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

  it("5xx e rede: aviso de erro (nunca 'nenhum usuário'), sem dado direto, com log por caso", async () => {
    for (const mode of ["500", "net", "shape"]) {
      state.status = 200; state.throws = false; state.body = { militares: [] };
      if (mode === "500") state.status = 500;
      if (mode === "net") state.throws = true;
      if (mode === "shape") state.body = { nao: "esperado" };
      TableStub.mockClear(); (console.warn as ReturnType<typeof vi.fn>).mockClear();
      const t = await render();
      expect(table(t)).toBeNull();
      expect(JSON.stringify(t)).toContain("Não foi possível carregar");
      expect(JSON.stringify(t)).not.toContain("Nenhum usuário cadastrado");
      expect(console.warn).toHaveBeenCalled();
    }
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("zero resultados legítimos: estado vazio (não é erro)", async () => {
    state.body = { militares: [], reserve_id: RESERVE, reserve_options: [] };
    const t = await render();
    expect(table(t)).toBeNull();
    expect(JSON.stringify(t)).toContain("Nenhum usuário cadastrado");
  });

  it("só os campos que a tabela usa; linhas inválidas são ignoradas", async () => {
    state.body = { militares: [mil("m1", { password_hash: "x", segredo: "y" }), null, { sem: "id" }], reserve_id: RESERVE, reserve_options: [] };
    const p = table(await render());
    expect(ids(p)).toEqual(["m1"]);
    const row = (p?.militares as Array<Record<string, unknown>>)[0];
    expect(Object.keys(row).sort()).toEqual([
      "account_activated_at", "activeCount", "email", "foto_url", "id", "invite_sent_at", "matricula", "nome_completo", "nome_de_guerra",
      "posto", "registeredFingers", "registration_status", "reserve_id", "telefone", "totp_configured", "unidade",
    ]);
  });

  it("nenhuma leitura direta do Supabase", async () => {
    await render();
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("guarda estática: a página não importa cliente Supabase nem lê tabelas", () => {
    const src = readFileSync(resolve(__dirname, "page.tsx"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/@\/lib\/supabase\/(server|client)|@supabase\//);
    expect(src).not.toMatch(/\.from\(/);
    expect(src).not.toMatch(/getSessionProfile/);
  });
});
