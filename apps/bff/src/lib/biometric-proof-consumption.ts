const DEFAULT_PROOF_TTL_MS = 2 * 60_000;

export interface BiometricProofForConsumption {
  id: string;
  tenant_id: string;
  reserve_id: string;
  actor_id: string;
  matched_user_id: string | null;
  purpose: string;
  document_id: string | null;
  document_hash: string | null;
  result: string;
  created_at: string;
  consumed?: boolean;
}

export interface BiometricProofConsumptionContext {
  tenantId: string;
  reserveId: string;
  actorId: string;
  purpose: string;
  expectedUserId?: string | null;
  documentId?: string | null;
  documentHash?: string | null;
  nowMs?: number;
  proofTtlMs?: number;
}

export interface ConsumeBiometricProofContext extends BiometricProofConsumptionContext {
  proofId: string;
  operationType: string;
  operationId?: string | null;
}

interface SupabaseInsertResult {
  error: { code?: string; message?: string } | null;
}

interface SupabaseLike {
  from(table: "biometric_proof_consumptions"): {
    insert(row: {
      proof_id: string;
      tenant_id: string;
      reserve_id: string;
      actor_id: string;
      operation_type: string;
      operation_id: string | null;
    }): PromiseLike<SupabaseInsertResult>;
  };
}

function assertSame(label: string, expected: string | null | undefined, actual: string | null | undefined): void {
  if ((expected ?? null) !== (actual ?? null)) {
    throw new Error(`biometric proof ${label} mismatch`);
  }
}

export function assertUsableBiometricProof(
  proof: BiometricProofForConsumption,
  context: BiometricProofConsumptionContext,
): void {
  if (proof.result !== "success") {
    throw new Error("biometric proof must be success");
  }
  if (proof.consumed === true) {
    throw new Error("biometric proof already consumed");
  }

  const nowMs = context.nowMs ?? Date.now();
  const createdAtMs = new Date(proof.created_at).getTime();
  if (!Number.isFinite(createdAtMs) || createdAtMs + (context.proofTtlMs ?? DEFAULT_PROOF_TTL_MS) <= nowMs) {
    throw new Error("biometric proof expired");
  }

  assertSame("tenant_id", context.tenantId, proof.tenant_id);
  assertSame("reserve_id", context.reserveId, proof.reserve_id);
  assertSame("actor_id", context.actorId, proof.actor_id);
  assertSame("purpose", context.purpose, proof.purpose);

  if (context.expectedUserId) {
    assertSame("expected_user", context.expectedUserId, proof.matched_user_id);
  }
  if (context.documentId) {
    assertSame("document_id", context.documentId, proof.document_id);
  }
  if (context.documentHash) {
    assertSame("document_hash", context.documentHash, proof.document_hash);
  }
}

export async function consumeBiometricProof(
  db: SupabaseLike,
  proof: BiometricProofForConsumption,
  context: ConsumeBiometricProofContext,
): Promise<void> {
  assertUsableBiometricProof(proof, context);

  const { error } = await db.from("biometric_proof_consumptions").insert({
    proof_id: context.proofId,
    tenant_id: context.tenantId,
    reserve_id: context.reserveId,
    actor_id: context.actorId,
    operation_type: context.operationType,
    operation_id: context.operationId ?? null,
  });

  if (error?.code === "23505") {
    throw new Error("biometric proof already consumed");
  }
  if (error) {
    throw new Error("could not consume biometric proof");
  }
}
