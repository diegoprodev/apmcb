import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { SupabaseAuthProvider, AuthError } from "../lib/auth-provider.ts";

function fakeFetch(responses: Record<string, { status: number; body: unknown }>) {
  return mock.fn(async (input: string | URL) => {
    const url = input.toString();
    for (const [match, res] of Object.entries(responses)) {
      if (url.includes(match)) {
        return new Response(JSON.stringify(res.body), { status: res.status });
      }
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

describe("SupabaseAuthProvider.login", () => {
  it("chama /auth/v1/token com grant_type=password e devolve a identidade", async () => {
    const fetchImpl = fakeFetch({
      "/auth/v1/token": {
        status: 200,
        body: { access_token: "tok", user: { id: "u1", email: "a@x.com" } },
      },
    });
    const provider = new SupabaseAuthProvider({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const identity = await provider.login("a@x.com", "senha123");

    assert.equal(identity.userId, "u1");
    assert.equal(identity.email, "a@x.com");
    assert.equal(identity.accessToken, "tok");
    const [calledUrl] = fetchImpl.mock.calls[0].arguments;
    assert.match(calledUrl.toString(), /grant_type=password/);
  });

  it("lança AuthError(invalid_credentials) quando a Supabase rejeita", async () => {
    const fetchImpl = fakeFetch({
      "/auth/v1/token": { status: 400, body: { error: "invalid_grant" } },
    });
    const provider = new SupabaseAuthProvider({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await assert.rejects(
      () => provider.login("a@x.com", "errada"),
      (err: unknown) => err instanceof AuthError && err.code === "invalid_credentials",
    );
  });
});

describe("SupabaseAuthProvider.verifyAccessToken", () => {
  it("chama /auth/v1/user com Bearer e devolve a identidade", async () => {
    const fetchImpl = fakeFetch({
      "/auth/v1/user": { status: 200, body: { id: "u1", email: "a@x.com" } },
    });
    const provider = new SupabaseAuthProvider({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const identity = await provider.verifyAccessToken("tok");

    assert.equal(identity.userId, "u1");
    const [, init] = fetchImpl.mock.calls[0].arguments as [string, RequestInit];
    assert.equal((init.headers as Record<string, string>).Authorization, "Bearer tok");
  });

  it("lança AuthError(invalid_token) quando o token não valida", async () => {
    const fetchImpl = fakeFetch({ "/auth/v1/user": { status: 401, body: {} } });
    const provider = new SupabaseAuthProvider({
      url: "https://x.supabase.co",
      serviceRoleKey: "svc",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await assert.rejects(
      () => provider.verifyAccessToken("bad"),
      (err: unknown) => err instanceof AuthError && err.code === "invalid_token",
    );
  });
});
