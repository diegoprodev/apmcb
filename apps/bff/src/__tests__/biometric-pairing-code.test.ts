import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { generatePairingCode, hashPairingCode } from "../lib/biometric-pairing-code.ts";

describe("generatePairingCode", () => {
  it("segue o formato APMCB-XXXX-XXXX", () => {
    const code = generatePairingCode();
    assert.match(code, /^APMCB-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
  });

  it("nunca usa caracteres ambíguos (I, L, O, U)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePairingCode();
      assert.equal(/[ILOU]/.test(code), false, `código não deve conter I/L/O/U: ${code}`);
    }
  });

  it("gera códigos distintos entre chamadas (não determinístico)", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generatePairingCode()));
    assert.ok(codes.size > 45, "colisões demais para 50 gerações — RNG suspeito");
  });
});

describe("hashPairingCode", () => {
  const originalPepper = process.env.BIOMETRIC_PAIRING_CODE_PEPPER;

  before(() => {
    process.env.BIOMETRIC_PAIRING_CODE_PEPPER = "test-pepper-nao-usar-em-producao";
  });
  after(() => {
    if (originalPepper === undefined) delete process.env.BIOMETRIC_PAIRING_CODE_PEPPER;
    else process.env.BIOMETRIC_PAIRING_CODE_PEPPER = originalPepper;
  });

  it("é determinístico para o mesmo código e pepper", () => {
    const code = generatePairingCode();
    assert.equal(hashPairingCode(code), hashPairingCode(code));
  });

  it("é insensível a maiúsculas/minúsculas e a espaços nas bordas (digitação manual no bridge)", () => {
    const code = "APMCB-7H4K-2Q9P";
    assert.equal(hashPairingCode(code), hashPairingCode(code.toLowerCase()));
    assert.equal(hashPairingCode(code), hashPairingCode(`  ${code}  `));
  });

  it("nunca retorna o código em texto puro — saída é hex de 64 chars (SHA-256)", () => {
    const hash = hashPairingCode(generatePairingCode());
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("dois códigos diferentes produzem hashes diferentes", () => {
    assert.notEqual(hashPairingCode("APMCB-AAAA-AAAA"), hashPairingCode("APMCB-BBBB-BBBB"));
  });

  it("falha fechado (lança) sem BIOMETRIC_PAIRING_CODE_PEPPER configurada — nunca hasheia sem pepper", () => {
    delete process.env.BIOMETRIC_PAIRING_CODE_PEPPER;
    assert.throws(() => hashPairingCode("APMCB-AAAA-AAAA"), /BIOMETRIC_PAIRING_CODE_PEPPER/);
    process.env.BIOMETRIC_PAIRING_CODE_PEPPER = "test-pepper-nao-usar-em-producao";
  });
});
