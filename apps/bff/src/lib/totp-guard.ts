import { verifySync } from "otplib";

export const TOTP_RATE_MAX    = 5;
export const TOTP_RATE_WINDOW = 15 * 60 * 1000; // 15 min em ms

export interface TotpRow {
  secret: string;
  failure_count: number | null;
  last_failure_at: string | null;
  last_used_token: string | null;
}

export type TotpGuardResult =
  | { ok: true }
  | { ok: false; error: string; status: 400 | 404 | 429 };

/**
 * Pure business logic for TOTP validation.
 * Does NOT touch the DB — caller is responsible for fetching the row
 * and persisting the result (update failure_count / last_used_token).
 */
export function checkTotpGuard(row: TotpRow, token: string, now = Date.now()): TotpGuardResult {
  // Rate-limit gate
  if ((row.failure_count ?? 0) >= TOTP_RATE_MAX && row.last_failure_at) {
    const elapsed = now - new Date(row.last_failure_at).getTime();
    if (elapsed < TOTP_RATE_WINDOW) {
      const retry = Math.ceil((TOTP_RATE_WINDOW - elapsed) / 1000);
      return { ok: false, error: `TOTP bloqueado — aguarde ${retry}s`, status: 429 };
    }
  }

  // Anti-replay gate
  if (row.last_used_token === token)
    return { ok: false, error: "Código já utilizado", status: 400 };

  // Cryptographic verification (accepts current window ± 1 step for clock skew)
  const { valid } = verifySync({ secret: row.secret, token, afterTimeStep: 1 });
  if (!valid) return { ok: false, error: "TOTP inválido", status: 400 };

  return { ok: true };
}
