import { createHash, verify } from "node:crypto";

/**
 * Device-auth do bridge Windows real (Phase 1B) — assinatura Ed25519 do
 * REQUEST HTTP em si (não da proof biométrica; ver biometric-proof.ts para
 * isso). Contrato exato definido em
 * docs/superpowers/specs/2026-07-14-biometric-bridge-phase1b-windows-bridge-mvp-design.md.
 */

export interface CanonicalRequestInput {
  method: string;
  pathWithQuery: string;
  bodyUtf8: string;
  timestamp: string;
  nonce: string;
  deviceId: string;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * canonical_request =
 *   METHOD + "\n" +
 *   PATH_WITH_QUERY + "\n" +
 *   SHA256_HEX(BODY_UTF8_OR_EMPTY) + "\n" +
 *   X-Bridge-Timestamp + "\n" +
 *   X-Bridge-Nonce + "\n" +
 *   X-Bridge-Device-Id
 */
export function canonicalDeviceRequest(input: CanonicalRequestInput): string {
  return [
    input.method.toUpperCase(),
    input.pathWithQuery,
    sha256Hex(input.bodyUtf8),
    input.timestamp,
    input.nonce,
    input.deviceId,
  ].join("\n");
}

export function verifyDeviceRequestSignature(
  input: CanonicalRequestInput,
  publicKeyPem: string,
  signatureBase64: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonicalDeviceRequest(input), "utf8"),
      publicKeyPem,
      Buffer.from(signatureBase64, "base64"),
    );
  } catch {
    return false;
  }
}

export function isTimestampWithinSkew(
  timestampIso: string,
  maxSkewSeconds: number,
  nowMs = Date.now(),
): boolean {
  const ts = new Date(timestampIso).getTime();
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts) <= maxSkewSeconds * 1000;
}
