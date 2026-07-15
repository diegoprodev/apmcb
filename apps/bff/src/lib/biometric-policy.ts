import type { BiometricProofPayload } from "./biometric-proof.ts";

export type BiometricSubjectStatus = "complete" | "pending" | "pending_biometric" | "inactive" | "impedimento_administrativo";

export interface BiometricPolicyInput {
  proof: BiometricProofPayload;
  minScore: number;
  activeTenantId: string;
  activeReserveId: string;
  expectedUserId?: string | null;
  matchedUserStatus?: BiometricSubjectStatus | null;
}

export function assertBiometricPolicy(input: BiometricPolicyInput): void {
  const { proof, minScore, activeTenantId, activeReserveId, expectedUserId, matchedUserStatus } = input;

  if (proof.tenant_id !== activeTenantId) {
    throw new Error("biometric policy tenant mismatch");
  }
  if (proof.reserve_id !== activeReserveId) {
    throw new Error("biometric policy reserve mismatch");
  }
  if (proof.match_score < minScore) {
    throw new Error("biometric policy score below threshold");
  }
  if (expectedUserId && proof.matched_user_id !== expectedUserId) {
    throw new Error("biometric policy expected_user mismatch");
  }
  if (matchedUserStatus === "inactive") {
    throw new Error("biometric policy matched user status inactive");
  }
  if (matchedUserStatus === "pending") {
    throw new Error("biometric policy matched user status pending");
  }
  if (matchedUserStatus === "pending_biometric") {
    throw new Error("biometric policy matched user status pending_biometric");
  }
  if (matchedUserStatus === "impedimento_administrativo") {
    throw new Error("biometric policy matched user has impedimento_administrativo");
  }
}
