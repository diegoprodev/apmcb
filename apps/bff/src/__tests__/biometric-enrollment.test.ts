import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  biometricPurposeRequiresExpectedUser,
  canonicalizeBiometricEnrollmentPayload,
  verifyBiometricEnrollmentSignature,
  type BiometricChallengeForProof,
  type BiometricEnrollmentRequest,
} from "../lib/biometric-proof.ts";
import {
  recordBiometricEnrollment,
  validateBiometricEnrollment,
  type BiometricEnrollmentContext,
} from "../lib/biometric-enrollment.ts";

const fixture = JSON.parse(readFileSync(
  resolve(import.meta.dirname, "fixtures", "biometric-enrollment-vector.json"),
  "utf8",
)) as BiometricEnrollmentRequest & {
  canonical_payload: string;
  public_key_pem: string;
};

const proof = fixture.proof;

function challenge(overrides: Partial<BiometricChallengeForProof> = {}): BiometricChallengeForProof {
  return {
    id: proof.challenge_id,
    tenant_id: proof.tenant_id,
    reserve_id: proof.reserve_id,
    device_id: proof.device_id,
    actor_id: proof.actor_id,
    purpose: "enroll",
    expected_user_id: proof.matched_user_id,
    document_type: null,
    document_id: null,
    document_hash: null,
    status: "pending",
    expires_at: "2026-07-15T12:35:30.000Z",
    ...overrides,
  };
}

function context(overrides: Partial<BiometricEnrollmentContext> = {}): BiometricEnrollmentContext {
  return {
    activeTenantId: proof.tenant_id,
    activeReserveId: proof.reserve_id,
    actorId: proof.actor_id,
    challenge: challenge(),
    device: {
      id: proof.device_id,
      tenant_id: proof.tenant_id,
      reserve_id: proof.reserve_id,
      public_key: fixture.public_key_pem,
      status: "active",
    },
    targetUser: {
      id: proof.matched_user_id!,
      default_tenant_id: proof.tenant_id,
      registration_status: "pending_biometric",
    },
    minQuality: 70,
    maxTemplateBytes: 1024,
    nowMs: Date.parse("2026-07-15T12:35:00.000Z"),
    ...overrides,
  };
}

describe("biometric enrollment canonical contract", () => {
  it("matches the fixed cross-platform hash, serialization and Ed25519 signature vector", () => {
    assert.equal(canonicalizeBiometricEnrollmentPayload(fixture), fixture.canonical_payload);
    assert.equal(verifyBiometricEnrollmentSignature(fixture, fixture.public_key_pem), true);

    const validated = validateBiometricEnrollment(fixture, context());
    assert.equal(validated.templateHash, fixture.template_hash);
    assert.equal(Buffer.from(validated.templateData).toString("base64"), fixture.encrypted_template_data);
  });

  it("rejects ciphertext, hash and signed capture metadata tampering", () => {
    assert.throws(
      () => validateBiometricEnrollment({ ...fixture, encrypted_template_data: "ABEiM0RVZneImaq7zN3u/0FQTUNCLVBIQVNFMUEz" }, context()),
      /hash/i,
    );
    assert.throws(
      () => validateBiometricEnrollment({ ...fixture, template_hash: `sha256:${"0".repeat(64)}` }, context()),
      /hash/i,
    );
    assert.throws(
      () => validateBiometricEnrollment({ ...fixture, quality: 89 }, context()),
      /signature/i,
    );
  });

  it("enforces canonical RFC4648 base64 and template limits", () => {
    assert.throws(
      () => validateBiometricEnrollment({ ...fixture, encrypted_template_data: `${fixture.encrypted_template_data}=` }, context()),
      /base64/i,
    );
    assert.throws(() => validateBiometricEnrollment(fixture, context({ maxTemplateBytes: 8 })), /size/i);
    assert.throws(() => validateBiometricEnrollment(fixture, context({ minQuality: Number.NaN })), /configuration/i);
    assert.throws(() => validateBiometricEnrollment({ ...fixture, format: "unknown" }, context()), /format/i);
    assert.throws(() => validateBiometricEnrollment({ ...fixture, quality: 69 }, context()), /quality/i);
    assert.throws(
      () => validateBiometricEnrollment({ ...fixture, proof: { ...proof, finger_index: null } }, context()),
      /finger/i,
    );
    assert.throws(
      () => validateBiometricEnrollment({ ...fixture, proof: { ...proof, liveness_passed: false } }, context()),
      /liveness/i,
    );
  });

  it("binds tenant, reserve, actor, device, expected user, purpose and challenge TTL", () => {
    assert.throws(() => validateBiometricEnrollment(fixture, context({ activeTenantId: proof.reserve_id })), /tenant/i);
    assert.throws(() => validateBiometricEnrollment(fixture, context({ activeReserveId: proof.tenant_id })), /reserve/i);
    assert.throws(() => validateBiometricEnrollment(fixture, context({ actorId: proof.tenant_id })), /actor/i);
    assert.throws(
      () => validateBiometricEnrollment(fixture, context({ challenge: challenge({ expected_user_id: null }) })),
      /expected_user/i,
    );
    assert.throws(
      () => validateBiometricEnrollment(fixture, context({ challenge: challenge({ expires_at: "2026-07-15T12:34:00.000Z" }) })),
      /expired/i,
    );
    assert.throws(
      () => validateBiometricEnrollment(fixture, context({ device: { ...context().device, status: "revoked" } })),
      /device/i,
    );
    assert.throws(
      () => validateBiometricEnrollment(
        { ...fixture, proof: { ...proof, device_id: proof.tenant_id } },
        context({ challenge: challenge({ device_id: null }) }),
      ),
      /device/i,
    );
    assert.throws(
      () => validateBiometricEnrollment({ ...fixture, proof: { ...proof, purpose: "identify" } }, context()),
      /purpose/i,
    );
  });

  it("accepts a tenant-wide target user independent of the enrollment reserve", () => {
    assert.doesNotThrow(() => validateBiometricEnrollment(fixture, context()));
    assert.throws(
      () => validateBiometricEnrollment(fixture, context({
        targetUser: { ...context().targetUser, default_tenant_id: proof.reserve_id },
      })),
      /target user tenant/i,
    );
  });
});

