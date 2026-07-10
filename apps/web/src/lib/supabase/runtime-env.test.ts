import { describe, expect, it, vi } from "vitest";

let cfEnv: Record<string, string | undefined> = {
  SUPABASE_URL: "https://cf-env.supabase.co",
  SUPABASE_ANON_KEY: "cf-anon-key",
};

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env: cfEnv }),
}));

describe("Supabase runtime env", () => {
  it("reads Supabase public config from Cloudflare env when process.env is absent", async () => {
    cfEnv = {
      SUPABASE_URL: "https://cf-env.supabase.co",
      SUPABASE_ANON_KEY: "cf-anon-key",
    };
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const { getSupabaseAnonKey, getSupabaseUrl } = await import("./runtime-env");

    expect(getSupabaseUrl()).toBe("https://cf-env.supabase.co");
    expect(getSupabaseAnonKey()).toBe("cf-anon-key");
  });

  it("never returns empty Supabase config when Cloudflare env is unavailable", async () => {
    cfEnv = {};
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const { getSupabaseAnonKey, getSupabaseUrl } = await import("./runtime-env");

    expect(getSupabaseUrl()).toContain(".supabase.co");
    expect(getSupabaseAnonKey()).toMatch(/^eyJ/);
  });
});
