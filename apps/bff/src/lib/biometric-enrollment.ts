import { createHash } from "node:crypto";
import {
  assertChallengeAcceptsProof,
  verifyBiometricEnrollmentSignature,
  type BiometricChallengeForProof,
  type BiometricEnrollmentRequest,
} from "./biometric-proof.ts";

const DEFAULT_ALLOWED_FORMATS = new Set(["nitgen-fmd"]);
const SHA256_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export interface BiometricEnrollmentDevice {
  id: string;
  tenant_id: string;
  reserve_id: string;
  public_key: string;
  status: string;
}

export interface BiometricEnrollmentTargetUser {
  id: string;
  default_tenant_id: string | null;
  registration_status: string | null;
}

export interface BiometricEnrollmentContext {
  activeTenantId: string;
  activeReserveId: string;
  actorId: string;
  challenge: BiometricChallengeForProof;
  device: BiometricEnrollmentDevice;
  targetUser: BiometricEnrollmentTargetUser;
  minQuality: number;
  maxTemplateBytes: number;
  // Mesma política condicional já usada em /proof (biometric-bridge.ts:359)
  // — achado CRÍTICO da spec Fase 1C: esta função exigia liveness_passed
  // === true incondicionalmente, travando todo enrollment em qualquer
  // leitor sem LFD real. `false` explícito do SDK continua sempre
  // rejeitado; só `null` passa a ser aceito quando este flag é false.
  requireLiveness: boolean;
  nowMs?: number;
  allowedFormats?: ReadonlySet<string>;
}

export interface ValidatedBiometricEnrollment {
  templateData: Uint8Array;
  templateHash: string;
}

export interface SafeBiometricEnrollmentResult {
  proof_id: string;
  finger_index: number;
  quality: number;
  created_at: string;
  updated_at: string | null;
}

interface BiometricEnrollmentRpcResult {
  proof_id?: unknown;
  id?: unknown;
  finger_index?: unknown;
  quality?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}

interface BiometricEnrollmentDatabase {
  rpc(name: string, params: Record<string, unknown>): {
    single(): PromiseLike<{
      data: BiometricEnrollmentRpcResult | null;
      error: { code?: string; message?: string } | null;
    }>;
  };
}

export class BiometricEnrollmentError extends Error {
  readonly code: string;
  readonly status: 400 | 401 | 403 | 409 | 500;

  constructor(
    message: string,
    code: string,
    status: 400 | 401 | 403 | 409 | 500,
  ) {
    super(message);
    this.name = "BiometricEnrollmentError";
    this.code = code;
    this.status = status;
  }
}

function invalid(message: string, code = "BIOMETRIC_ENROLLMENT_INVALID"): never {
  throw new BiometricEnrollmentError(message, code, 400);
}

function decodeCanonicalBase64(value: string, label: string): Buffer {
  if (!value || !CANONICAL_BASE64_PATTERN.test(value)) {
    invalid(`${label} must be canonical RFC4648 base64`);
  }

  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value) {
    invalid(`${label} must be canonical RFC4648 base64`);
  }
  return decoded;
}

function assertActiveScope(context: BiometricEnrollmentContext): void {
  const { challenge, device, targetUser } = context;

  if (challenge.tenant_id !== context.activeTenantId) invalid("biometric enrollment tenant mismatch");
  if (challenge.reserve_id !== context.activeReserveId) invalid("biometric enrollment reserve mismatch");
  if (challenge.actor_id !== context.actorId) invalid("biometric enrollment actor mismatch");

  if (
    device.status !== "active"
    || device.id !== context.challenge.device_id && context.challenge.device_id !== null
    || device.tenant_id !== context.activeTenantId
    || device.reserve_id !== context.activeReserveId
  ) {
    throw new BiometricEnrollmentError("biometric enrollment device is not active in challenge scope", "BIOMETRIC_DEVICE_FORBIDDEN", 403);
  }

  if (targetUser.default_tenant_id !== context.activeTenantId) {
    throw new BiometricEnrollmentError("biometric enrollment target user tenant mismatch", "BIOMETRIC_TARGET_FORBIDDEN", 403);
  }
  if (targetUser.registration_status !== "pending_biometric" && targetUser.registration_status !== "complete") {
    throw new BiometricEnrollmentError("biometric enrollment target user status is not enrollable", "BIOMETRIC_TARGET_FORBIDDEN", 403);
  }
}

