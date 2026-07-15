import { supabase } from "../services/supabase";
import {
  assertUsableBiometricProof,
  type BiometricProofConsumptionContext,
  type BiometricProofForConsumption,
} from "./biometric-proof-consumption";

export interface LoadedBiometricProof {
  proof: BiometricProofForConsumption;
  existingConsumption: {
    operation_type: string;
    operation_id: string | null;
  } | null;
}

export async function loadBiometricProof(proofId: string, tenantId: string): Promise<LoadedBiometricProof> {
  const { data: proof, error: proofError } = await supabase
    .from("biometric_proofs")
    .select("id, tenant_id, reserve_id, actor_id, matched_user_id, purpose, document_id, document_hash, result, created_at")
    .eq("id", proofId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (proofError) throw new Error("could not load biometric proof");
  if (!proof) throw new Error("biometric proof not found");

  const { data: consumption, error: consumptionError } = await supabase
    .from("biometric_proof_consumptions")
    .select("operation_type, operation_id")
    .eq("proof_id", proofId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (consumptionError) throw new Error("could not load biometric proof consumption");

  return {
    proof: { ...proof, consumed: !!consumption } as BiometricProofForConsumption,
    existingConsumption: consumption ?? null,
  };
}

// Valida escopo (tenant/reserve/actor/expected_user), propósito e janela de
// validade da prova — NÃO valida consumo prévio (sempre passa consumed:false
// adiante). O bloqueio real de replay é feito pela constraint
// unique(proof_id) em biometric_proof_consumptions, exercida dentro das RPCs
// (record_lending_batch/record_lending_returns) — banco como fonte de
// verdade, não o BFF. Renomeado de assertLoadedBiometricProof (achado de code
// review: o nome antigo sugeria uma checagem de "já consumido" que não existe
// aqui).
export function assertProofScopeAndFreshness(
  loaded: LoadedBiometricProof,
  context: BiometricProofConsumptionContext,
): void {
  assertUsableBiometricProof({ ...loaded.proof, consumed: false }, context);
}

