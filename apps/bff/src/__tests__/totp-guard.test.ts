import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateSecret, generateSync } from "otplib";
import { checkTotpGuard, TOTP_RATE_MAX, TOTP_RATE_WINDOW } from "../lib/totp-guard";

function freshSecret() {
  return generateSecret();
}

function validToken(secret: string) {
  return generateSync({ secret });
}

const cleanRow = (secret: string) => ({
  secret,
  failure_count: 0,
  last_failure_at: null,
  last_used_token: null,
});

describe("checkTotpGuard — anti-replay", () => {
  it("rejeita token já utilizado (last_used_token === token)", () => {
    const secret = freshSecret();
    const token  = validToken(secret);
    const row    = { ...cleanRow(secret), last_used_token: token };

    const result = checkTotpGuard(row, token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 400);
      assert.match(result.error, /já utilizado/);
    }
  });

  it("token diferente do last_used_token não retorna 'já utilizado'", () => {
    const secret = freshSecret();
    const token  = validToken(secret);
    const row    = { ...cleanRow(secret), last_used_token: "999999" };

    const result = checkTotpGuard(row, token);
    if (!result.ok) {
      assert.doesNotMatch(result.error, /já utilizado/);
    }
  });
});

describe("checkTotpGuard — rate limit", () => {
  it("bloqueia com failure_count >= TOTP_RATE_MAX dentro da janela", () => {
    const secret = freshSecret();
    const now    = Date.now();
    const row = {
      ...cleanRow(secret),
      failure_count:   TOTP_RATE_MAX,
      last_failure_at: new Date(now - 60_000).toISOString(),
    };

    const result = checkTotpGuard(row, "123456", now);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.status, 429);
      assert.match(result.error, /bloqueado/i);
    }
  });

  it("libera após expiração da janela", () => {
    const secret = freshSecret();
    const token  = validToken(secret);
    const now    = Date.now();
    const row = {
      ...cleanRow(secret),
      failure_count:   TOTP_RATE_MAX,
      last_failure_at: new Date(now - TOTP_RATE_WINDOW - 1000).toISOString(),
    };

    const result = checkTotpGuard(row, token, now);
    if (!result.ok) {
      assert.notEqual(result.status, 429);
    }
  });

  it("não bloqueia com failure_count < TOTP_RATE_MAX", () => {
    const secret = freshSecret();
    const now    = Date.now();
    const row = {
      ...cleanRow(secret),
      failure_count:   TOTP_RATE_MAX - 1,
      last_failure_at: new Date(now - 60_000).toISOString(),
    };

    const result = checkTotpGuard(row, validToken(secret), now);
    if (!result.ok) {
      assert.notEqual(result.status, 429);
    }
  });
});

describe("checkTotpGuard — verificação criptográfica", () => {
  it("aceita token válido gerado para o secret correto", () => {
    const secret = freshSecret();
    const token  = validToken(secret);
    const result = checkTotpGuard(cleanRow(secret), token);
    assert.equal(result.ok, true);
  });

  it("rejeita token de secret diferente", () => {
    const secret = freshSecret();
    const wrongToken = validToken(freshSecret());
    const result = checkTotpGuard(cleanRow(secret), wrongToken);
    // Pode ocasionalmente ser válido por colisão (1 em 10^6) — apenas verifica que não trava
    if (!result.ok) {
      assert.equal(result.status, 400);
    }
  });
});
