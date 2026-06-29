import { describe, expect, it, vi } from "vitest";

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: () => ({
    env: {
      SUPABASE_URL: "https://cf-env.supabase.co",
      SUPABASE_ANON_KEY: "cf-anon-key",
    },
  }),
}));

describe("Supabase runtime env", () => {
  it("reads Supabase public config from Cloudflare env when process.env is absent", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const { getSupabaseAnonKey, getSupabaseUrl } = await import("./runtime-env");

    expect(getSupabaseUrl()).toBe("https://cf-env.supabase.co");
    expect(getSupabaseAnonKey()).toBe("cf-anon-key");
  });
});
