import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// R-28 / D-02: o papel efetivo (com Modo Usuário) vive na sessão do BFF.
// Chamadas do servidor Next que agem como staff repassam o cookie da sessão
// e usam o papel EFETIVO — nunca profiles.role — e conferem a identidade.

const jar = { current: {} as Record<string, string> };
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (jar.current[n] ? { value: jar.current[n] } : undefined) }),
}));

const USER = "11111111-1111-1111-1111-111111111111";
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  jar.current = { apmcb_session: "sealed-value" };
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const infoResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("bffSessionHeaders", () => {
  it("repassa só o cookie apmcb_session", async () => {
    const { bffSessionHeaders } = await import("./web-session");
    expect(await bffSessionHeaders()).toEqual({ cookie: "apmcb_session=sealed-value" });
  });
  it("sem sessão → sem header (o BFF responde 401, nunca staff)", async () => {
    jar.current = {};
    const { bffSessionHeaders } = await import("./web-session");
    expect(await bffSessionHeaders()).toEqual({});
  });
});

describe("resolveWebSessionRole", () => {
  it("sessão staff da mesma identidade → papel efetivo de staff", async () => {
    fetchMock.mockResolvedValue(infoResponse({ userId: USER, role: "admin_global", activeMode: null }));
    const { resolveWebSessionRole } = await import("./web-session");
    expect(await resolveWebSessionRole(USER)).toBe("admin_global");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/session\/info$/);
    expect((init.headers as Record<string, string>).cookie).toBe("apmcb_session=sealed-value");
  });

  it("MODE_USER: sessão em Modo Usuário → 'usuario' (não o papel do profile)", async () => {
    fetchMock.mockResolvedValue(infoResponse({ userId: USER, role: "usuario", originalRole: "admin_global", activeMode: "usuario" }));
    const { resolveWebSessionRole } = await import("./web-session");
    expect(await resolveWebSessionRole(USER)).toBe("usuario");
  });

  it("MIXED_IDENTITY: sessão de outra identidade → null (nega)", async () => {
    fetchMock.mockResolvedValue(infoResponse({ userId: "22222222-2222-2222-2222-222222222222", role: "admin_global" }));
    const { resolveWebSessionRole } = await import("./web-session");
    expect(await resolveWebSessionRole(USER)).toBeNull();
  });

  it("sem cookie de sessão → null sem chamar o BFF", async () => {
    jar.current = {};
    const { resolveWebSessionRole } = await import("./web-session");
    expect(await resolveWebSessionRole(USER)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("BFF recusa (401) ou falha de rede → null (fail-closed)", async () => {
    const { resolveWebSessionRole } = await import("./web-session");
    fetchMock.mockResolvedValueOnce(infoResponse({ error: "x" }, 401));
    expect(await resolveWebSessionRole(USER)).toBeNull();
    fetchMock.mockRejectedValueOnce(new Error("rede"));
    expect(await resolveWebSessionRole(USER)).toBeNull();
  });
});
