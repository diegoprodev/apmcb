// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactElement } from "react";

// R-34 / R-37 (docs/auditoria/EVIDENCE_R37_BATCH1.md): /reserva/ocorrencias é
// página de staff. Antes lia `ocorrencias` direto do Supabase com o JWT do
// usuário — o RLS decide por profiles.role, que ignora o Modo Usuário (D-02).
// Agora a autorização é o papel EFETIVO da sessão do BFF e os dados vêm de
// GET /api/ocorrencias (sessão, tenant e reserva aplicados no BFF).
// Handler REAL da página; só a borda é mockada.

const USER = "11111111-1111-1111-1111-111111111111";
const state = {
  profileRole: "admin_reserva",
  effectiveRole: "admin_reserva" as string | null,
  sessionUserId: USER,
  cookie: "sealed" as string | null,
  ocorrenciasStatus: 200,
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
  getSessionProfile: async () => ({ role: state.profileRole }),
}));
// Simula o que o RLS entrega ao JWT do usuário: decide por profiles.role
// (papel de staff), sem saber do Modo Usuário.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      directFrom(table);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "in", "order", "eq"]) q[m] = () => q;
      q.limit = async () => ({ data: state.directRows, error: null });
      return q;
    },
  }),
}));
const ClientStub = vi.fn(() => null);
vi.mock("./_ocorrencias-client", () => ({ OcorrenciasClient: ClientStub }));

const row = (id: string) => ({
  id, titulo: `t-${id}`, descricao: null, status: "aberta", material_nome_snapshot: null,
  created_at: "2026-09-30T00:00:00Z", military: { nome_completo: "M", posto: null, matricula: "1" },
});
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.assign(state, {
    profileRole: "admin_reserva", effectiveRole: "admin_reserva", sessionUserId: USER, cookie: "sealed",
    ocorrenciasStatus: 200, bffRows: [row("staff-1"), row("staff-2")], directRows: [row("staff-1"), row("staff-2")],
  });
  directFrom.mockClear();
  ClientStub.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith("/api/session/info")) {
      return Response.json({ userId: state.sessionUserId, role: state.effectiveRole });
    }
    if (String(url).includes("/api/ocorrencias")) {
      return state.ocorrenciasStatus === 200
        ? Response.json(state.bffRows)
        : new Response("{}", { status: state.ocorrenciasStatus });
    }
    return new Response("{}", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function clientProps(tree: unknown): Record<string, unknown> | null {
  const el = tree as ReactElement<{ children?: unknown }> | null;
  if (!el || typeof el !== "object") return null;
  if (el.type === ClientStub) return el.props as Record<string, unknown>;
  const kids = ([] as unknown[]).concat(el.props?.children ?? []);
  for (const k of kids) { const p = clientProps(k); if (p) return p; }
  return null;
}
async function render(limit?: string) {
  const { default: Page } = await import("./page");
  return Page({ searchParams: Promise.resolve(limit ? { limit } : {}) });
}
const ids = (p: Record<string, unknown> | null) =>
  ((p?.ocorrencias as Array<{ id: string }>) ?? []).map((o) => o.id);

describe("/reserva/ocorrencias — autorização pelo papel efetivo da sessão (R-37 lote 1)", () => {
  it("A. STAFF_NORMAL: staff na sessão normal vê as ocorrências vindas do BFF", async () => {
    const p = clientProps(await render());
    expect(ids(p)).toEqual(["staff-1", "staff-2"]);
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes("/api/ocorrencias"));
    expect(call).toBeTruthy();
    expect((call![1] as RequestInit).headers).toMatchObject({ cookie: "apmcb_session=sealed" });
  });

  it("B. MODE_USER: mesmo staff em Modo Usuário não recebe dados de staff (redireciona)", async () => {
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(ClientStub).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/ocorrencias"))).toBe(false);
  });

  it("C. USUARIO comum é redirecionado", async () => {
    state.profileRole = "usuario";
    state.effectiveRole = "usuario";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("F. MIXED_IDENTITY: sessão do BFF de outra identidade → nega (fail-closed)", async () => {
    state.sessionUserId = "22222222-2222-2222-2222-222222222222";
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/api/ocorrencias"))).toBe(false);
  });

  it("G. sem sessão do BFF → nega (fail-closed)", async () => {
    state.cookie = null;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/$/);
  });

  it("G2. BFF recusa a listagem → lista vazia com rastro no log, nunca dado direto", async () => {
    state.ocorrenciasStatus = 403;
    const p = clientProps(await render());
    expect(ids(p)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[reserva/ocorrencias]"),
      expect.objectContaining({ status: 403 }),
    );
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("H. paginação preservada: limite aplicado e hasMore calculado", async () => {
    state.bffRows = Array.from({ length: 12 }, (_, i) => row(`r${i}`));
    const p = clientProps(await render("10"));
    expect(ids(p)).toHaveLength(10);
    expect(p?.hasMore).toBe(true);
    expect(p?.currentLimit).toBe(10);
  });

  it("nunca lê ocorrências direto do Supabase com o JWT do usuário", async () => {
    await render();
    expect(directFrom).not.toHaveBeenCalled();
  });
});

describe("/reserva/ocorrencias — bordas (code review)", () => {
  it("401 do BFF na listagem → login", async () => {
    state.ocorrenciasStatus = 401;
    await expect(render()).rejects.toThrow(/^REDIRECT:\/login$/);
  });

  it("BFF fora do ar → lista vazia com rastro, sem Supabase direto", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/api/session/info")) return Response.json({ userId: USER, role: "admin_reserva" });
      throw new Error("ECONNREFUSED");
    });
    const p = clientProps(await render());
    expect(ids(p)).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[reserva/ocorrencias]"), expect.anything());
    expect(directFrom).not.toHaveBeenCalled();
  });

  it("limite: exatamente `limit` linhas → hasMore=false; limit fora da faixa é ajustado", async () => {
    state.bffRows = Array.from({ length: 10 }, (_, i) => row(`r${i}`));
    let p = clientProps(await render("10"));
    expect(p?.hasMore).toBe(false);
    ClientStub.mockClear();
    state.bffRows = Array.from({ length: 40 }, (_, i) => row(`r${i}`));
    p = clientProps(await render("500"));
    expect(ids(p)).toHaveLength(30);
    ClientStub.mockClear();
    p = clientProps(await render("abc"));
    expect(p?.currentLimit).toBe(10);
  });

  it("repassa ao cliente só os campos que ele usa", async () => {
    state.bffRows = [{ ...row("x"), resolucao: "interna", updated_at: "2026-09-30T00:00:00Z" }];
    const p = clientProps(await render());
    expect(Object.keys((p?.ocorrencias as object[])[0]).sort()).toEqual(
      ["created_at", "descricao", "id", "material_nome_snapshot", "military", "status", "titulo"],
    );
  });
});

describe("guarda estática do lote 1 (R-37)", () => {
  const src = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
  it("page.tsx não cria cliente Supabase nem consulta tabelas diretamente", () => {
    expect(src).not.toMatch(/@\/lib\/supabase\/(server|client)/);
    expect(src).not.toMatch(/@supabase\//);
    expect(src).not.toMatch(/\.from\(\s*["'`]/);
  });
});
