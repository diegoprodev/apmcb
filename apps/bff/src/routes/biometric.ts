import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditAction } from "../middleware/audit";
import { supabase } from "../services/supabase";
import {
  assertChallengeAcceptsProof,
  biometricPurposeRequiresExpectedUser,
  verifyBridgeSignature,
  type BiometricEnrollmentRequest,
  type BiometricChallengeForProof,
  type BiometricProofPayload,
} from "../lib/biometric-proof";
import { BiometricEnrollmentError, recordBiometricEnrollment } from "../lib/biometric-enrollment";
import { assertBiometricPolicy, type BiometricSubjectStatus } from "../lib/biometric-policy";
import { generatePairingCode, hashPairingCode } from "../lib/biometric-pairing-code";
import type { HonoVariables, Role } from "../types/hono";

export const biometricRoutes = new Hono<{ Variables: HonoVariables }>();

const BIOMETRIC_CHALLENGE_TTL_MS = 60_000;
const BIOMETRIC_MIN_SCORE = parseFloat(process.env.BIOMETRIC_MIN_SCORE ?? "0.92");
const BIOMETRIC_REQUIRE_LIVENESS = process.env.BIOMETRIC_REQUIRE_LIVENESS === "true";
const TENANT_REQUIRED = { error: "Tenant nao identificado na sessao" };

const purposeSchema = z.enum([
  "identify",
  "enroll",
  "sign_saida_armeiro",
  "confirm_saida_militar",
  "sign_cautela_armeiro",
  "sign_cautela_militar",
  "handover_sign_exit",
  "handover_sign_entry",
  "open_shift",
  "close_shift",
  "return",
]);

const legacyRegisterSchema = z.object({
  userId: z.string().uuid(),
  fingerIndex: z.number().int().min(1).max(10),
});

const pairDeviceSchema = z.object({
  reserve_id: z.string().uuid(),
  device_name: z.string().min(1).max(120),
  public_key: z.string().min(32).max(4096),
  sdk_version: z.string().max(64).optional(),
  bridge_version: z.string().max(64).optional(),
});

const createChallengeSchema = z.object({
  reserve_id: z.string().uuid(),
  purpose: purposeSchema,
  expected_user_id: z.string().uuid().nullable().optional(),
  document_type: z.string().max(60).nullable().optional(),
  document_id: z.string().uuid().nullable().optional(),
  document_hash: z.string().max(256).nullable().optional(),
}).superRefine((body, ctx) => {
  if (biometricPurposeRequiresExpectedUser(body.purpose) && !body.expected_user_id) {
    ctx.addIssue({
      code: "custom",
      path: ["expected_user_id"],
      message: "expected_user_id obrigatorio para este purpose",
    });
  }
});

const proofPayloadSchema = z.object({
  challenge_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  reserve_id: z.string().uuid(),
  device_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  purpose: purposeSchema,
  matched_user_id: z.string().uuid().nullable(),
  document_type: z.string().nullable(),
  document_id: z.string().uuid().nullable(),
  document_hash: z.string().nullable(),
  match_score: z.number().min(0).max(1),
  finger_index: z.number().int().min(1).max(10).nullable(),
  liveness_passed: z.boolean().nullable(),
  sdk_version: z.string().nullable(),
  bridge_version: z.string().nullable(),
  timestamp: z.string().datetime(),
}) satisfies z.ZodType<BiometricProofPayload>;

const submitProofSchema = z.object({
  proof: proofPayloadSchema,
  bridge_signature: z.string().min(32).max(8192),
  result: z.enum(["success", "failure", "error"]).default("success"),
  failure_reason: z.string().max(240).nullable().optional(),
});

