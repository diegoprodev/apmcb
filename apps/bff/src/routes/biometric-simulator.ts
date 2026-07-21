import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditAction } from "../middleware/audit";
import { supabase } from "../services/supabase";
import {
  assertChallengeAcceptsProof,
  canonicalizeBiometricEnrollmentPayload,
  canonicalizeBiometricPayload,
  type BiometricChallengeForProof,
  type BiometricEnrollmentRequest,
  type BiometricProofPayload,
} from "../lib/biometric-proof";
import {
  BiometricEnrollmentError,
  recordBiometricEnrollment,
} from "../lib/biometric-enrollment";
import type { HonoVariables, Role } from "../types/hono";

export const biometricSimulatorRoutes = new Hono<{ Variables: HonoVariables }>();

const keyPair = generateKeyPairSync("ed25519", {
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const completeChallengeSchema = z.object({
  matched_user_id: z.string().uuid().nullable().optional(),
  result: z.enum(["success", "failure", "error"]).default("success"),
  failure_reason: z.string().max(240).nullable().optional(),
  match_score: z.number().min(0).max(1).default(0.98),
  finger_index: z.number().int().min(1).max(10).nullable().default(1),
  liveness_passed: z.boolean().nullable().default(true),
});

const enrollmentSchema = z.object({
  finger_index: z.number().int().min(1).max(10),
  quality: z.number().int().min(0).max(100).default(95),
  liveness_passed: z.boolean().default(true),
});

const BIOMETRIC_ENROLLMENT_MIN_QUALITY = Number.parseInt(
  process.env.BIOMETRIC_ENROLLMENT_MIN_QUALITY
    ?? process.env.BIOMETRIC_MIN_ENROLLMENT_QUALITY
    ?? "70",
  10,
);
const BIOMETRIC_TEMPLATE_MAX_BYTES = Number.parseInt(
  process.env.BIOMETRIC_TEMPLATE_MAX_BYTES ?? "262144",
  10,
);

async function reserveBelongsToTenant(reserveId: string, tenantId: string) {
  const { data } = await supabase
    .from("reserves")
    .select("id")
    .eq("id", reserveId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return !!data;
}

async function actorCanAccessReserve(userId: string, role: Role, tenantId: string, reserveId: string) {
  if (role === "admin_global") {
    return reserveBelongsToTenant(reserveId, tenantId);
  }
  if (role !== "admin_reserva" && role !== "armeiro") return false;

  const { data } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, reserves!inner(tenant_id)")
    .eq("user_id", userId)
    .eq("reserve_id", reserveId)
    .eq("reserves.tenant_id", tenantId)
    .maybeSingle();

  return !!data;
}

biometricSimulatorRoutes.post(
  "/challenges/:id/enroll",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  zValidator("json", enrollmentSchema),
  auditAction("biometric.simulator.challenge.enroll", "biometric_templates"),
  async (c) => {
    if (process.env.NODE_ENV === "production" || process.env.BIOMETRIC_SIMULATOR_ENABLED !== "true") {
      return c.json({ error: "Biometric simulator unavailable" }, 404);
    }

    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant nao identificado na sessao" }, 403);
    const actorId = c.get("userId");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const { data: challenge, error: challengeErr } = await supabase
      .from("biometric_challenges")
      .select("id, tenant_id, reserve_id, device_id, actor_id, purpose, expected_user_id, document_type, document_id, document_hash, status, expires_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("actor_id", actorId)
      .maybeSingle();
    if (challengeErr) return c.json({ error: "Nao foi possivel buscar desafio biometrico" }, 500);
    if (!challenge) return c.json({ error: "Desafio biometrico nao encontrado" }, 404);
    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, challenge.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }
    if (challenge.purpose !== "enroll") {
      return c.json({ error: "Desafio biometrico nao e de enrollment" }, 409);
    }
    if (!challenge.expected_user_id) {
      return c.json({ error: "expected_user_id obrigatorio para enrollment" }, 400);
    }

    const { data: targetUser, error: targetUserErr } = await supabase
      .from("profiles")
      .select("id, default_tenant_id, registration_status")
      .eq("id", challenge.expected_user_id)
      .eq("default_tenant_id", tenantId)
      .maybeSingle();
    if (targetUserErr) return c.json({ error: "Nao foi possivel validar usuario do enrollment" }, 500);
    if (!targetUser) return c.json({ error: "Usuario do enrollment nao pertence ao tenant" }, 403);

    const now = new Date();
    const { data: device, error: deviceErr } = await supabase
      .from("biometric_devices")
      .upsert({
        tenant_id: tenantId,
        reserve_id: challenge.reserve_id,
        device_name: `APMCB Biometric Simulator ${challenge.reserve_id}`,
        public_key: keyPair.publicKey,
        sdk_vendor: "simulator",
        sdk_version: "simulator",
        bridge_version: "phase-1a2",
        status: "active",
        is_simulator: true,
        paired_by: actorId,
        paired_at: now.toISOString(),
        last_seen_at: now.toISOString(),
      }, { onConflict: "tenant_id,device_name" })
      .select("id, tenant_id, reserve_id, public_key, status")
      .single();
    if (deviceErr || !device) return c.json({ error: "Nao foi possivel preparar simulator biometrico" }, 500);

    const templateData = randomBytes(512);
    const encryptedTemplateData = templateData.toString("base64");
    const templateHash = `sha256:${createHash("sha256").update(templateData).digest("hex")}`;
    const proof: BiometricProofPayload = {
      challenge_id: challenge.id,
      tenant_id: tenantId,
      reserve_id: challenge.reserve_id,
      device_id: device.id,
      actor_id: actorId,
      purpose: "enroll",
      matched_user_id: challenge.expected_user_id,
      document_type: challenge.document_type,
      document_id: challenge.document_id,
      document_hash: challenge.document_hash,
      match_score: 1,
      finger_index: body.finger_index,
      liveness_passed: body.liveness_passed,
      sdk_version: "simulator",
      bridge_version: "phase-1a2",
      timestamp: now.toISOString(),
    };
    const unsignedEnrollment = {
      proof,
      encrypted_template_data: encryptedTemplateData,
      template_hash: templateHash,
      format: "nitgen-fmd",
      quality: body.quality,
    };
    const enrollment: BiometricEnrollmentRequest = {
      ...unsignedEnrollment,
      bridge_signature: sign(
        null,
        Buffer.from(canonicalizeBiometricEnrollmentPayload(unsignedEnrollment)),
        keyPair.privateKey,
      ).toString("base64"),
    };

    try {
      const result = await recordBiometricEnrollment(supabase, enrollment, {
        activeTenantId: tenantId,
        activeReserveId: challenge.reserve_id,
        actorId,
        challenge: { ...challenge, device_id: challenge.device_id } as BiometricChallengeForProof,
        device,
        targetUser,
        minQuality: BIOMETRIC_ENROLLMENT_MIN_QUALITY,
        maxTemplateBytes: BIOMETRIC_TEMPLATE_MAX_BYTES,
        // Simulador só roda fora de produção (guard acima) e o schema já
        // default `liveness_passed: true` — mantém a mesma política
        // rígida de antes, não precisa do env var real aqui.
        requireLiveness: true,
      });
      return c.json({ enrollment: result }, 201);
    } catch (error) {
      if (error instanceof BiometricEnrollmentError) {
        return c.json({ error: error.code, message: error.message }, error.status);
      }
      return c.json({ error: "Nao foi possivel registrar enrollment biometrico" }, 500);
    }
  },
);

biometricSimulatorRoutes.post(
  "/challenges/:id/complete",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  zValidator("json", completeChallengeSchema),
  auditAction("biometric.simulator.challenge.complete", "biometric_proofs"),
  async (c) => {
    if (process.env.NODE_ENV === "production" || process.env.BIOMETRIC_SIMULATOR_ENABLED !== "true") {
      return c.json({ error: "Biometric simulator unavailable" }, 404);
    }

    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant nao identificado na sessao" }, 403);
    const actorId = c.get("userId");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    const { data: challenge, error: challengeErr } = await supabase
      .from("biometric_challenges")
      .select("id, tenant_id, reserve_id, device_id, actor_id, purpose, expected_user_id, document_type, document_id, document_hash, status, expires_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("actor_id", actorId)
      .maybeSingle();
    if (challengeErr) return c.json({ error: "Nao foi possivel buscar desafio biometrico" }, 500);
    if (!challenge) return c.json({ error: "Desafio biometrico nao encontrado" }, 404);
    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, challenge.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }

    const matchedUserId = body.result === "success"
      ? body.matched_user_id ?? challenge.expected_user_id
      : body.matched_user_id ?? null;
    if (body.result === "success" && !matchedUserId) {
      return c.json({ error: "Usuario simulado obrigatorio para sucesso" }, 400);
    }

    if (matchedUserId) {
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", matchedUserId)
        .eq("default_tenant_id", tenantId)
        .maybeSingle();
      if (profileErr) return c.json({ error: "Nao foi possivel validar usuario simulado" }, 500);
      if (!profile) return c.json({ error: "Usuario simulado nao pertence ao tenant" }, 403);
    }

    const { data: device, error: deviceErr } = await supabase
      .from("biometric_devices")
      .upsert({
        tenant_id: tenantId,
        reserve_id: challenge.reserve_id,
        device_name: `APMCB Biometric Simulator ${challenge.reserve_id}`,
        public_key: keyPair.publicKey,
        sdk_vendor: "simulator",
        sdk_version: "simulator",
        bridge_version: "phase-1a1",
        status: "active",
        is_simulator: true,
        paired_by: actorId,
        paired_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,device_name" })
      .select("id")
      .single();
    if (deviceErr || !device) return c.json({ error: "Nao foi possivel preparar simulator biometrico" }, 500);

    const proof: BiometricProofPayload = {
      challenge_id: challenge.id,
      tenant_id: tenantId,
      reserve_id: challenge.reserve_id,
      device_id: device.id,
      actor_id: actorId,
      purpose: challenge.purpose,
      matched_user_id: matchedUserId,
      document_type: challenge.document_type,
      document_id: challenge.document_id,
      document_hash: challenge.document_hash,
      match_score: body.match_score,
      finger_index: body.finger_index,
      liveness_passed: body.liveness_passed,
      sdk_version: "simulator",
      bridge_version: "phase-1a1",
      timestamp: new Date().toISOString(),
    };

    try {
      assertChallengeAcceptsProof({ ...challenge, device_id: null } as BiometricChallengeForProof, proof);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Proof simulada invalida" }, 400);
    }

    const bridgeSignature = sign(
      null,
      Buffer.from(canonicalizeBiometricPayload(proof)),
      keyPair.privateKey,
    ).toString("base64");

    const { data: proofRow, error: proofErr } = await supabase
      .rpc("record_biometric_proof", {
        p_challenge_id: proof.challenge_id,
        p_tenant_id: proof.tenant_id,
        p_reserve_id: proof.reserve_id,
        p_device_id: proof.device_id,
        p_actor_id: proof.actor_id,
        p_matched_user_id: proof.matched_user_id,
        p_purpose: proof.purpose,
        p_document_type: proof.document_type,
        p_document_id: proof.document_id,
        p_document_hash: proof.document_hash,
        p_match_score: proof.match_score,
        p_finger_index: proof.finger_index,
        p_liveness_passed: proof.liveness_passed,
        p_bridge_signature: bridgeSignature,
        p_signature_algorithm: "ed25519",
        p_sdk_version: proof.sdk_version,
        p_bridge_version: proof.bridge_version,
        p_result: body.result,
        p_failure_reason: body.failure_reason ?? null,
      })
      .single();
    if (proofErr?.code === "P0001") {
      return c.json({ error: "Desafio biometrico ja consumido ou expirado" }, 409);
    }
    if (proofErr || !proofRow) return c.json({ error: "Nao foi possivel registrar proof simulada" }, 500);

    return c.json({ proof: proofRow }, 201);
  },
);
