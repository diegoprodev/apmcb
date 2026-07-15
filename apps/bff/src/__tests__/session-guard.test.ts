import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkSessionValid } from "../lib/session-guard.ts";

// Fetcher/checker stubs — sem dependência do Supabase real
function makeFetcher(role: string, invalidatedAt: string | null) {
  return async (_userId: string) => ({ role, invalidatedAt });
}

const neverRevoked = async (_sessionId: string) => false;
function makeRevokedChecker(revokedIds: Set<string>) {
  return async (sessionId: string) => revokedIds.has(sessionId);
}

describe("checkSessionValid", () => {
  it("retorna valid=true quando role bate e sem invalidação", async () => {
    const result = await checkSessionValid(
      { userId: "u1", role: "armeiro", issuedAt: Date.now() },
      makeFetcher("armeiro", null),
      neverRevoked,
    );
    assert.equal(result.valid, true);
    assert.equal(result.reason, undefined);
  });

  it("retorna valid=false reason=session_invalidated quando invalidado após login (em massa, admin)", async () => {
    const issuedAt = Date.now() - 5_000;
    const invalidatedAt = new Date(issuedAt + 1_000).toISOString();
    const result = await checkSessionValid(
      { userId: "u2", role: "armeiro", issuedAt },
      makeFetcher("armeiro", invalidatedAt),
      neverRevoked,
    );
    assert.equal(result.valid, false);
    assert.equal(result.reason, "session_invalidated");
  });

  it("retorna valid=true quando invalidado ANTES do login (sessão mais nova)", async () => {
    const invalidatedAt = new Date(Date.now() - 10_000).toISOString();
    const result = await checkSessionValid(
      { userId: "u3", role: "armeiro", issuedAt: Date.now() },
      makeFetcher("armeiro", invalidatedAt),
      neverRevoked,
    );
    assert.equal(result.valid, true);
  });

  it("retorna valid=false reason=role_changed quando role mudou no DB", async () => {
    const result = await checkSessionValid(
      { userId: "u4", role: "armeiro", issuedAt: Date.now() },
      makeFetcher("usuario", null),
      neverRevoked,
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
    await checkSessionValid({ userId: uid, role: "admin_global", issuedAt: Date.now() }, fetcher, neverRevoked);
    await checkSessionValid({ userId: uid, role: "admin_global", issuedAt: Date.now() }, fetcher, neverRevoked);
    assert.equal(calls, 1, "fetcher deve ser chamado apenas 1x graças ao cache de 60s");
  });

  it("retorna valid=false reason=session_invalidated quando ESTA sessão foi revogada individualmente, mesmo com role/profile válidos", async () => {
    const isRevoked = makeRevokedChecker(new Set(["session-abc"]));
    const result = await checkSessionValid(
      { userId: "u5", role: "armeiro", issuedAt: Date.now(), sessionId: "session-abc" },
      makeFetcher("armeiro", null),
      isRevoked,
    );
    assert.equal(result.valid, false);
    assert.equal(result.reason, "session_invalidated");
  });

  it("revogar UMA sessão não invalida outras sessões (sessionId diferente) do mesmo usuário", async () => {
    const isRevoked = makeRevokedChecker(new Set(["session-abc"]));
    const result = await checkSessionValid(
      { userId: "u5", role: "armeiro", issuedAt: Date.now(), sessionId: "session-xyz" },
      makeFetcher("armeiro", null),
      isRevoked,
    );
    assert.equal(result.valid, true, "sessão diferente do mesmo usuário não deve ser afetada pela revogação de outra");
  });

  it("sessão sem sessionId (selada antes da migração) não é checada contra a denylist — não quebra", async () => {
    let checkerCalled = false;
    const isRevoked = async (_sessionId: string) => { checkerCalled = true; return true; };
    const result = await checkSessionValid(
      { userId: "u6", role: "armeiro", issuedAt: Date.now() },
      makeFetcher("armeiro", null),
      isRevoked,
    );
    assert.equal(checkerCalled, false, "isRevoked não deve ser chamado sem sessionId");
    assert.equal(result.valid, true);
  });
});
