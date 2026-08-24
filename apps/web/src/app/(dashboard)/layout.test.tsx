import { beforeEach, describe, expect, it, vi } from "vitest";

// PERF-02 (docs/enterprise/specs/navegacao-performance-enterprise.md), §8:
// testes mandatórios sobre o guard de session-mismatch em (dashboard)/layout.tsx
// depois da migração pra getSessionUser()/getSessionProfile() — a área que
// consumiu 6 das 10 rodadas de revisão adversarial da spec. Mesmo padrão de
// mock de `@/lib/supabase/server` já usado e provado em
// apps/web/src/app/auth/callback/route.test.ts.

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  cookiesGet: vi.fn(),
  headersGet: vi.fn(),
  redirect: vi.fn((url: string) => {
    // next/navigation's redirect() lança uma exceção especial que aborta a
    // renderização — um mock "mudo" (só registra a chamada) deixaria código
    // depois do redirect() continuar rodando no teste, mascarando bugs reais
    // (achado de code review na spec, 6ª/9ª rodadas).
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookiesGet })),
  headers: vi.fn(async () => ({ get: mocks.headersGet })),
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

// AppShell/RoleWatcher fazem parte da árvore só no caminho de sucesso (sem
// mismatch) — não usados pelos testes deste arquivo (todos forçam algum
// branch de mismatch), mas precisam existir pra não quebrar a resolução do
// módulo real de layout.tsx no import.
vi.mock("@/components/layout/app-shell", () => ({ AppShell: () => null }));
vi.mock("@/components/layout/role-watcher", () => ({ RoleWatcher: () => null }));

const BFF_VERIFIED_ID = "0f74d62a-4c48-40b2-8f4d-81b69d0eaddb";
const FIRST_READ_ID = "5d2e20d6-a3a5-4d94-bb2f-e230cb521431"; // 1ª leitura, diverge do BFF

function makeSupabaseClient(getUserResults: Array<{ data: { user: { id: string; email?: string } | null } }>) {
  const getUser = vi.fn();
  for (const result of getUserResults) getUser.mockResolvedValueOnce(result);
  return {
    auth: { getUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: FIRST_READ_ID,
              role: "armeiro",
              nome_completo: "Teste",
              foto_url: null,
              registration_status: "active",
              posto: null,
              nome_de_guerra: null,
              default_tenant_id: null, // pula todo o bloco de branding/reservas
              matricula: null,
              totp_configured: false,
              created_at: null,
            },
          }),
        })),
      })),
    })),
  };
}

async function loadDashboardLayout() {
  vi.resetModules();
  const mod = await import("./layout");
  return mod.default;
}

describe("(dashboard)/layout.tsx — guard de session-mismatch sob PERF-02", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookiesGet.mockReturnValue(undefined);
  });

  it("recheck continua sendo uma leitura NOVA e independente — nunca reflete o valor memoizado da 1ª leitura", async () => {
    // 1ª leitura (getSessionUser, internamente supabase.auth.getUser()):
    // FIRST_READ_ID, diferente do BFF. Recheck (2ª chamada, RAW, mesmo
    // client): concorda com o BFF — confirmed-ok.
    mocks.createClient.mockResolvedValue(
      makeSupabaseClient([
        { data: { user: { id: FIRST_READ_ID } } },
        { data: { user: { id: BFF_VERIFIED_ID } } },
      ]),
    );
    mocks.headersGet.mockImplementation((key: string) => {
      if (key === "x-verified-user-id") return BFF_VERIFIED_ID;
      if (key === "x-pathname") return "/reserva/arsenal";
      return null;
    });

    const DashboardLayout = await loadDashboardLayout();

    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      `NEXT_REDIRECT:/reserva/arsenal`,
    );
  });

  it("branch confirmed-ok: redirect(pathWithSearch) incondicional — NUNCA segue renderizando com correção local", async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabaseClient([
        { data: { user: { id: FIRST_READ_ID } } },
        { data: { user: { id: BFF_VERIFIED_ID } } }, // recheck concorda → confirmed-ok
      ]),
    );
    mocks.headersGet.mockImplementation((key: string) => {
      if (key === "x-verified-user-id") return BFF_VERIFIED_ID;
      if (key === "x-pathname") return "/admin/usuarios?tab=ativos";
      return null;
    });

    const DashboardLayout = await loadDashboardLayout();

    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      "NEXT_REDIRECT:/admin/usuarios?tab=ativos",
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/admin/usuarios?tab=ativos");
    // Confirma que NADA depois do redirect roda: getSessionProfile (que
    // dispara a query em profiles) nunca deveria ser alcançado neste branch.
    const client = await mocks.createClient.mock.results[0].value;
    expect(client.from).not.toHaveBeenCalled();
  });

  it("branch persistent: redirect fail-closed pra /auth/session-mismatch, inalterado", async () => {
    const OTHER_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    mocks.createClient.mockResolvedValue(
      makeSupabaseClient([
        { data: { user: { id: FIRST_READ_ID } } },
        { data: { user: { id: OTHER_ID } } }, // recheck diverge de novo → persistent
      ]),
    );
    mocks.headersGet.mockImplementation((key: string) => {
      if (key === "x-verified-user-id") return BFF_VERIFIED_ID;
      if (key === "x-pathname") return "/reserva/arsenal";
      return null;
    });

    const DashboardLayout = await loadDashboardLayout();

    await expect(DashboardLayout({ children: null })).rejects.toThrow(
      "NEXT_REDIRECT:/auth/session-mismatch",
    );
  });

  it("branch inconclusive (recheck falha/timeout): NUNCA redireciona — segue renderizando com a 1ª identidade, comportamento inalterado", async () => {
    const getUser = vi.fn()
      .mockResolvedValueOnce({ data: { user: { id: FIRST_READ_ID, email: "teste@apmcb.dev" } } })
      .mockResolvedValueOnce({ data: { user: null } }); // recheck sem usuário → inconclusive
    const client = makeSupabaseClient([]);
    client.auth.getUser = getUser;
    mocks.createClient.mockResolvedValue(client);
    mocks.headersGet.mockImplementation((key: string) => {
      if (key === "x-verified-user-id") return BFF_VERIFIED_ID;
      if (key === "x-pathname") return "/reserva/arsenal";
      return null;
    });

    const DashboardLayout = await loadDashboardLayout();

    // Não deve lançar (não redireciona) — segue até o fim da função e
    // retorna a árvore JSX normalmente.
    await expect(DashboardLayout({ children: null })).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("sem divergência (verifiedUserId === user.id): guard nem é entrado, nenhum recheck, nenhum redirect", async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabaseClient([{ data: { user: { id: BFF_VERIFIED_ID } } }]),
    );
    mocks.headersGet.mockImplementation((key: string) => {
      if (key === "x-verified-user-id") return BFF_VERIFIED_ID;
      if (key === "x-pathname") return "/reserva/arsenal";
      return null;
    });

    const DashboardLayout = await loadDashboardLayout();

    await expect(DashboardLayout({ children: null })).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
    const client = await mocks.createClient.mock.results[0].value;
    // getUser() chamado só 1 vez (1ª leitura) — recheck nunca dispara sem divergência.
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
  });
});
