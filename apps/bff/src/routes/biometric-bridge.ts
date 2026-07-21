import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { supabase } from "../services/supabase";
import { deviceAuthMiddleware } from "../middleware/biometric-device-auth";
import { hashPairingCode } from "../lib/biometric-pairing-code";
import {
  assertChallengeAcceptsProof,
  biometricPurposeRequiresExpectedUser,
  verifyBridgeSignature,
  type BiometricChallengeForProof,
  type BiometricEnrollmentRequest,
  type BiometricProofPayload,
} from "../lib/biometric-proof";
import { BiometricEnrollmentError, recordBiometricEnrollment } from "../lib/biometric-enrollment";
import { assertBiometricPolicy, type BiometricSubjectStatus } from "../lib/biometric-policy";
import { deriveTenantTemplateKey } from "../lib/biometric-template-key";
import type { HonoVariables } from "../types/hono";

/**
 * Rotas bridge-facing do bridge Windows real (Phase 1B) — device-auth
 * (Ed25519 + timestamp + nonce), nunca cookie/sessão de usuário. Montadas em
 * /api/biometric-bridge/*, DELIBERADAMENTE fora do wildcard
 * app.use("/api/biometric/*", authMiddleware) — ver index.ts e a nota de
 * auditoria na spec (achado CRITICAL C1: authMiddleware interceptava o
 * wildcard antes de deviceAuthMiddleware rodar, derrubando todo request do
 * bridge real com 401).
 */
export const biometricBridgeRoutes = new Hono<{ Variables: HonoVariables }>();

const BIOMETRIC_MIN_SCORE = parseFloat(process.env.BIOMETRIC_MIN_SCORE ?? "0.92");
const BIOMETRIC_REQUIRE_LIVENESS = process.env.BIOMETRIC_REQUIRE_LIVENESS === "true";
const TEMPLATE_SYNC_PAGE_SIZE = Number.parseInt(process.env.BIOMETRIC_TEMPLATE_SYNC_PAGE_SIZE ?? "500", 10);

function parseBridgeBody<T>(rawBody: string | undefined, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    throw new HTTPException(400, { message: "Corpo da requisição não é JSON válido" });
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new HTTPException(400, { message: `Corpo inválido: ${result.error.issues.map((i) => i.message).join("; ")}` });
  }
  return result.data;
}

// ── POST /pair ───────────────────────────────────────────────────────────
// Único endpoint bridge-facing que NÃO usa deviceAuthMiddleware — o device
// ainda não existe no momento do pareamento. A credencial é o código
// one-time emitido por POST /api/biometric/pairing-codes (browser-facing,
// admin autenticado).

// device_name NÃO faz parte deste payload — achado real (spec Fase 1C,
// seção 2.2): o admin já escolhe o device_name ao gerar o pairing code
// (POST /api/biometric/pairing-codes), e o RPC consume_biometric_pairing_
// code agora usa esse valor (v_code.device_name), nunca um que o bridge
// afirme. Um bridge nunca deveria poder escolher/sobrescrever a própria
// identidade operacional — isso é decisão de quem autoriza o pareamento,
// não de quem está pareando.
const pairSchema = z.object({
  pairing_code: z.string().min(8).max(64),
  public_key: z.string().min(32).max(4096),
  sdk_vendor: z.string().max(64).optional(),
  sdk_version: z.string().max(64).optional(),
  bridge_version: z.string().max(64).optional(),
  machine_name_hash: z.string().max(128).optional(),
  hardware_serial_hash: z.string().max(128).optional(),
});

