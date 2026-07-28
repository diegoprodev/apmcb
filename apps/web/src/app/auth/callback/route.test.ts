import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  cookieGetAll: vi.fn(),
  cookies: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  fetch: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  single: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

const ACCESS_TOKEN = "access-token-that-must-never-be-logged";
const REFRESH_TOKEN = "refresh-token-that-must-never-be-logged";
const TOKEN_HASH = "token-hash-that-must-never-be-logged";
const APMCB_COOKIE = "apmcb_session=sealed-session-value; Path=/; HttpOnly; Secure; SameSite=Lax";

function bffResponse({
  ok = true,
  status = 200,
  setCookies = [APMCB_COOKIE],
}: {
  ok?: boolean;
  status?: number;
  setCookies?: string[];
} = {}): Response {
  return {
    ok,
    status,
    headers: {
      getSetCookie: () => setCookies,
    },
  } as unknown as Response;
}

function callbackRequest(query: string, cookie?: string): Request {
  return new Request(`https://apmcb.pmpb.online/auth/callback?${query}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

function responseCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
}

async function loadCallback(bffUrl = "https://bff.example.test") {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BFF_URL", bffUrl);
  return import("./route");
}

describe("GET /auth/callback — Magic Link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();

    mocks.verifyOtp.mockResolvedValue({
      data: {
        session: {
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
        },
      },
      error: null,
    });
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "profile-1" } } });
    mocks.single.mockResolvedValue({
      data: { role: "usuario", registration_status: "active" },
    });
    mocks.signOut.mockResolvedValue({ error: null });

    mocks.createClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        getUser: mocks.getUser,
        signOut: mocks.signOut,
        verifyOtp: mocks.verifyOtp,
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: mocks.single,
          })),
        })),
      })),
    });
    mocks.cookieGetAll.mockReturnValue([]);
    mocks.cookies.mockResolvedValue({
      getAll: mocks.cookieGetAll,
    });

    mocks.fetch.mockResolvedValue(bffResponse());
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("A — executa verifyOtp especificamente com token_hash + type=email", async () => {
    const { GET } = await loadCallback();

    await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    expect(mocks.verifyOtp).toHaveBeenCalledOnce();
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: TOKEN_HASH,
      type: "email",
    });
  });

  it("B — após verifyOtp válido, envia a sessão ao exchange do BFF", async () => {
    const { GET } = await loadCallback();

    await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://bff.example.test/api/auth/exchange",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
        }),
      }),
    );
  });

  it("C — só conclui o callback quando apmcb_session é propagada", async () => {
    const { GET } = await loadCallback();

    const response = await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://apmcb.pmpb.online/efetivo");
    expect(responseCookies(response).join("\n")).toContain("apmcb_session=sealed-session-value");
  });

  it("C — reaplica exatamente o cookie de sessão emitido pelo BFF", async () => {
    const { GET } = await loadCallback();
    const callbackResponse = await GET(
      callbackRequest(`token_hash=${TOKEN_HASH}&type=email`),
    );
    const cookieHeader = responseCookies(callbackResponse)
      .find((cookie) => cookie.startsWith("apmcb_session="))
      ?.split(";")[0];

    expect(cookieHeader).toBe("apmcb_session=sealed-session-value");
  });

  it.each([
    {
      name: "BFF responde erro",
      response: bffResponse({ ok: false, status: 503, setCookies: [] }),
    },
    {
      name: "BFF responde sucesso sem Set-Cookie",
      response: bffResponse({ setCookies: [] }),
    },
    {
      name: "BFF responde sucesso sem apmcb_session",
      response: bffResponse({
        setCookies: ["csrf_token=value; Path=/; Secure; SameSite=Lax"],
      }),
    },
    {
      name: "BFF responde cookie de sessão removido",
      response: bffResponse({
        setCookies: ["apmcb_session=; Path=/; HttpOnly; Max-Age=0"],
      }),
    },
  ])("E — $name não entra no dashboard", async ({ response: bffResult }) => {
    mocks.fetch.mockResolvedValue(bffResult);
    const { GET } = await loadCallback();

    const response = await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    expect(response.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error?reason=magic_link_bff_session_failed",
    );
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("E — configuração ausente do BFF não entra no dashboard", async () => {
    const { GET } = await loadCallback("");

    const response = await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    expect(response.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error?reason=magic_link_bff_session_failed",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("E — indisponibilidade do BFF não entra no dashboard", async () => {
    mocks.fetch.mockRejectedValue(new Error("network unavailable"));
    const { GET } = await loadCallback();

    const response = await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    expect(response.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error?reason=magic_link_bff_session_failed",
    );
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("E — falha do exchange revoga e remove uma apmcb_session anterior", async () => {
    const staleCookie = "apmcb_session=stale-session-from-another-user";
    const incomingCookies = `sb-project-auth-token=supabase-secret; ${staleCookie}; theme=dark`;
    mocks.fetch
      .mockResolvedValueOnce(bffResponse({ ok: false, status: 503, setCookies: [] }))
      .mockResolvedValueOnce(bffResponse({ setCookies: [] }));
    const { GET } = await loadCallback();

    const response = await GET(
      callbackRequest(`token_hash=${TOKEN_HASH}&type=email`, incomingCookies),
    );

    expect(mocks.fetch).toHaveBeenNthCalledWith(
      2,
      "https://bff.example.test/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: { cookie: staleCookie },
      }),
    );
    expect(responseCookies(response).join("\n")).toMatch(
      /apmcb_session=;.*Max-Age=0/i,
    );
    expect(response.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error?reason=magic_link_bff_session_failed",
    );
  });

  it("E — erro retornado por signOut também expira todos os cookies sb-* de sessão", async () => {
    mocks.signOut.mockResolvedValue({
      error: { code: "request_failed", message: "remote logout failed" },
    });
    mocks.cookieGetAll.mockReturnValue([
      { name: "sb-project-auth-token.0", value: "first-secret-chunk" },
      { name: "sb-project-auth-token.1", value: "second-secret-chunk" },
      { name: "theme", value: "dark" },
    ]);
    mocks.fetch.mockResolvedValue(
      bffResponse({ ok: false, status: 503, setCookies: [] }),
    );
    const { GET } = await loadCallback();

    const response = await GET(
      callbackRequest(`token_hash=${TOKEN_HASH}&type=email`),
    );
    const cookies = responseCookies(response).join("\n");

    expect(cookies).toMatch(/sb-project-auth-token\.0=;.*Max-Age=0/i);
    expect(cookies).toMatch(/sb-project-auth-token\.1=;.*Max-Age=0/i);
    expect(cookies).not.toContain("theme=");
    expect(cookies).toMatch(/apmcb_session=;.*Max-Age=0/i);
  });

  it("F — token inválido gera erro controlado", async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { code: "validation_failed", message: "invalid token" },
    });
    const { GET } = await loadCallback();

    const response = await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    expect(response.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error?reason=magic_link_invalid",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("G — token expirado ou já utilizado gera erro controlado", async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { code: "otp_expired", message: "token has expired or already been used" },
    });
    const { GET } = await loadCallback();

    const response = await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    expect(response.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error?reason=magic_link_expired_or_used",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("falha excepcional no verifyOtp também gera erro controlado", async () => {
    mocks.verifyOtp.mockRejectedValue(
      new Error(`provider failed with ${TOKEN_HASH} ${ACCESS_TOKEN}`),
    );
    const { GET } = await loadCallback();

    const response = await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    expect(response.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error?reason=magic_link_verify_failed",
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("diferencia token ausente de falha genérica no verifyOtp", async () => {
    const { GET } = await loadCallback();

    const missingTokenResponse = await GET(callbackRequest("type=email"));

    expect(missingTokenResponse.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error?reason=magic_link_missing_token",
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();

    mocks.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { code: "unexpected_failure", message: "provider failure" },
    });

    const verifyFailureResponse = await GET(
      callbackRequest(`token_hash=${TOKEN_HASH}&type=email`),
    );

    expect(verifyFailureResponse.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error?reason=magic_link_verify_failed",
    );
  });

  it.each(["invite", "recovery", "signup", "email_change"])(
    "H — mantém o processamento legado de type=%s fora do hardening de Magic Link",
    async (type) => {
      mocks.fetch.mockResolvedValue(bffResponse({ ok: false, status: 503, setCookies: [] }));
      const { GET } = await loadCallback();

      const response = await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=${type}`));

      expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: TOKEN_HASH, type });
      expect(response.headers.get("location")).toBe(
        "https://apmcb.pmpb.online/efetivo",
      );
    },
  );

  it("H — preserva o branch PKCE code com redirect e cookie do BFF", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        session: {
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
        },
      },
      error: null,
    });
    const { GET } = await loadCallback();

    const response = await GET(callbackRequest("code=pkce-code"));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/efetivo",
    );
    expect(responseCookies(response).join("\n")).toContain(
      "apmcb_session=sealed-session-value",
    );
  });

  it("H — preserva a falha do branch PKCE code sem cair em verifyOtp", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { code: "bad_code" },
    });
    const { GET } = await loadCallback();

    const response = await GET(
      callbackRequest(`code=bad-code&token_hash=${TOKEN_HASH}&type=email`),
    );

    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://apmcb.pmpb.online/auth/error",
    );
  });

  it("I — falhas nunca registram token, JWT ou cookie", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.fetch.mockResolvedValue(bffResponse({ ok: false, status: 503, setCookies: [] }));
    const { GET } = await loadCallback();

    await GET(callbackRequest(`token_hash=${TOKEN_HASH}&type=email`));

    const logs = [...errorSpy.mock.calls, ...warnSpy.mock.calls]
      .flat()
      .map((value) => JSON.stringify(value))
      .join("\n");

    expect(logs).not.toContain(TOKEN_HASH);
    expect(logs).not.toContain(ACCESS_TOKEN);
    expect(logs).not.toContain(REFRESH_TOKEN);
    expect(logs).not.toContain("sealed-session-value");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      "[auth/callback] Magic Link não concluído",
      {
        requestId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        category: "bff_session_failed",
      },
    );
    expect(Object.keys(warnSpy.mock.calls[0][1] as object).sort()).toEqual([
      "category",
      "requestId",
    ]);
  });
});
