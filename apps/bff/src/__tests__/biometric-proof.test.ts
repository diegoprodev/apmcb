import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  assertChallengeAcceptsProof,
  canonicalizeBiometricPayload,
  verifyBridgeSignature,
  type BiometricChallengeForProof,
  type BiometricProofPayload,
} from "../lib/biometric-proof.ts";
import { assertBiometricPolicy } from "../lib/biometric-policy.ts";

const ids = {
  challenge: "11111111-1111-4111-8111-111111111111",
  tenant: "22222222-2222-4222-8222-222222222222",
  reserve: "33333333-3333-4333-8333-333333333333",
  device: "44444444-4444-4444-8444-444444444444",
  actor: "55555555-5555-4555-8555-555555555555",
  matched: "66666666-6666-4666-8666-666666666666",
  document: "77777777-7777-4777-8777-777777777777",
};

function keyPair() {
  return generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function challenge(patch: Partial<BiometricChallengeForProof> = {}): BiometricChallengeForProof {
  return {
    id: ids.challenge,
    tenant_id: ids.tenant,
    reserve_id: ids.reserve,
    device_id: ids.device,
    actor_id: ids.actor,
    purpose: "identify",
    expected_user_id: null,
    document_type: null,
    document_id: null,
    document_hash: null,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    ...patch,
  };
}

function proof(patch: Partial<BiometricProofPayload> = {}): BiometricProofPayload {
  return {
    challenge_id: ids.challenge,
    tenant_id: ids.tenant,
    reserve_id: ids.reserve,
    device_id: ids.device,
    actor_id: ids.actor,
    purpose: "identify",
    matched_user_id: ids.matched,
    document_type: null,
    document_id: null,
    document_hash: null,
    match_score: 0.97,
    finger_index: 2,
    liveness_passed: true,
    sdk_version: "5.2.0.6",
    bridge_version: "0.1.0",
    timestamp: new Date().toISOString(),
    ...patch,
  };
}

describe("canonicalizeBiometricPayload", () => {
  it("is deterministic independent of object key order", () => {
    const a = canonicalizeBiometricPayload({ b: 2, a: 1, nested: { z: true, c: "x" } });
    const b = canonicalizeBiometricPayload({ nested: { c: "x", z: true }, a: 1, b: 2 });
    assert.equal(a, b);
  });
});

describe("verifyBridgeSignature", () => {
  it("accepts a valid Ed25519 signature for the canonical proof payload", () => {
    const { publicKey, privateKey } = keyPair();
    const payload = proof();
    const signature = sign(null, Buffer.from(canonicalizeBiometricPayload(payload)), privateKey).toString("base64");

    assert.equal(verifyBridgeSignature(payload, publicKey, signature), true);
  });

  it("rejects a signature after payload tampering", () => {
    const { publicKey, privateKey } = keyPair();
    const payload = proof();
    const signature = sign(null, Buffer.from(canonicalizeBiometricPayload(payload)), privateKey).toString("base64");

    assert.equal(verifyBridgeSignature({ ...payload, match_score: 0.10 }, publicKey, signature), false);
  });
});

describe("assertChallengeAcceptsProof", () => {
  it("accepts matching pending challenge and proof", () => {
    assert.doesNotThrow(() => assertChallengeAcceptsProof(challenge(), proof(), Date.now()));
  });

  it("rejects expired challenge", () => {
    assert.throws(
      () => assertChallengeAcceptsProof(challenge({ expires_at: new Date(Date.now() - 1_000).toISOString() }), proof(), Date.now()),
      /expired/i,
    );
  });

  it("rejects consumed challenge", () => {
    assert.throws(
      () => assertChallengeAcceptsProof(challenge({ status: "consumed" }), proof(), Date.now()),
      /not pending/i,
    );
  });

  it("rejects tenant, reserve, device, purpose and document mismatches", () => {
    assert.throws(() => assertChallengeAcceptsProof(challenge(), proof({ tenant_id: ids.reserve }), Date.now()), /tenant/i);
    assert.throws(() => assertChallengeAcceptsProof(challenge(), proof({ reserve_id: ids.tenant }), Date.now()), /reserve/i);
    assert.throws(() => assertChallengeAcceptsProof(challenge(), proof({ device_id: ids.tenant }), Date.now()), /device/i);
    assert.throws(() => assertChallengeAcceptsProof(challenge(), proof({ purpose: "enroll" }), Date.now()), /purpose/i);
    assert.throws(
      () => assertChallengeAcceptsProof(
        challenge({ document_hash: "h1", document_id: ids.document, document_type: "saida" }),
        proof({ document_hash: "h2", document_id: ids.document, document_type: "saida" }),
        Date.now(),
      ),
      /document_hash/i,
    );
  });
});

describe("assertBiometricPolicy", () => {
  it("accepts tenant-wide identify with sufficient score", () => {
    assert.doesNotThrow(() => assertBiometricPolicy({
      proof: proof(),
      minScore: 0.92,
      activeTenantId: ids.tenant,
      activeReserveId: ids.reserve,
    }));
  });

  it("rejects expected user mismatch", () => {
    assert.throws(() => assertBiometricPolicy({
      proof: proof(),
      minScore: 0.92,
      activeTenantId: ids.tenant,
      activeReserveId: ids.reserve,
      expectedUserId: ids.actor,
    }), /expected_user/i);
  });

  it("rejects low score and inactive or impeded matched user", () => {
    assert.throws(() => assertBiometricPolicy({
      proof: proof({ match_score: 0.10 }),
      minScore: 0.92,
      activeTenantId: ids.tenant,
      activeReserveId: ids.reserve,
    }), /score/i);

    assert.throws(() => assertBiometricPolicy({
      proof: proof(),
      minScore: 0.92,
      activeTenantId: ids.tenant,
      activeReserveId: ids.reserve,
      matchedUserStatus: "inactive",
    }), /status/i);

    assert.throws(() => assertBiometricPolicy({
      proof: proof(),
      minScore: 0.92,
      activeTenantId: ids.tenant,
      activeReserveId: ids.reserve,
      matchedUserStatus: "pending",
    }), /pending/i);

    assert.throws(() => assertBiometricPolicy({
      proof: proof(),
      minScore: 0.92,
      activeTenantId: ids.tenant,
      activeReserveId: ids.reserve,
      matchedUserStatus: "pending_biometric",
    }), /pending_biometric/i);

    assert.throws(() => assertBiometricPolicy({
      proof: proof(),
      minScore: 0.92,
      activeTenantId: ids.tenant,
      activeReserveId: ids.reserve,
      matchedUserStatus: "impedimento_administrativo",
    }), /impedimento/i);
  });
});