const enrollmentSubmitSchema = z.object({
  proof: proofPayloadSchema,
  encrypted_template_data: z.string().min(4).max(1_000_000),
  template_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  format: z.string().min(1).max(64),
  quality: z.number().int().min(0).max(100),
  bridge_signature: z.string().min(32).max(8192),
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

const BRIDGE_REQUIRED = {
  error: "BIOMETRIC_BRIDGE_REQUIRED",
  message: "Biometria em ambiente cloud exige APMCB Biometric Bridge local pareado. Use o fluxo challenge/proof.",
};

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

biometricRoutes.post(
  "/challenges/:id/enroll-submit",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  zValidator("json", enrollmentSubmitSchema),
  auditAction("biometric.enrollment.completed", "biometric_templates"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const actorId = c.get("userId");
    const id = c.req.param("id");
    const body = c.req.valid("json");
    if (!tenantId || !actorId) return c.json(TENANT_REQUIRED, 403);
    if (id !== body.proof.challenge_id) return c.json({ error: "Challenge invalido" }, 400);

    const { data: challenge, error: challengeErr } = await supabase
      .from("biometric_challenges")
      .select("id, tenant_id, reserve_id, device_id, actor_id, purpose, expected_user_id, document_type, document_id, document_hash, status, expires_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("actor_id", actorId)
      .maybeSingle();
    if (challengeErr) return c.json({ error: "Nao foi possivel buscar desafio biometrico" }, 500);
    if (!challenge) return c.json({ error: "Desafio biometrico nao encontrado" }, 404);
    if (challenge.purpose !== "enroll" || !challenge.expected_user_id) {
      return c.json({ error: "Desafio nao e de enrollment" }, 409);
    }
    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, challenge.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }

    const { data: device, error: deviceErr } = await supabase
      .from("biometric_devices")
      .select("id, tenant_id, reserve_id, public_key, status")
      .eq("id", body.proof.device_id)
      .eq("tenant_id", tenantId)
      .eq("reserve_id", challenge.reserve_id)
      .maybeSingle();
    if (deviceErr) return c.json({ error: "Nao foi possivel buscar bridge biometrico" }, 500);
    if (!device || device.status !== "active") return c.json({ error: "Bridge biometrico nao autorizado" }, 403);

    const { data: targetUser, error: targetUserErr } = await supabase
      .from("profiles")
      .select("id, default_tenant_id, registration_status")
      .eq("id", challenge.expected_user_id)
      .eq("default_tenant_id", tenantId)
      .maybeSingle();
    if (targetUserErr) return c.json({ error: "Nao foi possivel validar usuario do enrollment" }, 500);
    if (!targetUser) return c.json({ error: "Usuario do enrollment nao pertence ao tenant" }, 403);

    try {
      const result = await recordBiometricEnrollment(
        supabase,
        body as BiometricEnrollmentRequest,
        {
          activeTenantId: tenantId,
          activeReserveId: challenge.reserve_id,
          actorId,
          challenge: challenge as BiometricChallengeForProof,
          device,
          targetUser,
          minQuality: BIOMETRIC_ENROLLMENT_MIN_QUALITY,
          maxTemplateBytes: BIOMETRIC_TEMPLATE_MAX_BYTES,
          requireLiveness: BIOMETRIC_REQUIRE_LIVENESS,
        },
      );
      return c.json({ enrollment: result }, 201);
    } catch (error) {
      if (error instanceof BiometricEnrollmentError) {
        return c.json({ error: error.code, message: error.message }, error.status);
      }
      return c.json({ error: "Nao foi possivel registrar enrollment biometrico" }, 500);
    }
  },
);

biometricRoutes.post(
  "/devices/pair",
  roleGuard("admin_reserva", "admin_global"),
  zValidator("json", pairDeviceSchema),
  auditAction("biometric.device.pair", "biometric_devices"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json(TENANT_REQUIRED, 403);
    const actorId = c.get("userId");
    const body = c.req.valid("json");

    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, body.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }

    const { data, error } = await supabase
      .from("biometric_devices")
      .upsert({
        tenant_id: tenantId,
        reserve_id: body.reserve_id,
        device_name: body.device_name,
        public_key: body.public_key,
        sdk_version: body.sdk_version ?? null,
        bridge_version: body.bridge_version ?? null,
        status: "active",
        paired_by: actorId,
        paired_at: new Date().toISOString(),
      }, { onConflict: "tenant_id,device_name" })
      .select("id, tenant_id, reserve_id, device_name, sdk_vendor, sdk_version, bridge_version, status, paired_at, last_seen_at")
      .single();

    if (error || !data) return c.json({ error: "Não foi possível parear o bridge biométrico" }, 500);
    return c.json({ device: data }, 201);
  }
);

biometricRoutes.get(
  "/devices",
  roleGuard("admin_reserva", "admin_global", "armeiro"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json(TENANT_REQUIRED, 403);
    const requestedReserveId = c.req.query("reserve_id") ?? c.get("reserveId");
    const role = c.get("role");
    const actorId = c.get("userId");

    let query = supabase
      .from("biometric_devices")
      .select("id, reserve_id, device_name, sdk_vendor, sdk_version, bridge_version, status, is_simulator, paired_at, last_seen_at, revoked_at, device_detected, device_model")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });
    if (role === "admin_global") {
      if (requestedReserveId) {
        if (!(await reserveBelongsToTenant(requestedReserveId, tenantId))) {
          return c.json({ error: "Reserva nao encontrada" }, 404);
        }
        query = query.eq("reserve_id", requestedReserveId);
      }
    } else {
      if (!requestedReserveId) return c.json({ error: "Reserva obrigatoria" }, 400);
      if (!(await actorCanAccessReserve(actorId, role, tenantId, requestedReserveId))) {
        return c.json({ error: "Reserva nao autorizada" }, 403);
      }
      query = query.eq("reserve_id", requestedReserveId);
    }

    const { data, error } = await query;
    if (error) return c.json({ error: "Não foi possível listar bridges biométricos" }, 500);
    return c.json({
      devices: data ?? [],
      simulator_available: process.env.NODE_ENV !== "production" && process.env.BIOMETRIC_SIMULATOR_ENABLED === "true",
    });
  }
);