biometricBridgeRoutes.post("/pair", async (c) => {
  const body = pairSchema.parse(await c.req.json().catch(() => {
    throw new HTTPException(400, { message: "Corpo da requisição não é JSON válido" });
  }));

  let codeHash: string;
  try {
    codeHash = hashPairingCode(body.pairing_code);
  } catch {
    return c.json({ error: "Pareamento indisponível no momento" }, 503);
  }

  const { data, error } = await supabase
    .rpc("consume_biometric_pairing_code", {
      p_code_hash: codeHash,
      p_public_key: body.public_key,
      p_sdk_vendor: body.sdk_vendor ?? null,
      p_sdk_version: body.sdk_version ?? null,
      p_bridge_version: body.bridge_version ?? null,
      p_machine_name_hash: body.machine_name_hash ?? null,
      p_hardware_serial_hash: body.hardware_serial_hash ?? null,
    })
    .single();

  if (error?.code === "P0001") {
    const status = error.message.includes("NOT_FOUND") ? 404
      : error.message.includes("ALREADY_USED") || error.message.includes("REVOKED") ? 410
      : error.message.includes("EXPIRED") ? 410
      : 409;
    return c.json({ error: error.message }, status);
  }
  if (error || !data) {
    c.get("log")?.error({ error: error?.message }, "biometric_bridge.pair.persist_failure");
    return c.json({ error: "Não foi possível parear o bridge" }, 500);
  }

  const pairedDevice = data as { device_id: string; tenant_id: string; reserve_id: string };
  return c.json({
    device_id: pairedDevice.device_id,
    tenant_id: pairedDevice.tenant_id,
    reserve_id: pairedDevice.reserve_id,
  }, 201);
});

// ── POST /heartbeat ─────────────────────────────────────────────────────

const heartbeatSchema = z.object({
  bridge_version: z.string().min(1).max(64),
  sdk_version: z.string().max(64).nullable().optional(),
  driver_version: z.string().max(64).nullable().optional(),
  device_detected: z.boolean(),
  device_model: z.string().max(120).nullable().optional(),
  last_error_code: z.string().max(120).nullable().optional(),
});

biometricBridgeRoutes.post("/heartbeat", deviceAuthMiddleware, async (c) => {
  const body = parseBridgeBody(c.get("bridgeRawBody"), heartbeatSchema);
  const deviceId = c.get("bridgeDeviceId")!;

  const update: Record<string, unknown> = {
    last_seen_at: new Date().toISOString(),
    bridge_version: body.bridge_version,
    // device_detected sempre gravado (não opcional no schema) — reflete o
    // estado do heartbeat mais recente, inclusive quando o leitor some do
    // USB entre um heartbeat e outro.
    device_detected: body.device_detected,
  };
  if (body.sdk_version !== undefined) update.sdk_version = body.sdk_version;
  if (body.driver_version !== undefined) update.driver_version = body.driver_version;
  if (body.device_model !== undefined) update.device_model = body.device_model;
  if (body.last_error_code) {
    update.last_error_code = body.last_error_code;
    update.last_error_at = new Date().toISOString();
  }

  const { error } = await supabase.from("biometric_devices").update(update).eq("id", deviceId);
  if (error) {
    c.get("log")?.error({ deviceId, error: error.message }, "biometric_bridge.heartbeat.update_failure");
    return c.json({ error: "Não foi possível registrar heartbeat" }, 500);
  }

  return c.json({ ok: true });
});

// ── GET /tenant-key ──────────────────────────────────────────────────────
// Entrega a chave AES-256-GCM que decifra os templates sincronizados via
// /templates/sync — ver spec Fase 1C, seção 3. Determinística (HKDF),
// nunca armazenada; qualquer device ativo do tenant recebe a MESMA chave.
// device-auth já garante que só um device pareado e ativo chega aqui —
// TLS protege o transporte (mesmo canal de /templates/sync), mas
// diferente daquele endpoint, aqui o payload é a CHAVE em si, não
// ciphertext — a spec exige certificate pinning no HttpClient do bridge
// para esta chamada especificamente (mitigação client-side, fora do
// alcance deste endpoint).

biometricBridgeRoutes.get("/tenant-key", deviceAuthMiddleware, async (c) => {
  const tenantId = c.get("bridgeTenantId")!;
  try {
    const tenantKey = await deriveTenantTemplateKey(tenantId);
    // Nome de campo específico (não "key" genérico) — achado MÉDIO de code
    // review: facilita redação de log alvo (REDACT_PATHS, logger.ts) sem
    // risco de colidir com outro campo qualquer chamado "key" em algum
    // objeto logado no futuro.
    return c.json({ tenant_key: tenantKey, algorithm: "aes-256-gcm" });
  } catch (error) {
    c.get("log")?.error({ tenantId, error: error instanceof Error ? error.message : String(error) }, "biometric_bridge.tenant_key.derive_failure");
    return c.json({ error: "Não foi possível derivar a chave do tenant" }, 500);
  }
});

// ── GET /challenges/next ────────────────────────────────────────────────

