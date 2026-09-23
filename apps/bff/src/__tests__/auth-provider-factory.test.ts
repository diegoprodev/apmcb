import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAuthProvider } from "../lib/auth-provider-factory.ts";
import { SupabaseAuthProvider } from "../lib/auth-provider.ts";
import { LocalAuthProvider } from "../lib/local-auth-provider.ts";

describe("createAuthProvider", () => {
  it("modo SUPABASE devolve uma instância de SupabaseAuthProvider", () => {
    const provider = createAuthProvider({
      mode: "SUPABASE",
      supabaseUrl: "https://x.supabase.co",
      supabaseServiceRoleKey: "svc",
    });
    assert.ok(provider instanceof SupabaseAuthProvider);
  });

  it("modo ON_PREMISE devolve uma instância de LocalAuthProvider", () => {
    const provider = createAuthProvider({
      mode: "ON_PREMISE",
      databaseUrl: "postgres://user:pass@localhost:5432/apmcb",
    });
    assert.ok(provider instanceof LocalAuthProvider);
  });
});
