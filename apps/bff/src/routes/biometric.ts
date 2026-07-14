import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditAction } from "../middleware/audit";
import { supabase } from "../services/supabase";
import {
  assertChallengeAcceptsProof,
  verifyBridgeSignature,
  type BiometricChallengeForProof,
  type BiometricProofPayload,
} from "../lib/biometric-proof";
import { assertBiometricPolicy, type BiometricSubjectStatus } from "../lib/biometric-policy";
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
      .select("id, reserve_id, device_name, sdk_vendor, sdk_version, bridge_version, status, paired_at, last_seen_at, revoked_at")
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
    return c.json({ devices: data ?? [] });
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

    const { data: consumedChallenge, error: consumeErr } = await supabase
      .from("biometric_challenges")
      .update({
        status: "consumed",
        consumed_at: new Date().toISOString(),
        device_id: body.proof.device_id,
      })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .select("id, status, consumed_at")
      .single();
    if (consumeErr || !consumedChallenge) {
      return c.json({ error: "Desafio biometrico ja consumido ou expirado" }, 409);
    }

    const { data: proofRow, error: proofErr } = await supabase
      .from("biometric_proofs")
      .insert({
        challenge_id: body.proof.challenge_id,
        tenant_id: body.proof.tenant_id,
        reserve_id: body.proof.reserve_id,
        device_id: body.proof.device_id,
        actor_id: body.proof.actor_id,
        matched_user_id: body.proof.matched_user_id,
        purpose: body.proof.purpose,
        document_type: body.proof.document_type,
        document_id: body.proof.document_id,
        document_hash: body.proof.document_hash,
        match_score: body.proof.match_score,
        finger_index: body.proof.finger_index,
        liveness_passed: body.proof.liveness_passed,
        bridge_signature: body.bridge_signature,
        signature_algorithm: "ed25519",
        sdk_version: body.proof.sdk_version,
        bridge_version: body.proof.bridge_version,
        result: body.result,
        failure_reason: body.failure_reason ?? null,
      })
      .select("id, challenge_id, result, matched_user_id, match_score, created_at")
      .single();
    if (proofErr || !proofRow) return c.json({ error: "Não foi possível registrar proof biométrica" }, 500);

    await supabase
      .from("biometric_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", body.proof.device_id)
      .eq("tenant_id", tenantId);

    return c.json({ proof: proofRow }, 201);
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
