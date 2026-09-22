import { verifySync } from "otplib";
import { supabase } from "../services/supabase";
import { readSecret } from "../routes/totp";
import { logger } from "./logger";
import {
  loadBiometricProof,
  assertProofScopeAndFreshness,
  statusForBiometricProofError,
  mapBiometricProofError,
  type LoadedBiometricProof,
} from "./biometric-proof-service";

const RATE_LIMIT_MAX        = 5;
const RATE_LIMIT_WINDOW_MS  = 15 * 60 * 1000;

export type ShiftAuthResult =
  | { ok: true; loadedProof?: LoadedBiometricProof }
  | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503 };

/**
 * Validates the armeiro's own TOTP token.
 * Used to authorize opening/closing a shift (self-authentication, not identify another military member).
 */
export async function validateSelfTotp(
  userId: string,
  token: string,
): Promise<ShiftAuthResult> {
  const { data, error } = await supabase
    .from("totp_secrets")
    .select("id, secret, failure_count, last_failure_at, last_used_token")
    .eq("user_id", userId)
    .eq("enabled", true)
    .maybeSingle();

  if (error || !data) {
    return { ok: false, status: 422, error: "TOTP_NOT_CONFIGURED" };
  }

  if ((data.failure_count ?? 0) >= RATE_LIMIT_MAX && data.last_failure_at) {
    const elapsed = Date.now() - new Date(data.last_failure_at).getTime();
    if (elapsed < RATE_LIMIT_WINDOW_MS) {
      const retry = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
      return { ok: false, status: 429, error: `Bloqueado por tentativas excessivas — aguarde ${retry}s` };
    }
  }

  let plainSecret: string;
  try {
    plainSecret = await readSecret(data.secret);
  } catch (err) {
    logger.error("shift.auth.totp.read_secret_failure", {
      user_id: userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 422, error: "Código dinâmico inválido. Reconfigure o autenticador no seu perfil." };
  }

  const { valid } = verifySync({ secret: plainSecret, token, afterTimeStep: 1 });

  if (valid) {
    // Anti-replay: reject if same code was already used in this window (matches totp.ts pattern)
    if (data.last_used_token === token) {
      return { ok: false, status: 401, error: "Código já utilizado neste período" };
    }

    await supabase.from("totp_secrets").update({
      failure_count: 0,
      last_failure_at: null,
      last_validated_at: new Date().toISOString(),
      last_used_token: token,
    }).eq("id", data.id);

    await supabase.from("audit_logs").insert({
      actor_id: userId,
      action: "shift.auth.totp.success",
      resource_type: "service_shifts",
      resource_id: null,
      metadata: { user_id: userId },
    });

    return { ok: true };
  }

  const newCount = (data.failure_count ?? 0) + 1;
  await supabase.from("totp_secrets").update({
    failure_count: newCount,
    last_failure_at: new Date().toISOString(),
  }).eq("id", data.id);

  await supabase.from("audit_logs").insert({
    actor_id: userId,
    action: "shift.auth.totp.failure",
    resource_type: "service_shifts",
    resource_id: null,
    metadata: { user_id: userId, attempt: newCount },
  });

  return { ok: false, status: 401, error: "Código dinâmico inválido" };
}

/**
 * Valida uma prova biométrica já capturada (challenge/proof real, mesmo
 * motor de lendings.ts/cautelamentos.ts) pra autenticar a abertura/
 * encerramento do próprio turno pelo armeiro — só valida (loadBiometricProof
 * + assertProofScopeAndFreshness), não consome. O caller (shifts.ts) consome
 * a prova depois que a mutação de service_shifts já teve sucesso, mesmo
 * padrão "nunca consumir antes do negócio confirmar" do resto do projeto.
 */
export async function validateSelfBiometricProof(
  userId: string,
  reserveId: string,
  proofId: string,
  context: { tenantId: string; purpose: "open_shift" | "close_shift"; documentId: string | null },
): Promise<ShiftAuthResult> {
  let loaded: LoadedBiometricProof;
  try {
    loaded = await loadBiometricProof(proofId, context.tenantId);
    assertProofScopeAndFreshness(loaded, {
      tenantId: context.tenantId,
      reserveId,
      actorId: userId,
      purpose: context.purpose,
      expectedUserId: userId,
      documentId: context.documentId,
    });
  } catch (err) {
    await supabase.from("audit_logs").insert({
      actor_id: userId,
      action: "shift.auth.biometric.failure",
      resource_type: "service_shifts",
      resource_id: null,
      metadata: { user_id: userId, error: mapBiometricProofError(err) },
    });
    return { ok: false, error: mapBiometricProofError(err), status: statusForBiometricProofError(err) };
  }

  await supabase.from("audit_logs").insert({
    actor_id: userId,
    action: "shift.auth.biometric.success",
    resource_type: "service_shifts",
    resource_id: null,
    metadata: { user_id: userId },
  });

  return { ok: true, loadedProof: loaded };
}
