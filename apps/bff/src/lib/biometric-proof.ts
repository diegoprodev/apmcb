import { verify } from "node:crypto";

export type BiometricChallengeStatus = "pending" | "consumed" | "expired" | "failed";

export interface BiometricChallengeForProof {
  id: string;
  tenant_id: string;
  reserve_id: string;
  device_id: string | null;
  actor_id: string;
  purpose: string;
  expected_user_id: string | null;
  document_type: string | null;
  document_id: string | null;
  document_hash: string | null;
  status: BiometricChallengeStatus;
  expires_at: string;
}

export interface BiometricProofPayload {
  challenge_id: string;
  tenant_id: string;
  reserve_id: string;
  device_id: string;
  actor_id: string;
  purpose: string;
  matched_user_id: string | null;
  document_type: string | null;
  document_id: string | null;
  document_hash: string | null;
  match_score: number;
  finger_index: number | null;
  liveness_passed: boolean | null;
  sdk_version: string | null;
  bridge_version: string | null;
  timestamp: string;
}

export interface BiometricEnrollmentRequest {
  proof: BiometricProofPayload;
  encrypted_template_data: string;
  template_hash: string;
  format: string;
  quality: number;
  bridge_signature: string;
}

export interface BiometricEnrollmentSignedPayload extends BiometricProofPayload {
  template_hash: string;
  format: string;
  quality: number;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalize(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, JsonValue> = {};
    for (const key of Object.keys(input).sort()) {
      const child = input[key];
      if (child !== undefined) output[key] = normalize(child);
    }
    return output;
  }
  throw new Error(`Unsupported biometric payload value: ${typeof value}`);
}

export function canonicalizeBiometricPayload(payload: unknown): string {
  return JSON.stringify(normalize(payload));
}

export function biometricPurposeRequiresExpectedUser(purpose: string): boolean {
  return purpose === "enroll" || purpose === "confirm_saida_militar";
}

export function biometricEnrollmentSignedPayload(
  enrollment: Pick<BiometricEnrollmentRequest, "proof" | "template_hash" | "format" | "quality">,
): BiometricEnrollmentSignedPayload {
  return {
    ...enrollment.proof,
    template_hash: enrollment.template_hash,
    format: enrollment.format,
    quality: enrollment.quality,
  };
}

export function canonicalizeBiometricEnrollmentPayload(
  enrollment: Pick<BiometricEnrollmentRequest, "proof" | "template_hash" | "format" | "quality">,
): string {
  return canonicalizeBiometricPayload(biometricEnrollmentSignedPayload(enrollment));
}

export function verifyBridgeSignature(
  payload: BiometricProofPayload,
  publicKeyPem: string,
  signatureBase64: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalizeBiometricPayload(payload)),
      publicKeyPem,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

export function verifyBiometricEnrollmentSignature(
  enrollment: BiometricEnrollmentRequest,
  publicKeyPem: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalizeBiometricEnrollmentPayload(enrollment)),
      publicKeyPem,
      Buffer.from(enrollment.bridge_signature, "base64"),
    );
  } catch {
    return false;
  }
}

function assertSame(label: string, expected: string | null, actual: string | null): void {
  if (expected !== actual) {
    throw new Error(`biometric proof ${label} mismatch`);
  }
}

export function assertChallengeAcceptsProof(
  challenge: BiometricChallengeForProof,
  proof: BiometricProofPayload,
  nowMs = Date.now(),
): void {
  if (challenge.status !== "pending") {
    throw new Error(`biometric challenge is not pending: ${challenge.status}`);
  }
  if (new Date(challenge.expires_at).getTime() <= nowMs) {
    throw new Error("biometric challenge expired");
  }

  assertSame("challenge_id", challenge.id, proof.challenge_id);
  assertSame("tenant_id", challenge.tenant_id, proof.tenant_id);
  assertSame("reserve_id", challenge.reserve_id, proof.reserve_id);
  if (challenge.device_id) assertSame("device_id", challenge.device_id, proof.device_id);
  assertSame("actor_id", challenge.actor_id, proof.actor_id);
  assertSame("purpose", challenge.purpose, proof.purpose);
  assertSame("document_type", challenge.document_type, proof.document_type);
  assertSame("document_id", challenge.document_id, proof.document_id);
  assertSame("document_hash", challenge.document_hash, proof.document_hash);
}
