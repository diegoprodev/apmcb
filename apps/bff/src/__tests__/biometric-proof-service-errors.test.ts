import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapBiometricProofError, statusForBiometricProofError } from "../lib/biometric-proof-service.ts";

describe("statusForBiometricProofError", () => {
  it("retorna 409 quando a mensagem indica reuso", () => {
    assert.equal(statusForBiometricProofError(new Error("biometric proof already consumed")), 409);
  });
  it("retorna 401 para todos os outros erros (not found, expired, mismatch)", () => {
    for (const msg of [
      "biometric proof not found",
      "biometric proof expired",
      "biometric proof reserve_id mismatch",
      "biometric proof must be success",
    ]) {
      assert.equal(statusForBiometricProofError(new Error(msg)), 401, msg);
    }
  });
  it("retorna 401 para erro não-Error (string solta, undefined)", () => {
    assert.equal(statusForBiometricProofError("boom"), 401);
    assert.equal(statusForBiometricProofError(undefined), 401);
  });
});

describe("mapBiometricProofError", () => {
  it("devolve a mensagem do Error", () => {
    assert.equal(mapBiometricProofError(new Error("biometric proof expired")), "biometric proof expired");
  });
  it("devolve mensagem genérica para erro não-Error", () => {
    assert.equal(mapBiometricProofError("boom"), "biometric proof invalid");
  });
});
