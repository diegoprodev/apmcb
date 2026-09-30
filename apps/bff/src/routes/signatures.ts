import { Hono } from "hono";
import { zValidator } from "../lib/validated-json";
import { z } from "zod";
import { verifySync } from "otplib";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { hashDocument } from "../lib/document-hash";
import { computeSignatureProof } from "../lib/signature-proof";
import { readSecret, sameToken } from "./totp";
import { logFailure, logRejection } from "../lib/rejection-log";
import { canAccessResourceReserve } from "../lib/reserve-scope";
import type { HonoVariables } from "../types/hono";

export const signatureRoutes = new Hono<{ Variables: HonoVariables }>();
export const signatureVerifyRoutes = new Hono<{ Variables: HonoVariables }>();

// SP4 review (achado A4): o enum tinha "inventory"/"inventory_campaign" —
// vocabulário divergente dos 3 valores REAIS usados pelos endpoints
// específicos (lending/handover/inventory_reserve_check, confirmados por
// grep em docs/superpowers/specs/sp4-reserve-id-insert-sites-audit.md).
// Com o valor antigo, o TOTP era consumido e o INSERT sempre falhava com
// RAISE do dispatcher (document_type desconhecido). inventory_campaign é
// multi-reserva por design (reserve_ids array) — não tem reserve_id único
// pra derivar, não suportado por este mecanismo.
const signSchema = z.object({
  document_type: z.enum(["lending", "handover", "inventory_reserve_check"]),
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

    if (!tenantId) {
      logRejection(c, "signature.create.rejected", { reason: "session_invalid", signerId });
      return c.json({ error: "Tenant não identificado." }, 400);
    }

    // Achado 2026-09-30: assinava qualquer document_id do tenant — a reserva
    // do documento precisa ser a do ator (matriz: tenant), ANTES de consumir
    // o código dinâmico. Mesma derivação do trigger dispatcher de
    // document_signatures (handover = passagem de serviço OU cautela).
    const docReserve = await resolveSignedDocumentReserve(body.document_type, body.document_id, tenantId);
    if (docReserve.error) {
      logFailure(c, { signerId, documentType: body.document_type, error: docReserve.error }, "signature.create.document_query_failure");
      return c.json({ error: "Não foi possível concluir agora. Tente novamente." }, 503);
    }
    if (!docReserve.reserveId || !canAccessResourceReserve(c.get("role"), c.get("reserveId") ?? null, docReserve.reserveId)) {
      logRejection(c, "signature.create.rejected", { reason: docReserve.reserveId ? "resource_outside_reserve" : "document_not_found", signerId, documentType: body.document_type });
      return c.json({ error: "Documento não encontrado." }, 404);
    }

    // Validate TOTP (signer validates own token)
    const { data: totpRow, error: totpErr } = await supabase
      .from("totp_secrets")
      .select("id, secret, failure_count, last_failure_at, last_used_token")
      .eq("user_id", signerId)
      .eq("enabled", true)
      .maybeSingle();

    if (totpErr || !totpRow) {
      logRejection(c, "signature.create.rejected", { reason: "totp_not_configured", signerId });
      return c.json({ error: "Código dinâmico não configurado. Configure antes de assinar." }, 403);
    }

    const RATE_MAX = 5;
    const RATE_WINDOW = 15 * 60 * 1000;
    if (totpRow.failure_count >= RATE_MAX && totpRow.last_failure_at) {
      const elapsed = Date.now() - new Date(totpRow.last_failure_at).getTime();
      if (elapsed < RATE_WINDOW) {
        const retry = Math.ceil((RATE_WINDOW - elapsed) / 1000);
        logRejection(c, "signature.create.rejected", { reason: "totp_rate_limited", signerId });
        return c.json({ error: "Conta bloqueada por tentativas excessivas.", retry_after_seconds: retry }, 429);
      }
    }

    // Anti-replay: deve vir ANTES de verifySync para evitar race condition
    if (sameToken(totpRow.last_used_token, body.totp_token)) {
      logRejection(c, "signature.create.rejected", { reason: "totp_replay", signerId });
      return c.json({ error: "Código dinâmico já utilizado neste período.", valid: false }, 400);
    }

    let plainSecret: string;
    try {
      plainSecret = await readSecret(totpRow.secret);
    } catch (err) {
      logRejection(c, "signature.create.rejected", { reason: "totp_secret_unreadable", signerId }, err instanceof Error ? err.message : null);
      return c.json({ error: "Código dinâmico inválido. Reconfigure o autenticador em 'Meu Perfil'." }, 400);
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
      logRejection(c, "signature.create.rejected", { reason: "totp_invalid", signerId, attempt: newCount });
      return c.json({ error: "Código dinâmico inválido.", valid: false }, 400);
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
      logFailure(c, { signerId, code: insertErr?.code }, "signature.create.persist_failure");
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
    const document_id     = c.req.param("document_id");
    const tenantId        = c.get("tenantId");
    const role            = c.get("role");
    const activeReserveId = c.get("reserveId");

    let query = supabase
      .from("document_signatures")
      .select(`
        id, document_type, document_id, document_hash, signature_proof,
        signed_at, ip, totp_verified, signature_level, reserve_id,
        revoked_at, revocation_reason, replaced_by, created_at,
        signer:profiles!document_signatures_signer_id_fkey(nome_completo, matricula, posto)
      `)
      .eq("document_id", document_id)
      .order("created_at", { ascending: true });

    if (tenantId) query = query.eq("tenant_id", tenantId);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    // Achado real (SP9.5, 2026-09-18): faltava confinamento por reserva —
    // qualquer staff via assinaturas de documento de OUTRA reserva do
    // mesmo tenant sabendo o document_id (IDOR). Todas as linhas de um
    // mesmo document_id compartilham reserve_id (mesmo documento).
    const firstReserveId = (data ?? [])[0]?.reserve_id ?? null;
    if (firstReserveId && !canAccessResourceReserve(role, activeReserveId, firstReserveId)) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    const sanitized = (data ?? []).map(({ reserve_id: _omit, ...row }) => row);
    return c.json(sanitized);
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

    if (!tenantId) {
      logRejection(c, "signature.revoke.rejected", { reason: "session_invalid", signatureId: id });
      return c.json({ error: "Tenant não identificado." }, 400);
    }
    // Achado 2026-09-30: buscava só por id (tenant condicional) — um
    // admin_reserva de B revogava a evidência de assinatura de um documento
    // da reserva A. Tenant sempre, e a reserva do documento na do ator.
    const { data: existing, error: fetchErr } = await supabase
      .from("document_signatures")
      .select("id, revoked_at, document_type, document_id, reserve_id")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (fetchErr) {
      logFailure(c, { signatureId: id, error: fetchErr.message }, "signature.revoke.query_failure");
      return c.json({ error: "Não foi possível concluir agora. Tente novamente." }, 503);
    }
    if (!existing || !canAccessResourceReserve(c.get("role"), c.get("reserveId") ?? null, existing.reserve_id as string | null)) {
      logRejection(c, "signature.revoke.rejected", { reason: existing ? "resource_outside_reserve" : "signature_not_found", signatureId: id });
      return c.json({ error: "Assinatura não encontrada." }, 404);
    }
    // A RULE do banco bloqueia UPDATE em document_signatures — a revogação
    // insere uma linha nova com replaced_by=id, e existing.revoked_at do
    // registro ORIGINAL nunca muda (fica sempre null). Checar revoked_at
    // aqui nunca detecta uma revogação anterior: é preciso procurar se já
    // existe uma linha de substituição (achado 2026-09-30).
    const { data: previousRevocation, error: prevErr } = await supabase
      .from("document_signatures").select("id").eq("replaced_by", id).limit(1);
    if (prevErr) {
      logFailure(c, { signatureId: id, error: prevErr.message }, "signature.revoke.replacement_query_failure");
      return c.json({ error: "Não foi possível concluir agora. Tente novamente." }, 503);
    }
    if (previousRevocation && previousRevocation.length > 0) {
      logRejection(c, "signature.revoke.rejected", { reason: "already_revoked", signatureId: id });
      return c.json({ error: "Assinatura já revogada." }, 409);
    }

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

    if (replErr || !replacement) {
      logFailure(c, { signatureId: id, code: replErr?.code }, "signature.revoke.persist_failure");
      return c.json({ error: "Falha ao registrar revogação." }, 500);
    }

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
//
// PII: matrícula é o próprio username de login (mesmo raciocínio já
// documentado em routes/public.ts para /api/public/shifts/:id/verify) —
// qualquer um com o link/QR consegue identificar um usuário válido sem
// autenticação. A resposta pública nunca inclui matrícula, só nome/posto
// (suficiente para conferência humana do documento).
signatureVerifyRoutes.get("/:document_id", async (c) => {
  const document_id = c.req.param("document_id");

  const { data, error } = await supabase
    .from("document_signatures")
    .select(`
      id, document_type, document_id, document_hash, signature_proof,
      signed_at, totp_verified, signature_level,
      revoked_at, revocation_reason, replaced_by, created_at,
      signer:profiles!document_signatures_signer_id_fkey(nome_completo, posto)
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

// Reserva do documento assinado — mesma derivação do trigger dispatcher de
// document_signatures (20260911130250): 'handover' é passagem de serviço OU
// cautela. Sempre com filtro de tenant.
async function resolveSignedDocumentReserve(
  documentType: "lending" | "handover" | "inventory_reserve_check",
  documentId: string,
  tenantId: string,
): Promise<{ reserveId: string | null; error?: string }> {
  const lookup = async (table: string) => {
    const { data, error } = await supabase.from(table).select("reserve_id").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
    return { reserveId: (data?.reserve_id as string | null | undefined) ?? null, error: error?.message };
  };
  if (documentType === "lending") return lookup("lendings");
  if (documentType === "inventory_reserve_check") return lookup("inventory_reserve_checks");
  const handover = await lookup("service_handovers");
  if (handover.error || handover.reserveId) return handover;
  return lookup("cautelamentos");
}
