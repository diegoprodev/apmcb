import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkSessionValid } from "../lib/session-guard.ts";

// Fetcher stub — sem dependência do Supabase real
function makeFetcher(role: string, invalidatedAt: string | null) {
  return async (_userId: string) => ({ role, invalidatedAt });
}

describe("checkSessionValid", () => {
  it("retorna valid=true quando role bate e sem invalidação", async () => {
    const result = await checkSessionValid(
      { userId: "u1", role: "armeiro", issuedAt: Date.now() },
      makeFetcher("armeiro", null),
    );
    assert.equal(result.valid, true);
    assert.equal(result.reason, undefined);
  });

  it("retorna valid=false reason=session_invalidated quando invalidado após login", async () => {
    const issuedAt = Date.now() - 5_000;
    const invalidatedAt = new Date(issuedAt + 1_000).toISOString();
    const result = await checkSessionValid(
      { userId: "u2", role: "armeiro", issuedAt },
      makeFetcher("armeiro", invalidatedAt),
    );
    assert.equal(result.valid, false);
    assert.equal(result.reason, "session_invalidated");
  });

  it("retorna valid=true quando invalidado ANTES do login (sessão mais nova)", async () => {
    const invalidatedAt = new Date(Date.now() - 10_000).toISOString();
    const result = await checkSessionValid(
      { userId: "u3", role: "armeiro", issuedAt: Date.now() },
      makeFetcher("armeiro", invalidatedAt),
    );
    assert.equal(result.valid, true);
  });

  it("retorna valid=false reason=role_changed quando role mudou no DB", async () => {
    const result = await checkSessionValid(
      { userId: "u4", role: "armeiro", issuedAt: Date.now() },
      makeFetcher("usuario", null),
    );
    assert.equal(result.valid, false);
    assert.equal(result.reason, "role_changed");
  });

  it("cache: chama fetcher apenas 1x para o mesmo userId dentro de 60s", async () => {
    let calls = 0;
    const fetcher = async (_: string) => {
      calls++;
      return { role: "admin_global", invalidatedAt: null };
    };
    // Usar userId único para não colidir com cache de outros testes
    const uid = "cache-test-" + Date.now();
    await checkSessionValid({ userId: uid, role: "admin_global", issuedAt: Date.now() }, fetcher);
    await checkSessionValid({ userId: uid, role: "admin_global", issuedAt: Date.now() }, fetcher);
    assert.equal(calls, 1, "fetcher deve ser chamado apenas 1x graças ao cache de 60s");
  });
});
