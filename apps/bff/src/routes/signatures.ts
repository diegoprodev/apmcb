import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { verifySync } from "otplib";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { hashDocument } from "../lib/document-hash";
import { computeSignatureProof } from "../lib/signature-proof";
import { readSecret } from "./totp";
import type { HonoVariables } from "../types/hono";

export const signatureRoutes = new Hono<{ Variables: HonoVariables }>();
export const signatureVerifyRoutes = new Hono<{ Variables: HonoVariables }>();

const signSchema = z.object({
  document_type: z.enum(["lending", "handover", "inventory", "inventory_campaign"]),
  document_id: z.string().uuid(),
  document_data: z.record(z.unknown()),
  totp_token: z.string().length(6).regex(/^\d{6}$/),
  signature_level: z.literal(1).or(z.literal(2)).or(z.literal(3)).default(1),
});

// POST /api/signatures — create a signed document record
signatureRoutes.post(
  "/",
  roleGuard("armeiro", "admin_global", "admin_reserva"),
  zValidator("json", signSchema),
  async (c) => {
    const body = c.req.valid("json");
    const signerId = c.get("userId")!;
    const tenantId = c.get("tenantId");
    const ip =
      c.req.header("x-forwarded-for") ??
      c.req.header("x-real-ip") ??
      "unknown";
    const userAgent = c.req.header("user-agent") ?? null;

    if (!tenantId) return c.json({ error: "Tenant não identificado." }, 400);

    // Validate TOTP (signer validates own token)
    const { data: totpRow, error: totpErr } = await supabase
      .from("totp_secrets")
      .select("id, secret, failure_count, last_failure_at, last_used_token")
      .eq("user_id", signerId)
      .eq("enabled", true)
      .maybeSingle();

    if (totpErr || !totpRow) {
      return c.json({ error: "TOTP não configurado. Configure antes de assinar." }, 403);
    }

    const RATE_MAX = 5;
    const RATE_WINDOW = 15 * 60 * 1000;
    if (totpRow.failure_count >= RATE_MAX && totpRow.last_failure_at) {
      const elapsed = Date.now() - new Date(totpRow.last_failure_at).getTime();
      if (elapsed < RATE_WINDOW) {
        const retry = Math.ceil((RATE_WINDOW - elapsed) / 1000);
        return c.json({ error: "Conta bloqueada por tentativas excessivas.", retry_after_seconds: retry }, 429);
      }
    }

    // Anti-replay: deve vir ANTES de verifySync para evitar race condition
    if (totpRow.last_used_token === body.totp_token) {
      return c.json({ error: "Código TOTP já utilizado neste período.", valid: false }, 400);
    }

    let plainSecret: string;
    try {
      plainSecret = await readSecret(totpRow.secret);
    } catch {
      return c.json({ error: "TOTP secret inválido. Reconfigure o autenticador em 'Meu Perfil'." }, 400);
    }

    const { valid: isValid } = verifySync({
      secret: plainSecret,
      token: body.totp_token,
      afterTimeStep: 1,
    });

    if (!isValid) {
      const newCount = (totpRow.failure_count ?? 0) + 1;
      await supabase
        .from("totp_secrets")
        .update({ failure_count: newCount, last_failure_at: new Date().toISOString() })
        .eq("id", totpRow.id);
      return c.json({ error: "Token TOTP inválido.", valid: false }, 400);
    }

    // Reset TOTP counter + mark token used
    await supabase
      .from("totp_secrets")
      .update({ failure_count: 0, last_failure_at: null, last_used_token: body.totp_token, last_validated_at: new Date().toISOString() })
      .eq("id", totpRow.id);

    // Compute hashes
    const document_hash = hashDocument({
      document_type: body.document_type,
      document_id: body.document_id,
      data: body.document_data,
    });

    const signed_at = new Date().toISOString();
    const signature_proof = computeSignatureProof({
      document_hash,
      signer_id: signerId,
      signed_at,
      ip,
    });

    const { data: sig, error: insertErr } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id: tenantId,
        signer_id: signerId,
        document_type: body.document_type,
        document_id: body.document_id,
        document_hash,
        signature_proof,
        signed_at,
        ip,
        user_agent: userAgent,
        totp_verified: true,
        signature_level: body.signature_level,
      })
      .select()
      .single();

    if (insertErr || !sig) {
      return c.json({ error: "Falha ao registrar assinatura." }, 500);
    }

    auditLog(c, {
      action: "signature.created",
      resource_type: "document_signatures",
      resource_id: sig.id,
      after_snapshot: {
        document_type: body.document_type,
        document_id: body.document_id,
        document_hash,
        signature_proof,
        signature_level: body.signature_level,
      },
    });

    return c.json(sig, 201);
  }
);

