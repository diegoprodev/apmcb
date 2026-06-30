import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, isEncrypted } from "../lib/crypto.ts";

const KEY = "test-key-must-be-at-least-32-chars-long!!";

describe("encryptSecret / decryptSecret", () => {
  it("round-trip: encrypt → decrypt retorna texto original", async () => {
    const plaintext = "JBSWY3DPEHPK3PXP";
    const encrypted = await encryptSecret(plaintext, KEY);
    const decrypted = await decryptSecret(encrypted, KEY);
    assert.equal(decrypted, plaintext);
  });

  it("encrypt produz texto diferente a cada chamada (IV aleatório)", async () => {
    const plaintext = "JBSWY3DPEHPK3PXP";
    const enc1 = await encryptSecret(plaintext, KEY);
    const enc2 = await encryptSecret(plaintext, KEY);
    assert.notEqual(enc1, enc2, "dois encrypts do mesmo texto devem diferir pelo IV");
  });

  it("encrypted output tem prefixo v1: e base64 válido", async () => {
    const encrypted = await encryptSecret("secret", KEY);
    assert.ok(encrypted.startsWith("v1:"), "deve iniciar com v1:");
    assert.ok(encrypted.length > 20);
    assert.ok(isEncrypted(encrypted));
  });

  it("plaintext Base32 legacy NÃO é detectado como encrypted", () => {
    assert.equal(isEncrypted("JBSWY3DPEHPK3PXP"), false);
  });

  it("decrypt de plaintext legacy retorna o próprio valor (backward compat)", async () => {
    const legacy = "JBSWY3DPEHPK3PXP";
    const result = await decryptSecret(legacy, KEY);
    assert.equal(result, legacy, "plaintext sem prefixo deve passar sem decrypt");
  });

  it("decrypt com chave errada lança erro", async () => {
    const encrypted = await encryptSecret("secret", KEY);
    await assert.rejects(
      () => decryptSecret(encrypted, "wrong-key-also-32-chars-long!!!"),
    );
  });

  it("decrypt com ciphertext v1: corrompido lança erro", async () => {
    // Prefixo v1: presente mas payload inválido (GCM tag check falha)
    await assert.rejects(
      () => decryptSecret("v1:ZGFkb3NpbnZhbGlkb3M=", KEY),
    );
  });
});