biometricBridgeRoutes.get("/challenges/next", deviceAuthMiddleware, async (c) => {
  const deviceId = c.get("bridgeDeviceId")!;
  const tenantId = c.get("bridgeTenantId")!;
  const reserveId = c.get("bridgeReserveId")!;
  const requestedReserveId = c.req.query("reserve_id");

  if (requestedReserveId && requestedReserveId !== reserveId) {
    return c.json({ error: "Reserva não corresponde ao device pareado" }, 403);
  }

  const nowIso = new Date().toISOString();
  const { data: candidate, error: candidateErr } = await supabase
    .from("biometric_challenges")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("reserve_id", reserveId)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .or(`device_id.is.null,device_id.eq.${deviceId}`)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (candidateErr) {
    c.get("log")?.error({ deviceId, error: candidateErr.message }, "biometric_bridge.challenges_next.query_failure");
    return c.json({ error: "Não foi possível buscar desafios pendentes" }, 500);
  }
  if (!candidate) {
    return c.json({ challenge: null, poll_after_ms: 1500 });
  }

  // Claim atômico: a condição WHERE (status=pending + device_id nulo/próprio)
  // garante que, se outro device claimou entre o SELECT e este UPDATE, 0
  // linhas são afetadas e a chamada seguinte de poll pega o próximo.
  const { data: claimed, error: claimErr } = await supabase
    .from("biometric_challenges")
    .update({ device_id: deviceId })
    .eq("id", candidate.id)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .or(`device_id.is.null,device_id.eq.${deviceId}`)
    .select("id, tenant_id, reserve_id, actor_id, purpose, expected_user_id, document_type, document_id, document_hash, expires_at")
    .maybeSingle();

  if (claimErr) {
    c.get("log")?.error({ deviceId, error: claimErr.message }, "biometric_bridge.challenges_next.claim_failure");
    return c.json({ error: "Não foi possível reivindicar o desafio" }, 500);
  }
  if (!claimed) {
    return c.json({ challenge: null, poll_after_ms: 1500 });
  }

  return c.json({ challenge: claimed });
});

// ── GET /templates/sync ─────────────────────────────────────────────────

// Cursor opaco "<updated_at ISO>|<id>" — achado de code review: um cursor
// baseado só em updated_at descarta linhas silenciosamente se mais de
// TEMPLATE_SYNC_PAGE_SIZE registros compartilharem o mesmo timestamp exato
// (plausível em backfill/seed em massa, onde vários INSERTs na mesma
// transação recebem o mesmo now()) — `.gt("updated_at", cursor)` pularia
// direto por cima de qualquer linha empatada além da página atual. O
// desempate por `id` (UUID, estável) fecha essa lacuna sem exigir uma
// coluna de sequência nova.
function parseTemplateSyncCursor(raw: string): { updatedAt: string; id: string } | null {
  const sep = raw.lastIndexOf("|");
  if (sep === -1) return null;
  const updatedAtRaw = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  const updatedAt = new Date(updatedAtRaw);
  if (Number.isNaN(updatedAt.getTime()) || !id) return null;
  return { updatedAt: updatedAt.toISOString(), id };
}