// GET /api/signatures/:document_id — list signatures for a document
signatureRoutes.get(
  "/:document_id",
  roleGuard("armeiro", "admin_global", "admin_reserva", "auditor"),
  async (c) => {
    const document_id = c.req.param("document_id");
    const tenantId = c.get("tenantId");

    let query = supabase
      .from("document_signatures")
      .select(`
        id, document_type, document_id, document_hash, signature_proof,
        signed_at, ip, totp_verified, signature_level,
        revoked_at, revocation_reason, replaced_by, created_at,
        signer:profiles!document_signatures_signer_id_fkey(nome_completo, matricula, posto)
      `)
      .eq("document_id", document_id)
      .order("created_at", { ascending: true });

    if (tenantId) query = query.eq("tenant_id", tenantId);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json(data);
  }
);

// POST /api/signatures/:id/revoke — revoke a signature (non-destructive)
signatureRoutes.post(
  "/:id/revoke",
  roleGuard("admin_global", "admin_reserva"),
  zValidator(
    "json",
    z.object({ revocation_reason: z.string().min(5).max(500) })
  ),
  async (c) => {
    const id = c.req.param("id");
    const tenantId = c.get("tenantId");
    const { revocation_reason } = c.req.valid("json");

    // Fetch existing to validate ownership and check if already revoked
    let q = supabase
      .from("document_signatures")
      .select("id, revoked_at, document_type, document_id")
      .eq("id", id);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data: existing, error: fetchErr } = await q.maybeSingle();

    if (fetchErr || !existing) return c.json({ error: "Assinatura não encontrada." }, 404);
    if (existing.revoked_at) return c.json({ error: "Assinatura já revogada." }, 409);

    // RULE blocks UPDATE — we insert a new replacement row instead
    const signerId = c.get("userId")!;
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
    const userAgent = c.req.header("user-agent") ?? null;
    const signed_at = new Date().toISOString();

    const document_hash = hashDocument({
      document_type: existing.document_type,
      document_id: existing.document_id,
      data: { revoked: true, original_id: id, revocation_reason },
    });
    const signature_proof = computeSignatureProof({ document_hash, signer_id: signerId, signed_at, ip });

    const { data: replacement, error: replErr } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id: tenantId,
        signer_id: signerId,
        document_type: existing.document_type,
        document_id: existing.document_id,
        document_hash,
        signature_proof,
        signed_at,
        ip,
        user_agent: userAgent,
        totp_verified: false,
        signature_level: 1,
        revoked_at: signed_at,
        revocation_reason,
        replaced_by: id,
      })
      .select()
      .single();

    if (replErr || !replacement) return c.json({ error: "Falha ao registrar revogação." }, 500);

    auditLog(c, {
      action: "signature.revoked",
      resource_type: "document_signatures",
      resource_id: id,
      metadata: { replacement_id: replacement.id, revocation_reason },
    });

    return c.json({ ok: true, replacement_id: replacement.id });
  }
);

// GET /api/verify/:document_id — PUBLIC — no auth required
signatureVerifyRoutes.get("/:document_id", async (c) => {
  const document_id = c.req.param("document_id");

  const { data, error } = await supabase
    .from("document_signatures")
    .select(`
      id, document_type, document_id, document_hash, signature_proof,
      signed_at, totp_verified, signature_level,
      revoked_at, revocation_reason, replaced_by, created_at,
      signer:profiles!document_signatures_signer_id_fkey(nome_completo, matricula, posto)
    `)
    .eq("document_id", document_id)
    .order("created_at", { ascending: true });

  if (error) return c.json({ error: "Erro ao consultar assinaturas." }, 500);
  if (!data || data.length === 0) return c.json({ found: false, signatures: [] }, 404);

  const active = data.filter((s) => !s.revoked_at);
  const revoked = data.filter((s) => s.revoked_at);

  return c.json({
    found: true,
    document_id,
    status: active.length > 0 ? "válido" : "revogado",
    active_signatures: active,
    revoked_signatures: revoked,
  });
});
