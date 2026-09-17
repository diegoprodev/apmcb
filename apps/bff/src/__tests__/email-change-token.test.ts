import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  generateEmailChangeToken,
  hashEmailChangeToken,
  verifyEmailChangeToken,
} from "../lib/email-change-token.ts";

before(() => {
  process.env.EMAIL_CHANGE_TOKEN_SECRET = "test-secret-only-used-in-unit-tests";
});

describe("generateEmailChangeToken", () => {
  it("gera tokens diferentes a cada chamada (sem colisão em 1000 amostras)", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateEmailChangeToken()));
    assert.equal(tokens.size, 1000);
  });

  it("gera token url-safe (base64url, sem +/=)", () => {
    const token = generateEmailChangeToken();
    assert.match(token, /^[A-Za-z0-9_-]+$/);
  });
});

describe("hashEmailChangeToken / verifyEmailChangeToken", () => {
  it("é determinístico — mesmo token bruto produz sempre o mesmo hash", () => {
    const token = generateEmailChangeToken();
    assert.equal(hashEmailChangeToken(token), hashEmailChangeToken(token));
  });

  it("aceita o par correto (token bruto, hash gerado a partir dele)", () => {
    const token = generateEmailChangeToken();
    const hash = hashEmailChangeToken(token);
    assert.equal(verifyEmailChangeToken(token, hash), true);
  });

  it("rejeita um token bruto diferente contra o mesmo hash", () => {
    const hash = hashEmailChangeToken(generateEmailChangeToken());
    const outroToken = generateEmailChangeToken();
    assert.equal(verifyEmailChangeToken(outroToken, hash), false);
  });

  it("rejeita hash de tamanho diferente sem lançar (timingSafeEqual exige buffers do mesmo tamanho)", () => {
    const token = generateEmailChangeToken();
    assert.equal(verifyEmailChangeToken(token, "abcd"), false);
  });

  it("nunca revela o token bruto no hash (hash não contém o token como substring)", () => {
    const token = generateEmailChangeToken();
    const hash = hashEmailChangeToken(token);
    assert.equal(hash.includes(token), false);
  });
});