export function validateBiometricEnrollment(
  enrollment: BiometricEnrollmentRequest,
  context: BiometricEnrollmentContext,
): ValidatedBiometricEnrollment {
  const { proof } = enrollment;
  const nowMs = context.nowMs ?? Date.now();

  assertActiveScope(context);
  if (proof.device_id !== context.device.id) {
    throw new BiometricEnrollmentError("biometric enrollment device mismatch", "BIOMETRIC_DEVICE_FORBIDDEN", 403);
  }
  if (context.challenge.purpose !== "enroll" || proof.purpose !== "enroll") {
    invalid("biometric enrollment purpose mismatch");
  }
  if (!context.challenge.expected_user_id) {
    invalid("biometric enrollment expected_user is required");
  }
  if (
    proof.matched_user_id !== context.challenge.expected_user_id
    || context.targetUser.id !== context.challenge.expected_user_id
  ) {
    invalid("biometric enrollment expected_user mismatch");
  }

  try {
    assertChallengeAcceptsProof(context.challenge, proof, nowMs);
  } catch (error) {
    invalid(error instanceof Error ? error.message : "biometric enrollment challenge mismatch");
  }

  const timestampMs = Date.parse(proof.timestamp);
  if (!Number.isFinite(timestampMs) || timestampMs > nowMs + 5_000 || timestampMs > Date.parse(context.challenge.expires_at)) {
    invalid("biometric enrollment timestamp is outside challenge TTL");
  }
  if (!Number.isInteger(proof.finger_index) || proof.finger_index! < 1 || proof.finger_index! > 10) {
    invalid("biometric enrollment finger index must be between 1 and 10");
  }
  if (proof.liveness_passed === false || (context.requireLiveness && proof.liveness_passed !== true)) {
    invalid("biometric enrollment liveness must pass");
  }
  if (!Number.isInteger(context.minQuality) || context.minQuality < 0 || context.minQuality > 100) {
    throw new BiometricEnrollmentError("biometric enrollment quality configuration is invalid", "BIOMETRIC_ENROLLMENT_CONFIG_INVALID", 500);
  }
  if (!Number.isInteger(enrollment.quality) || enrollment.quality < context.minQuality || enrollment.quality > 100) {
    invalid(`biometric enrollment quality must be between ${context.minQuality} and 100`);
  }
  if (!(context.allowedFormats ?? DEFAULT_ALLOWED_FORMATS).has(enrollment.format)) {
    invalid("biometric enrollment format is not supported");
  }
  if (!Number.isInteger(context.maxTemplateBytes) || context.maxTemplateBytes < 1) {
    throw new BiometricEnrollmentError("biometric enrollment size configuration is invalid", "BIOMETRIC_ENROLLMENT_CONFIG_INVALID", 500);
  }

  const templateData = decodeCanonicalBase64(enrollment.encrypted_template_data, "encrypted template data");
  if (templateData.length < 1 || templateData.length > context.maxTemplateBytes) {
    invalid("biometric enrollment template size is outside allowed limits");
  }
  if (!SHA256_HASH_PATTERN.test(enrollment.template_hash)) {
    invalid("biometric enrollment template hash format is invalid");
  }
  const templateHash = `sha256:${createHash("sha256").update(templateData).digest("hex")}`;
  if (templateHash !== enrollment.template_hash) {
    invalid("biometric enrollment ciphertext hash mismatch");
  }

  decodeCanonicalBase64(enrollment.bridge_signature, "bridge signature");
  if (!verifyBiometricEnrollmentSignature(enrollment, context.device.public_key)) {
    throw new BiometricEnrollmentError("biometric enrollment signature is invalid", "BIOMETRIC_SIGNATURE_INVALID", 401);
  }

  return { templateData, templateHash };
}

function requireRpcString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BiometricEnrollmentError(`record_biometric_enrollment returned invalid ${field}`, "BIOMETRIC_ENROLLMENT_PERSISTENCE_FAILED", 500);
  }
  return value;
}

function requireRpcInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new BiometricEnrollmentError(`record_biometric_enrollment returned invalid ${field}`, "BIOMETRIC_ENROLLMENT_PERSISTENCE_FAILED", 500);
  }
  return value;
}