biometricRoutes.post(
  "/devices/:id/revoke",
  roleGuard("admin_reserva", "admin_global"),
  zValidator("json", z.object({ reason: z.string().max(240).optional() })),
  auditAction("biometric.device.revoke", "biometric_devices"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json(TENANT_REQUIRED, 403);
    const actorId = c.get("userId");
    const id = c.req.param("id");
    const { reason } = c.req.valid("json");

    const { data: existing, error: existingErr } = await supabase
      .from("biometric_devices")
      .select("id, reserve_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (existingErr) return c.json({ error: "Nao foi possivel buscar bridge biometrico" }, 500);
    if (!existing) return c.json({ error: "Bridge biometrico nao encontrado" }, 404);
    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, existing.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }

    const { data, error } = await supabase
      .from("biometric_devices")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_by: actorId,
        revoked_reason: reason ?? null,
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("reserve_id", existing.reserve_id)
      .select("id, status, revoked_at")
      .single();

    if (error || !data) return c.json({ error: "Bridge biométrico não encontrado" }, 404);
    return c.json({ device: data });
  }
);

biometricRoutes.post(
  "/challenges",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  zValidator("json", createChallengeSchema),
  auditAction("biometric.challenge.create", "biometric_challenges"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json(TENANT_REQUIRED, 403);
    const actorId = c.get("userId");
    const body = c.req.valid("json");

    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, body.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }

    const { data, error } = await supabase
      .from("biometric_challenges")
      .insert({
        tenant_id: tenantId,
        reserve_id: body.reserve_id,
        actor_id: actorId,
        purpose: body.purpose,
        expected_user_id: body.expected_user_id ?? null,
        document_type: body.document_type ?? null,
        document_id: body.document_id ?? null,
        document_hash: body.document_hash ?? null,
        expires_at: new Date(Date.now() + BIOMETRIC_CHALLENGE_TTL_MS).toISOString(),
      })
      .select("id, tenant_id, reserve_id, purpose, expected_user_id, document_type, document_id, document_hash, status, expires_at")
      .single();

    if (error || !data) return c.json({ error: "Não foi possível criar desafio biométrico" }, 500);
    return c.json({ challenge: data }, 201);
  }
);

