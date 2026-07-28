import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieGetAll: vi.fn(),
  cookieSet: vi.fn(),
  cookies: vi.fn(),
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("./runtime-env", () => ({
  getSupabaseAnonKey: () => "anon-key",
  getSupabaseUrl: () => "https://project.supabase.co",
}));

describe("Supabase SSR server client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.mockResolvedValue({
      getAll: mocks.cookieGetAll,
      set: mocks.cookieSet,
    });
    mocks.createServerClient.mockReturnValue({ auth: {} });
  });

  it("C — persiste cookies sb-* do verifyOtp como HttpOnly e SameSite=Lax", async () => {
    const { createClient } = await import("./server");
    await createClient();

    const options = mocks.createServerClient.mock.calls[0]?.[2] as {
      cookies: {
        setAll: (
          cookies: Array<{
            name: string;
            value: string;
            options: { path: string; secure: boolean };
          }>,
        ) => void;
      };
    };

    options.cookies.setAll([
      {
        name: "sb-project-auth-token",
        value: "supabase-session",
        options: { path: "/", secure: true },
      },
    ]);

    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "sb-project-auth-token",
      "supabase-session",
      {
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
      },
    );
  });
});
