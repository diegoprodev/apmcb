import { beforeEach, describe, expect, it, vi } from "vitest";

// Fase 2 — guarda o gatilho do e-mail de boas-vindas em POST
// /api/auth/update-password: o claim atômico em profiles.welcome_email_sent_at
// (.is(null).select) e o disparo condicional. Uma regressão que remova o
// .is(null) ou o .select("id") reenviaria o welcome a cada troca de senha.

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  createClient: vi.fn(),
  cookies: vi.fn(),
  getRequestContext: vi.fn(),
  sendTransactionalEmail: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  updateUserById: vi.fn(),
  signOut: vi.fn(),
  profilesUpdate: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: mocks.getRequestContext }));
vi.mock("@/lib/notify-email", () => ({ sendTransactionalEmail: mocks.sendTransactionalEmail }));

const USER_ID = "00000000-0000-4000-8000-000000000abc";
const pending: Promise<unknown>[] = [];

function profilesChain(result: { data: unknown; error: unknown }) {
  const select = vi.fn(() => Promise.resolve(result));
  const is = vi.fn(() => ({ select }));
  const eq = vi.fn(() => ({ is }));
  const update = mocks.profilesUpdate.mockReturnValue({ eq });
  return { update, select, is, eq };
}

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

function request(body: unknown) {
  return new Request("https://apmcb.pmpb.online/api/auth/update-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/update-password — welcome (Fase 2)", () => {
  let chain: ReturnType<typeof profilesChain>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    pending.length = 0;

    vi.stubEnv("SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");

    mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    mocks.updateUserById.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.sendTransactionalEmail.mockResolvedValue(undefined);

    chain = profilesChain({ data: [{ id: USER_ID }], error: null });

    mocks.createServerClient.mockReturnValue({
      auth: { getUser: mocks.getUser, getSession: mocks.getSession },
    });
    mocks.createClient.mockReturnValue({
      auth: { admin: { updateUserById: mocks.updateUserById, signOut: mocks.signOut } },
      from: vi.fn(() => ({ update: chain.update })),
    });
    mocks.cookies.mockResolvedValue({ getAll: () => [] });
    mocks.getRequestContext.mockReturnValue({
      env: {},
      ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p) },
    });
  });

  const strongPwd = { password: "Str0ng!Passw0rd" };

  it("faz o claim atômico com .is(welcome_email_sent_at,null) e .select antes de enviar", async () => {
    const { POST } = await loadRoute();
    await POST(request(strongPwd));
    await Promise.all(pending);

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ welcome_email_sent_at: expect.any(String) }),
    );
    expect(chain.is).toHaveBeenCalledWith("welcome_email_sent_at", null);
    expect(chain.select).toHaveBeenCalledWith("id");
  });

  it("ganhou a corrida (claim retornou linha) → dispara welcome uma vez", async () => {
    const { POST } = await loadRoute();
    await POST(request(strongPwd));
    await Promise.all(pending);

    expect(mocks.sendTransactionalEmail).toHaveBeenCalledWith("welcome", USER_ID, {}, "lifecycle");
  });

  it("conta já ativada (claim retornou 0 linhas) → NÃO reenvia welcome", async () => {
    chain = profilesChain({ data: [], error: null });
    const { POST } = await loadRoute();
    await POST(request(strongPwd));
    await Promise.all(pending);

    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalledWith(
      "welcome",
      expect.anything(),
      expect.anything(),
      "lifecycle",
    );
  });

  it("erro no claim → não envia e não quebra a resposta (200)", async () => {
    chain = profilesChain({ data: null, error: { message: "db down" } });
    const { POST } = await loadRoute();
    const res = await POST(request(strongPwd));
    await Promise.all(pending);

    expect(res.status).toBe(200);
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalledWith(
      "welcome",
      expect.anything(),
      expect.anything(),
      "lifecycle",
    );
  });

  it("exceção no envio do welcome não afeta o status da troca de senha", async () => {
    mocks.sendTransactionalEmail.mockImplementation((template: string) => {
      if (template === "welcome") return Promise.reject(new Error("boom"));
      return Promise.resolve(undefined);
    });
    const { POST } = await loadRoute();
    const res = await POST(request(strongPwd));
    await Promise.allSettled(pending);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("senha fraca → 400 e nenhum claim/envio", async () => {
    const { POST } = await loadRoute();
    const res = await POST(request({ password: "123" }));

    expect(res.status).toBe(400);
    expect(chain.update).not.toHaveBeenCalled();
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });

  it("sessão ausente → 401 e nenhum claim/envio", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const { POST } = await loadRoute();
    const res = await POST(request(strongPwd));

    expect(res.status).toBe(401);
    expect(chain.update).not.toHaveBeenCalled();
    expect(mocks.sendTransactionalEmail).not.toHaveBeenCalled();
  });
});