biometricRoutes.get(
  "/challenges/:id",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json(TENANT_REQUIRED, 403);
    const id = c.req.param("id");

    const { data, error } = await supabase
      .from("biometric_challenges")
      .select("id, reserve_id, purpose, expected_user_id, document_type, document_id, document_hash, status, expires_at, consumed_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) return c.json({ error: "Não foi possível buscar desafio biométrico" }, 500);
    if (!data) return c.json({ error: "Desafio biométrico não encontrado" }, 404);
    if (!(await actorCanAccessReserve(c.get("userId"), c.get("role"), tenantId, data.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }
    return c.json({ challenge: data });
  }
);

biometricRoutes.get(
  "/challenges/:id/result",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  auditAction("biometric.challenge.result", "biometric_challenges"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json(TENANT_REQUIRED, 403);
    const actorId = c.get("userId");
    const id = c.req.param("id");

    const { data: challenge, error: challengeErr } = await supabase
      .from("biometric_challenges")
      .select("id, tenant_id, reserve_id, actor_id, purpose, expected_user_id, document_type, document_id, document_hash, status, expires_at, consumed_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("actor_id", actorId)
      .maybeSingle();
    if (challengeErr) return c.json({ error: "Nao foi possivel buscar resultado biometrico" }, 500);
    if (!challenge) return c.json({ error: "Desafio biometrico nao encontrado" }, 404);
    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, challenge.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }

    const expired = challenge.status === "pending" && new Date(challenge.expires_at).getTime() <= Date.now();
    if (expired) {
      return c.json({
        challenge: {
          id: challenge.id,
          reserve_id: challenge.reserve_id,
          purpose: challenge.purpose,
          status: "expired",
          expires_at: challenge.expires_at,
          consumed_at: challenge.consumed_at,
        },
        proof: null,
        matched_user: null,
      });
    }

    const { data: proof, error: proofErr } = await supabase
      .from("biometric_proofs")
      .select("id, matched_user_id, purpose, result, failure_reason, match_score, finger_index, liveness_passed, created_at")
      .eq("challenge_id", id)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (proofErr) return c.json({ error: "Nao foi possivel buscar proof biometrica" }, 500);

    let matchedUser = null;
    if (proof?.matched_user_id && proof.result === "success") {
      const { data: profile, error: profileErr } = await supabase
        .from("profiles")
        .select("id, nome_completo, nome_de_guerra, matricula, posto, role, registration_status")
        .eq("id", proof.matched_user_id)
        .eq("default_tenant_id", tenantId)
        .maybeSingle();
      if (profileErr) return c.json({ error: "Nao foi possivel buscar usuario identificado" }, 500);
      matchedUser = profile;
    }

    return c.json({
      challenge: {
        id: challenge.id,
        reserve_id: challenge.reserve_id,
        purpose: challenge.purpose,
        status: challenge.status,
        expires_at: challenge.expires_at,
        consumed_at: challenge.consumed_at,
      },
      proof: proof
        ? {
            id: proof.id,
            result: proof.result,
            failure_reason: proof.failure_reason,
            match_score: proof.match_score,
            finger_index: proof.finger_index,
            liveness_passed: proof.liveness_passed,
            created_at: proof.created_at,
          }
        : null,
      matched_user: matchedUser,
    });
  }
);

biometricRoutes.post(
  "/challenges/:id/submit",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  zValidator("json", submitProofSchema),
  auditAction("biometric.challenge.submit", "biometric_proofs"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json(TENANT_REQUIRED, 403);
    const actorId = c.get("userId");
    const id = c.req.param("id");
    const body = c.req.valid("json");

    if (id !== body.proof.challenge_id) {
      return c.json({ error: "Challenge inválido" }, 400);
    }

    const { data: challenge, error: challengeErr } = await supabase
      .from("biometric_challenges")
      .select("id, tenant_id, reserve_id, device_id, actor_id, purpose, expected_user_id, document_type, document_id, document_hash, status, expires_at")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("actor_id", actorId)
      .maybeSingle();
    if (challengeErr) return c.json({ error: "Não foi possível buscar desafio biométrico" }, 500);
    if (!challenge) return c.json({ error: "Desafio biométrico não encontrado" }, 404);
    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, challenge.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }
    if (challenge.purpose === "enroll") {
      return c.json({
        error: "BIOMETRIC_ENROLLMENT_ENDPOINT_REQUIRED",
        message: "Enrollment biometrico exige o endpoint autenticado do bridge",
      }, 409);
    }

    const { data: device, error: deviceErr } = await supabase
      .from("biometric_devices")
      .select("id, tenant_id, reserve_id, public_key, status")
      .eq("id", body.proof.device_id)
      .eq("tenant_id", tenantId)
      .eq("reserve_id", body.proof.reserve_id)
      .maybeSingle();
    if (deviceErr) return c.json({ error: "Não foi possível buscar bridge biométrico" }, 500);
    if (!device || device.status !== "active") return c.json({ error: "Bridge biométrico não autorizado" }, 403);

    try {
      assertChallengeAcceptsProof(challenge as BiometricChallengeForProof, body.proof);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Proof biométrica inválida" }, 400);
    }

    if (!verifyBridgeSignature(body.proof, device.public_key, body.bridge_signature)) {
      return c.json({ error: "Assinatura biométrica inválida" }, 401);
    }

    if (body.result === "success") {
      if (!body.proof.matched_user_id) {
        return c.json({ error: "Proof biometrica sem usuario identificado" }, 400);
      }
      if (body.proof.liveness_passed === false || (BIOMETRIC_REQUIRE_LIVENESS && body.proof.liveness_passed !== true)) {
        return c.json({ error: "Liveness biometrico reprovado" }, 400);
      }

      const { data: matchedUser, error: matchedUserErr } = await supabase
        .from("profiles")
        .select("id, default_tenant_id, registration_status")
        .eq("id", body.proof.matched_user_id)
        .eq("default_tenant_id", tenantId)
        .maybeSingle();
      if (matchedUserErr) return c.json({ error: "Nao foi possivel validar usuario biometrico" }, 500);
      if (!matchedUser) return c.json({ error: "Usuario biometrico nao pertence ao tenant" }, 403);

      try {
        assertBiometricPolicy({
          proof: body.proof,
          minScore: BIOMETRIC_MIN_SCORE,
          activeTenantId: tenantId,
          activeReserveId: challenge.reserve_id,
          expectedUserId: challenge.expected_user_id,
          matchedUserStatus: matchedUser.registration_status as BiometricSubjectStatus,
        });
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : "Politica biometrica reprovada" }, 400);
      }
    }

    const { data: proofRow, error: proofErr } = await supabase
      .rpc("record_biometric_proof", {
        p_challenge_id: body.proof.challenge_id,
        p_tenant_id: body.proof.tenant_id,
        p_reserve_id: body.proof.reserve_id,
        p_device_id: body.proof.device_id,
        p_actor_id: body.proof.actor_id,
        p_matched_user_id: body.proof.matched_user_id,
        p_purpose: body.proof.purpose,
        p_document_type: body.proof.document_type,
        p_document_id: body.proof.document_id,
        p_document_hash: body.proof.document_hash,
        p_match_score: body.proof.match_score,
        p_finger_index: body.proof.finger_index,
        p_liveness_passed: body.proof.liveness_passed,
        p_bridge_signature: body.bridge_signature,
        p_signature_algorithm: "ed25519",
        p_sdk_version: body.proof.sdk_version,
        p_bridge_version: body.proof.bridge_version,
        p_result: body.result,
        p_failure_reason: body.failure_reason ?? null,
      })
      .single();
    if (proofErr?.code === "P0001") {
      return c.json({ error: "Desafio biometrico ja consumido ou expirado" }, 409);
    }
    if (proofErr || !proofRow) return c.json({ error: "Não foi possível registrar proof biométrica" }, 500);

    await supabase
      .from("biometric_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", body.proof.device_id)
      .eq("tenant_id", tenantId);

    return c.json({ proof: proofRow }, 201);
  }
);

