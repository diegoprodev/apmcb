/**
 * /api/saidas — Saída Diária Enterprise (item-based, Fase 5)
 *
 * Usa a tabela `lendings` com campos Fase 5: item_id, status, armeiro_signature_id, militar_signature_id.
 * O endpoint legacy /api/lendings continua funcionando para compatibilidade (material_type_id).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";
import { checkTotpGuard } from "../lib/totp-guard";
import { readSecret } from "./totp";

export const saidasRoutes = new Hono<{ Variables: HonoVariables }>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function validateTotp(
  userId: string,
  token: string
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const { data: row } = await supabase
    .from("totp_secrets")
    .select("id, secret, failure_count, last_failure_at, last_used_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (!row) return { ok: false, error: "TOTP não configurado", status: 404 };

  let plainSecret: string;
  try {
    plainSecret = await readSecret(row.secret);
  } catch {
    return { ok: false, error: "TOTP secret inválido — reconfigurar o autenticador", status: 400 };
  }

  const result = checkTotpGuard({ ...row, secret: plainSecret }, token);

  if (!result.ok) {
    if (result.status === 400 && result.error === "TOTP inválido") {
      await supabase.from("totp_secrets")
        .update({ failure_count: (row.failure_count ?? 0) + 1, last_failure_at: new Date().toISOString() })
        .eq("id", row.id);
    }
    return result;
  }

  await supabase.from("totp_secrets")
    .update({ last_used_token: token, failure_count: 0 })
    .eq("id", row.id);

  return { ok: true };
}


const signBodySchema = z
  .object({
    totp_token:    z.string().length(6).regex(/^\d{6}$/).optional(),
    use_biometric: z.boolean().optional(),
    biometric_proof_id: z.string().uuid().optional(),
  })
  .refine((d) => d.totp_token || d.use_biometric || d.biometric_proof_id, {
    message: "Informe totp_token ou um modo de autenticacao",
  });

const BIOMETRIC_BRIDGE_REQUIRED = {
  error: "BIOMETRIC_BRIDGE_REQUIRED",
  message: "Use o fluxo challenge/proof do Biometric Bridge; o SDK USB legado nao e executado no BFF.",
};
const LEGACY_CUSTODY_FLOW_RETIRED = {
  error: "LEGACY_CUSTODY_FLOW_RETIRED",
  message: "Use /api/lendings com verificacao TOTP ou challenge/proof biometrico.",
};

// ─── GET /api/saidas ──────────────────────────────────────────────────────────

saidasRoutes.get(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const { status, militar_id } = c.req.query();
    if (!tenantId) return c.json({ error: "Tenant nao identificado na sessao" }, 400);

    let query = supabase
      .from("lendings")
      .select(`
        *,
        item:material_items(id, numero_serie, status_operacional, material_type:material_types(nome, categoria)),
        militar:profiles!lendings_military_id_fkey(id, nome_completo, matricula, posto),
        armeiro:profiles!lendings_master_id_fkey(id, nome_completo, matricula)
      `)
      .not("item_id", "is", null)
      .order("issued_at", { ascending: false });

    query = query.eq("tenant_id", tenantId);
    if (status)     query = query.eq("status", status);
    if (militar_id) query = query.eq("military_id", militar_id);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ saidas: data ?? [] });
  }
);

// ─── POST /api/saidas ─────────────────────────────────────────────────────────

saidasRoutes.post(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", z.object({
    item_id: z.string().uuid(),
    militar_id: z.string().uuid(),
    reserve_id: z.string().uuid().optional(),
    observacao: z.string().optional(),
  })),
  async (c) => {
    if (!c.get("tenantId")) return c.json({ error: "Tenant nao identificado na sessao" }, 400);
    return c.json(LEGACY_CUSTODY_FLOW_RETIRED, 501);
  },
);


// ─── POST /api/saidas/:id/sign-armeiro ───────────────────────────────────────

saidasRoutes.post(
  "/:id/sign-armeiro",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", signBodySchema),
  async (c) => {
    const id        = c.req.param("id");
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    const { data: saida } = await supabase
      .from("lendings")
      .select("id, status, document_hash, armeiro_signature_id, tenant_id")
      .eq("id", id)
      .not("item_id", "is", null)
      .single();

    if (!saida) return c.json({ error: "Saída não encontrada" }, 404);
    if (tenantId && saida.tenant_id !== tenantId) return c.json({ error: "Saída não encontrada" }, 404);
    if (saida.armeiro_signature_id) return c.json({ error: "Armeiro já assinou" }, 422);

    const authMethod = "totp" as const;
    if (body.use_biometric || body.biometric_proof_id) {
      return c.json(BIOMETRIC_BRIDGE_REQUIRED, 501);
    } else {
      const r = await validateTotp(armeiroId, body.totp_token!);
      if (!r.ok) return c.json({ error: r.error }, (r.status ?? 400) as 400 | 404 | 429);
    }

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
    const { data: sig, error: sigErr } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id: tenantId, document_id: saida.id, document_type: "lending",
        signer_id: armeiroId, signer_role: "armeiro", signed_at: new Date().toISOString(),
        document_hash: saida.document_hash ?? "",
        signature_proof: `${saida.document_hash ?? ""}:${armeiroId}:armeiro`,
        ip,
        totp_verified: authMethod === "totp",
        biometric_verified: false,
      })
      .select("id").single();

    if (sigErr || !sig) {
      c.get("log").error({ code: sigErr?.code, error: sigErr?.message, tenantId }, "saida.sign_armeiro.persist_failure");
      return c.json({ error: sigErr?.message ?? "Erro ao criar assinatura" }, 500);
    }

    const { data: signedSaida, error: lendingUpd } = await supabase.from("lendings").update({
      armeiro_signature_id: sig.id,
      status: "aguardando_confirmacao",
    })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("status", "emitida")
      .is("armeiro_signature_id", null)
      .select("id")
      .single();
    if (lendingUpd || !signedSaida) {
      await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
      c.get("log").error({ code: lendingUpd?.code, error: lendingUpd?.message, tenantId }, "saida.sign_armeiro.lending_update_failure");
      return c.json({ error: "Saída não encontrada ou já alterada" }, 409);
    }

    auditLog(c, { action: "signature.created", resource_type: "saida", resource_id: id,
      metadata: { signer_role: "armeiro", auth_method: authMethod } });

    return c.json({ ok: true, signature_id: sig.id, auth_method: authMethod });
  }
);

// ─── POST /api/saidas/:id/confirm ────────────────────────────────────────────

saidasRoutes.post(
  "/:id/confirm",
  roleGuard("usuario", "armeiro", "admin_reserva"),
  zValidator("json", signBodySchema),
  async (c) => {
    const id        = c.req.param("id");
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const militarId = c.get("userId")!;
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    const { data: saida } = await supabase
      .from("lendings")
      .select("id, status, military_id, document_hash, armeiro_signature_id, militar_signature_id, tenant_id")
      .eq("id", id)
      .not("item_id", "is", null)
      .single();

    if (!saida) return c.json({ error: "Saída não encontrada" }, 404);
    if (tenantId && saida.tenant_id !== tenantId) return c.json({ error: "Saída não encontrada" }, 404);
    if (saida.military_id !== militarId) return c.json({ error: "Apenas o militar responsável pode confirmar" }, 403);
    if (!saida.armeiro_signature_id) return c.json({ error: "Armeiro ainda não assinou" }, 422);
    if (saida.militar_signature_id) return c.json({ error: "Já confirmada" }, 422);

    const authMethod = "totp" as const;
    if (body.use_biometric || body.biometric_proof_id) {
      return c.json(BIOMETRIC_BRIDGE_REQUIRED, 501);
    } else {
      const r = await validateTotp(militarId, body.totp_token!);
      if (!r.ok) return c.json({ error: r.error }, (r.status ?? 400) as 400 | 404 | 429);
    }

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
    const { data: sig, error: sigErr } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id: tenantId, document_id: saida.id, document_type: "lending",
        signer_id: militarId, signer_role: "militar", signed_at: new Date().toISOString(),
        document_hash: saida.document_hash ?? "",
        signature_proof: `${saida.document_hash ?? ""}:${militarId}:militar`,
        ip,
        totp_verified: authMethod === "totp",
        biometric_verified: false,
      })
      .select("id").single();

    if (sigErr || !sig) {
      c.get("log").error({ code: sigErr?.code, error: sigErr?.message, tenantId }, "saida.confirm.persist_failure");
      return c.json({ error: sigErr?.message ?? "Erro ao criar assinatura" }, 500);
    }

    const { data: confirmedSaida, error: confirmUpd } = await supabase.from("lendings").update({
      militar_signature_id: sig.id,
      status: "ativa",
    })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("military_id", militarId)
      .eq("status", "aguardando_confirmacao")
      .not("armeiro_signature_id", "is", null)
      .is("militar_signature_id", null)
      .select("id")
      .single();
    if (confirmUpd || !confirmedSaida) {
      await supabase.from("document_signatures").delete().eq("id", sig.id).eq("tenant_id", tenantId);
      c.get("log").error({ code: confirmUpd?.code, error: confirmUpd?.message, tenantId }, "saida.confirm.lending_update_failure");
      return c.json({ error: "Saída não encontrada ou já alterada" }, 409);
    }

    auditLog(c, { action: "signature.created", resource_type: "saida", resource_id: id,
      metadata: { signer_role: "militar", auth_method: authMethod } });

    return c.json({ ok: true, signature_id: sig.id });
  }
);

// ─── PATCH /api/saidas/:id/return ────────────────────────────────────────────

saidasRoutes.patch(
  "/:id/return",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", z.object({
    observacao: z.string().optional(),
    condicao_devolucao: z.enum(["bom", "regular", "ruim", "inapto"]).optional(),
  })),
  async (c) => {
    if (!c.get("tenantId")) return c.json({ error: "Tenant nao identificado na sessao" }, 400);
    return c.json(LEGACY_CUSTODY_FLOW_RETIRED, 501);
  },
);
