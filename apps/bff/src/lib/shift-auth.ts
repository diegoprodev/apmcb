import { verifySync } from "otplib";
import { supabase } from "../services/supabase";
import { readSecret } from "../routes/totp";
import { getFingerprintSDK } from "../services/fingerprint/index";
import { logger } from "./logger";

const RATE_LIMIT_MAX        = 5;
const RATE_LIMIT_WINDOW_MS  = 15 * 60 * 1000;

export type ShiftAuthResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 401 | 403 | 404 | 422 | 429 | 503 };

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
    return { ok: false, status: 422, error: "TOTP inválido. Reconfigure o autenticador no seu perfil." };
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

  return { ok: false, status: 401, error: "TOTP inválido" };
}

/**
 * Validates the armeiro's own biometric via ZKTeco SDK.
 * Captures fingerprint from hardware reader and verifies against stored template.
 */
export async function validateSelfBiometric(userId: string): Promise<ShiftAuthResult> {
  const { data: templateRows } = await supabase
    .from("biometric_templates")
    .select("template_data")
    .eq("user_id", userId);

  if (!templateRows || templateRows.length === 0) {
    return { ok: false, status: 422, error: "BIOMETRIC_NOT_REGISTERED" };
  }

  let match: boolean;
  try {
    const sdk = await getFingerprintSDK();
    // Índice do dedo é irrelevante aqui — capture() apenas dispara uma leitura;
    // a comparação abaixo varre todos os dedos registrados do usuário.
    const captured = await sdk.capture(1);
    match = false;
    for (const row of templateRows) {
      const stored = Buffer.from(row.template_data);
      if (await sdk.verify(captured.data, stored)) {
        match = true;
        break;
      }
    }
  } catch (err) {
    logger.error("shift.auth.biometric.sdk_failure", {
      user_id: userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 503, error: "Leitor biométrico indisponível. Verifique a conexão do dispositivo." };
  }

  if (!match) {
    await supabase.from("audit_logs").insert({
      actor_id: userId,
      action: "shift.auth.biometric.failure",
      resource_type: "service_shifts",
      resource_id: null,
      metadata: { user_id: userId, score: 0 },
    });
    return { ok: false, status: 401, error: "Biometria não reconhecida. Tente novamente." };
  }

  await supabase.from("audit_logs").insert({
    actor_id: userId,
    action: "shift.auth.biometric.success",
    resource_type: "service_shifts",
    resource_id: null,
    metadata: { user_id: userId },
  });

  return { ok: true };
}