const createPairingCodeSchema = z.object({
  reserve_id: z.string().uuid(),
  device_name: z.string().min(1).max(120),
  expires_in_seconds: z.number().int().min(60).max(3600).default(
    Number.parseInt(process.env.BIOMETRIC_BRIDGE_PAIRING_CODE_TTL_SECONDS ?? "600", 10),
  ),
});

// POST /api/biometric/pairing-codes — Phase 1B: admin gera código one-time
// para o bridge Windows real consumir em /api/biometric-bridge/pair, sem
// nunca precisar de cookie/sessão de usuário.
biometricRoutes.post(
  "/pairing-codes",
  roleGuard("admin_reserva", "admin_global"),
  zValidator("json", createPairingCodeSchema),
  auditAction("biometric.pairing_code.create", "biometric_pairing_codes"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json(TENANT_REQUIRED, 403);
    const actorId = c.get("userId");
    const body = c.req.valid("json");

    if (!(await actorCanAccessReserve(actorId, c.get("role"), tenantId, body.reserve_id))) {
      return c.json({ error: "Reserva nao autorizada" }, 403);
    }

    const code = generatePairingCode();
    let codeHash: string;
    try {
      codeHash = hashPairingCode(code);
    } catch {
      c.get("log").error({ tenantId, actorId }, "biometric.pairing_code.pepper_missing");
      return c.json({ error: "Pareamento indisponível no momento" }, 503);
    }

    const expiresAt = new Date(Date.now() + body.expires_in_seconds * 1000).toISOString();

    const { data, error } = await supabase
      .from("biometric_pairing_codes")
      .insert({
        tenant_id: tenantId,
        reserve_id: body.reserve_id,
        code_hash: codeHash,
        device_name: body.device_name,
        created_by: actorId,
        expires_at: expiresAt,
      })
      .select("id, reserve_id, expires_at")
      .single();

    if (error || !data) return c.json({ error: "Não foi possível gerar o código de pareamento" }, 500);

    // O código em texto puro só existe nesta resposta — nunca é persistido
    // nem logado. auditAction registra a criação (metadados), não o valor.
    return c.json({
      pairing_code: code,
      expires_at: data.expires_at,
      reserve_id: data.reserve_id,
    }, 201);
  }
);

biometricRoutes.post(
  "/identify",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  auditAction("biometric.identify.deprecated", "biometric_templates"),
  async (c) => {
    c.get("log").warn({ actor_id: c.get("userId") }, "biometric.identify.legacy_rejected");
    return c.json(BRIDGE_REQUIRED, 501);
  }
);

biometricRoutes.post(
  "/register",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", legacyRegisterSchema),
  auditAction("biometric.register.deprecated", "biometric_templates"),
  async (c) => {
    const body = c.req.valid("json");
    c.get("log").warn(
      { actor_id: c.get("userId"), target_user_id: body.userId, finger_index: body.fingerIndex },
      "biometric.register.legacy_rejected"
    );
    return c.json(BRIDGE_REQUIRED, 501);
  }
);