export async function recordBiometricEnrollment(
  db: BiometricEnrollmentDatabase,
  enrollment: BiometricEnrollmentRequest,
  context: BiometricEnrollmentContext,
): Promise<SafeBiometricEnrollmentResult> {
  const validated = validateBiometricEnrollment(enrollment, context);
  const { proof } = enrollment;
  const { data, error } = await db.rpc("record_biometric_enrollment", {
    p_challenge_id: proof.challenge_id,
    p_tenant_id: proof.tenant_id,
    p_reserve_id: proof.reserve_id,
    p_device_id: proof.device_id,
    p_actor_id: proof.actor_id,
    p_user_id: proof.matched_user_id,
    p_template_data: `\\x${Buffer.from(validated.templateData).toString("hex")}`,
    p_template_hash: validated.templateHash,
    p_format: enrollment.format,
    p_finger_index: proof.finger_index,
    p_quality: enrollment.quality,
    p_liveness_passed: proof.liveness_passed,
    p_bridge_signature: enrollment.bridge_signature,
    p_signature_algorithm: "ed25519",
    p_sdk_version: proof.sdk_version,
    p_bridge_version: proof.bridge_version,
    p_require_liveness: context.requireLiveness,
  }).single();

  // Diferencia por conteúdo de error.message (o próprio texto da exceção
  // SQL, ex: "BIOMETRIC_LIVENESS_REQUIRED") em vez de colapsar todo P0001
  // em "conflito" — achado CRÍTICO da spec Fase 1C: o catch-all anterior
  // escondia BIOMETRIC_LIVENESS_REQUIRED (e qualquer outra falha real do
  // RPC) atrás de uma mensagem de "challenge já consumido", levando
  // qualquer investigação de campo pro caminho errado. Mesmo padrão já
  // usado em biometric-bridge.ts:90-96 para os erros de
  // consume_biometric_pairing_code.
  if (error?.code === "P0001") {
    const message = error.message ?? "";
    if (message.includes("BIOMETRIC_LIVENESS_REQUIRED")) {
      throw new BiometricEnrollmentError("biometric enrollment liveness must pass", "BIOMETRIC_LIVENESS_REQUIRED", 400);
    }
    if (message.includes("BIOMETRIC_DEVICE_NOT_ACTIVE")) {
      throw new BiometricEnrollmentError("biometric enrollment device is not active", "BIOMETRIC_DEVICE_FORBIDDEN", 403);
    }
    if (message.includes("BIOMETRIC_TARGET_USER_SCOPE_INVALID")) {
      throw new BiometricEnrollmentError("biometric enrollment target user tenant mismatch", "BIOMETRIC_TARGET_FORBIDDEN", 403);
    }
    if (message.includes("BIOMETRIC_CHALLENGE_NOT_PENDING")) {
      throw new BiometricEnrollmentError("biometric enrollment challenge already consumed or expired", "BIOMETRIC_ENROLLMENT_CONFLICT", 409);
    }
    // BIOMETRIC_TEMPLATE_EMPTY / BIOMETRIC_TEMPLATE_HASH_MISMATCH /
    // BIOMETRIC_ENROLLMENT_METADATA_INVALID — validação já feita em
    // validateBiometricEnrollment acima, então só chegam aqui por
    // divergência entre a validação JS e a validação SQL (não deveria
    // acontecer em uso normal); tratados como 400 genérico, não 409.
    throw new BiometricEnrollmentError(message || "biometric enrollment rejected", "BIOMETRIC_ENROLLMENT_INVALID", 400);
  }
  if (error?.code === "23505") {
    throw new BiometricEnrollmentError("biometric enrollment challenge already consumed or expired", "BIOMETRIC_ENROLLMENT_CONFLICT", 409);
  }
  if (error || !data) {
    throw new BiometricEnrollmentError("could not record biometric enrollment", "BIOMETRIC_ENROLLMENT_PERSISTENCE_FAILED", 500);
  }

  return {
    proof_id: requireRpcString(data.proof_id ?? data.id, "proof_id"),
    finger_index: requireRpcInteger(data.finger_index, "finger_index"),
    quality: requireRpcInteger(data.quality, "quality"),
    created_at: requireRpcString(data.created_at, "created_at"),
    updated_at: data.updated_at === null || data.updated_at === undefined
      ? null
      : requireRpcString(data.updated_at, "updated_at"),
  };
}