biometricBridgeRoutes.get("/templates/sync", deviceAuthMiddleware, async (c) => {
  const tenantId = c.get("bridgeTenantId")!;
  const since = c.req.query("since");

  let query = supabase
    .from("biometric_templates")
    .select("id, user_id, finger_index, template_data, template_hash, format, sdk_version, quality, updated_at")
    .eq("tenant_id", tenantId)
    .is("revoked_at", null)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(TEMPLATE_SYNC_PAGE_SIZE);

  if (since) {
    const cursor = parseTemplateSyncCursor(since);
    if (!cursor) {
      return c.json({ error: "Parâmetro since inválido" }, 400);
    }
    query = query.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`);
  }

  const { data, error } = await query;
  if (error) {
    c.get("log")?.error({ tenantId, error: error.message }, "biometric_bridge.templates_sync.query_failure");
    return c.json({ error: "Não foi possível sincronizar templates" }, 500);
  }

  const templates = (data ?? []).map((row) => ({
    user_id: row.user_id,
    finger_index: row.finger_index,
    // template_data vem como bytea (Buffer/hex do driver) — normaliza para
    // base64, nunca loga o conteúdo.
    template_data: Buffer.isBuffer(row.template_data)
      ? row.template_data.toString("base64")
      : typeof row.template_data === "string"
        ? Buffer.from(row.template_data.replace(/^\\x/, ""), "hex").toString("base64")
        : null,
    template_hash: row.template_hash,
    format: row.format,
    sdk_version: row.sdk_version,
    quality: row.quality,
    updated_at: row.updated_at,
  }));

  const rows = data ?? [];
  const lastRow = rows[rows.length - 1];
  const nextCursor = rows.length === TEMPLATE_SYNC_PAGE_SIZE && lastRow
    ? `${lastRow.updated_at}|${lastRow.id}`
    : null;

  return c.json({ templates, next_cursor: nextCursor });
});

// ── POST /challenges/:id/proof ──────────────────────────────────────────
// Equivalente bridge-facing de POST /api/biometric/challenges/:id/submit —
// mesma validação de negócio (assertChallengeAcceptsProof, política de
// score/liveness, RPC record_biometric_proof), mas autoridade vem do
// device-auth, não de cookie/sessão.

const proofPayloadSchema = z.object({
  challenge_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  reserve_id: z.string().uuid(),
  device_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  purpose: z.string(),
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

const bridgeProofSubmitSchema = z.object({
  proof: proofPayloadSchema,
  bridge_signature: z.string().min(32).max(8192),
  result: z.enum(["success", "failure", "error"]).default("success"),
  failure_reason: z.string().max(240).nullable().optional(),
});

biometricBridgeRoutes.post("/challenges/:id/proof", deviceAuthMiddleware, async (c) => {
  const deviceId = c.get("bridgeDeviceId")!;
  const tenantId = c.get("bridgeTenantId")!;
  const reserveId = c.get("bridgeReserveId")!;
  const id = c.req.param("id");
  const body = parseBridgeBody(c.get("bridgeRawBody"), bridgeProofSubmitSchema);

  if (id !== body.proof.challenge_id) return c.json({ error: "Challenge inválido" }, 400);
  if (body.proof.device_id !== deviceId) return c.json({ error: "device_id da proof não corresponde ao device autenticado" }, 403);
  if (body.proof.tenant_id !== tenantId || body.proof.reserve_id !== reserveId) {
    return c.json({ error: "Escopo da proof não corresponde ao device autenticado" }, 403);
  }

  const { data: challenge, error: challengeErr } = await supabase
    .from("biometric_challenges")
    .select("id, tenant_id, reserve_id, device_id, actor_id, purpose, expected_user_id, document_type, document_id, document_hash, status, expires_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("reserve_id", reserveId)
    .maybeSingle();
  if (challengeErr) return c.json({ error: "Não foi possível buscar desafio biométrico" }, 500);
  if (!challenge) return c.json({ error: "Desafio biométrico não encontrado" }, 404);
  if (challenge.purpose === "enroll") {
    return c.json({ error: "BIOMETRIC_ENROLLMENT_ENDPOINT_REQUIRED", message: "Use POST /challenges/:id/enrollment" }, 409);
  }
  // claim de /challenges/next já vinculou device_id — proof de outro device
  // para a mesma challenge é rejeitada aqui também, defesa em profundidade.
  if (challenge.device_id && challenge.device_id !== deviceId) {
    return c.json({ error: "Desafio reivindicado por outro device" }, 403);
  }

  const publicKey = await supabase
    .from("biometric_devices")
    .select("public_key, status")
    .eq("id", deviceId)
    .single();
  if (publicKey.error || !publicKey.data || publicKey.data.status !== "active") {
    return c.json({ error: "Bridge biométrico não autorizado" }, 403);
  }

  try {
    assertChallengeAcceptsProof(challenge as BiometricChallengeForProof, body.proof);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Proof biométrica inválida" }, 400);
  }

  if (!verifyBridgeSignature(body.proof, publicKey.data.public_key, body.bridge_signature)) {
    return c.json({ error: "Assinatura biométrica inválida" }, 401);
  }

  if (body.result === "success") {
    if (!body.proof.matched_user_id) return c.json({ error: "Proof biometrica sem usuario identificado" }, 400);
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
        activeReserveId: reserveId,
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

  await supabase.from("biometric_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);

  return c.json({ proof: proofRow }, 201);
});

// ── POST /challenges/:id/enrollment ─────────────────────────────────────

const bridgeEnrollmentSchema = z.object({
  proof: proofPayloadSchema,
  encrypted_template_data: z.string().min(4).max(1_000_000),
  template_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  format: z.string().min(1).max(64),
  quality: z.number().int().min(0).max(100),
  bridge_signature: z.string().min(32).max(8192),
});

const BIOMETRIC_ENROLLMENT_MIN_QUALITY = Number.parseInt(
  process.env.BIOMETRIC_ENROLLMENT_MIN_QUALITY ?? process.env.BIOMETRIC_MIN_ENROLLMENT_QUALITY ?? "70",
  10,
);
const BIOMETRIC_TEMPLATE_MAX_BYTES = Number.parseInt(process.env.BIOMETRIC_TEMPLATE_MAX_BYTES ?? "262144", 10);

biometricBridgeRoutes.post("/challenges/:id/enrollment", deviceAuthMiddleware, async (c) => {
  const deviceId = c.get("bridgeDeviceId")!;
  const tenantId = c.get("bridgeTenantId")!;
  const reserveId = c.get("bridgeReserveId")!;
  const id = c.req.param("id");
  const body = parseBridgeBody(c.get("bridgeRawBody"), bridgeEnrollmentSchema);

  if (id !== body.proof.challenge_id) return c.json({ error: "Challenge inválido" }, 400);
  if (body.proof.device_id !== deviceId) return c.json({ error: "device_id da proof não corresponde ao device autenticado" }, 403);

  const { data: challenge, error: challengeErr } = await supabase
    .from("biometric_challenges")
    .select("id, tenant_id, reserve_id, device_id, actor_id, purpose, expected_user_id, document_type, document_id, document_hash, status, expires_at")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("reserve_id", reserveId)
    .maybeSingle();
  if (challengeErr) return c.json({ error: "Não foi possível buscar desafio biométrico" }, 500);
  if (!challenge) return c.json({ error: "Desafio biométrico não encontrado" }, 404);
  if (challenge.purpose !== "enroll" || !challenge.expected_user_id) {
    return c.json({ error: "Desafio não é de enrollment" }, 409);
  }
  if (challenge.device_id && challenge.device_id !== deviceId) {
    return c.json({ error: "Desafio reivindicado por outro device" }, 403);
  }

  const { data: device, error: deviceErr } = await supabase
    .from("biometric_devices")
    .select("id, tenant_id, reserve_id, public_key, status")
    .eq("id", deviceId)
    .maybeSingle();
  if (deviceErr) return c.json({ error: "Não foi possível buscar bridge biométrico" }, 500);
  if (!device || device.status !== "active") return c.json({ error: "Bridge biométrico não autorizado" }, 403);

  const { data: targetUser, error: targetUserErr } = await supabase
    .from("profiles")
    .select("id, default_tenant_id, registration_status")
    .eq("id", challenge.expected_user_id)
    .eq("default_tenant_id", tenantId)
    .maybeSingle();
  if (targetUserErr) return c.json({ error: "Não foi possível validar usuário do enrollment" }, 500);
  if (!targetUser) return c.json({ error: "Usuário do enrollment não pertence ao tenant" }, 403);

  try {
    const result = await recordBiometricEnrollment(
      supabase,
      body as BiometricEnrollmentRequest,
      {
        activeTenantId: tenantId,
        activeReserveId: reserveId,
        // O bridge não tem ator humano próprio — age em nome de quem criou
        // a challenge (armeiro/admin que iniciou o cadastro na UI).
        actorId: challenge.actor_id,
        challenge: challenge as BiometricChallengeForProof,
        device,
        targetUser,
        minQuality: BIOMETRIC_ENROLLMENT_MIN_QUALITY,
        maxTemplateBytes: BIOMETRIC_TEMPLATE_MAX_BYTES,
        requireLiveness: BIOMETRIC_REQUIRE_LIVENESS,
      },
    );
    await supabase.from("biometric_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", deviceId);
    return c.json({ enrollment: result }, 201);
  } catch (error) {
    if (error instanceof BiometricEnrollmentError) {
      return c.json({ error: error.code, message: error.message }, error.status);
    }
    return c.json({ error: "Não foi possível registrar enrollment biométrico" }, 500);
  }
});