describe("recordBiometricEnrollment", () => {
  it("uses the enrollment RPC once and returns only allowlisted metadata", async () => {
    const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const db = {
      rpc(name: string, params: Record<string, unknown>) {
        calls.push({ name, params });
        return {
          async single() {
            return {
              data: {
                proof_id: "77777777-7777-4777-8777-777777777777",
                finger_index: 2,
                quality: 88,
                created_at: "2026-07-15T12:35:00.000Z",
                updated_at: "2026-07-15T12:35:00.000Z",
                template_data: "must-not-leak",
                template_hash: fixture.template_hash,
                bridge_signature: fixture.bridge_signature,
              },
              error: null,
            };
          },
        };
      },
    };

    const result = await recordBiometricEnrollment(db, fixture, context());

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.name, "record_biometric_enrollment");
    assert.match(String(calls[0]?.params.p_template_data), /^\\x[0-9a-f]+$/);
    assert.deepEqual(Object.keys(result).sort(), ["created_at", "finger_index", "proof_id", "quality", "updated_at"]);
    assert.equal(JSON.stringify(result).includes("template"), false);
    assert.equal(JSON.stringify(result).includes("signature"), false);
    assert.equal(JSON.stringify(result).includes("hash"), false);
  });
});

describe("enrollment route contract", () => {
  it("requires expected users for identity-bound challenge purposes", () => {
    assert.equal(biometricPurposeRequiresExpectedUser("enroll"), true);
    assert.equal(biometricPurposeRequiresExpectedUser("confirm_saida_militar"), true);
    assert.equal(biometricPurposeRequiresExpectedUser("identify"), false);
  });

  it("routes real and simulator enrollment through the shared service", () => {
    const repoRoot = resolve(process.cwd(), "..", "..");
    const biometric = readFileSync(resolve(repoRoot, "apps/bff/src/routes/biometric.ts"), "utf8");
    const simulator = readFileSync(resolve(repoRoot, "apps/bff/src/routes/biometric-simulator.ts"), "utf8");

    assert.match(biometric, /BIOMETRIC_ENROLLMENT_ENDPOINT_REQUIRED/);
    assert.match(biometric, /enroll-submit/);
    assert.match(simulator, /"\/challenges\/:id\/enroll"/);
    assert.match(simulator, /recordBiometricEnrollment/);
  });
});
