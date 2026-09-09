import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkSsaRegistrationGate } from "../lib/ssa-registration-gate.ts";

describe("checkSsaRegistrationGate", () => {
  it("complete → passa", () => {
    const r = checkSsaRegistrationGate("complete", false);
    assert.equal(r.allowed, true);
    assert.equal(r.status, null);
  });

  it("pending_biometric → PASSA (biometria não é pré-requisito de uso)", () => {
    const r = checkSsaRegistrationGate("pending_biometric", false);
    assert.equal(r.allowed, true);
    assert.equal(r.status, null);
  });

  it("impedimento_administrativo → 403 com mensagem própria", () => {
    const r = checkSsaRegistrationGate("impedimento_administrativo", false);
    assert.equal(r.allowed, false);
    assert.equal(r.status, 403);
    assert.match(r.error!, /impedimento administrativo/i);
  });

  it("inactive → 403 com mensagem própria", () => {
    const r = checkSsaRegistrationGate("inactive", false);
    assert.equal(r.allowed, false);
    assert.equal(r.status, 403);
    assert.match(r.error!, /inativa/i);
  });

  it("null/undefined (profile não encontrado) → passa, não crash", () => {
    for (const s of [null, undefined]) {
      const r = checkSsaRegistrationGate(s, false);
      assert.equal(r.allowed, true);
    }
  });

  it("falha da query (lookupFailed) → 503, NUNCA 403 enganoso — mesmo com status 'complete'", () => {
    for (const s of ["complete", "pending_biometric", null]) {
      const r = checkSsaRegistrationGate(s, true);
      assert.equal(r.allowed, false);
      assert.equal(r.status, 503);
      assert.match(r.error!, /tente novamente/i);
    }
  });
});
