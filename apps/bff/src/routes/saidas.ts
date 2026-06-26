/**
 * /api/saidas — Saída Diária Enterprise (item-based, Fase 5)
 *
 * Usa a tabela `lendings` com campos Fase 5: item_id, status, armeiro_signature_id, militar_signature_id.
 * O endpoint legacy /api/lendings continua funcionando para compatibilidade (material_type_id).
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { verifySync } from "otplib";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { hashDocument } from "../lib/document-hash";
import { getFingerprintSDK } from "../services/fingerprint/index";
import type { HonoVariables } from "../types/hono";

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

  const RATE_MAX = 5;
  const RATE_WINDOW = 15 * 60 * 1000;
  if ((row.failure_count ?? 0) >= RATE_MAX && row.last_failure_at) {
    const elapsed = Date.now() - new Date(row.last_failure_at).getTime();
    if (elapsed < RATE_WINDOW) {
      const retry = Math.ceil((RATE_WINDOW - elapsed) / 1000);
      return { ok: false, error: `TOTP bloqueado — aguarde ${retry}s`, status: 429 };
    }
  }

  if (row.last_used_token === token) return { ok: false, error: "Código já utilizado", status: 400 };

  const { valid } = verifySync({ secret: row.secret, token, afterTimeStep: 1 });
  if (!valid) {
    await supabase.from("totp_secrets")
      .update({ failure_count: (row.failure_count ?? 0) + 1, last_failure_at: new Date().toISOString() })
      .eq("id", row.id);
    return { ok: false, error: "Código TOTP inválido", status: 400 };
  }

  await supabase.from("totp_secrets")
    .update({ last_used_token: token, failure_count: 0 })
    .eq("id", row.id);

  return { ok: true };
}

async function validateBiometric(
  expectedUserId: string
): Promise<{ ok: boolean; error?: string; status?: number }> {
  try {
    const sdk = await getFingerprintSDK();
    const captured = await sdk.capture(1);

    const { data: templates } = await supabase
      .from("biometric_templates")
      .select("user_id, template_data")
      .eq("user_id", expectedUserId);

    if (!templates || templates.length === 0) {
      return { ok: false, error: "Biometria não registrada para este usuário", status: 404 };
    }

    const result = await sdk.identify(
      captured.data,
      templates.map((t) => ({ userId: t.user_id, templateData: Buffer.from(t.template_data) }))
    );

    if (!result || result.userId !== expectedUserId) {
      return { ok: false, error: "Biometria não reconhecida", status: 401 };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Erro no hardware biométrico — tente TOTP", status: 503 };
  }
}

const signBodySchema = z
  .object({
    totp_token:    z.string().length(6).regex(/^\d{6}$/).optional(),
    use_biometric: z.boolean().optional(),
  })
  .refine((d) => d.totp_token || d.use_biometric, {
    message: "Informe totp_token ou use_biometric: true",
  });

// ─── GET /api/saidas ──────────────────────────────────────────────────────────

saidasRoutes.get(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin", "auditor"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const { status, militar_id } = c.req.query();

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

    if (tenantId)   query = query.eq("tenant_id", tenantId);
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
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", z.object({
    item_id:    z.string().uuid(),
    militar_id: z.string().uuid(),
    reserve_id: z.string().uuid().optional(),
    observacao: z.string().optional(),
  })),
  async (c) => {
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;

    // Verificar item
    const { data: item, error: itemErr } = await supabase
      .from("material_items")
      .select("id, status_operacional, tenant_id, material_type_id")
      .eq("id", body.item_id)
      .single();

    if (itemErr || !item) return c.json({ error: "Item não encontrado" }, 404);
    if (tenantId && item.tenant_id !== tenantId) return c.json({ error: "Item não encontrado" }, 404);
    if (item.status_operacional !== "disponivel") {
      return c.json({ error: `Item não disponível: ${item.status_operacional}` }, 409);
    }

    // Bloquear despacho para militares com impedimento administrativo
    const { data: militarProfile } = await supabase
      .from("profiles")
      .select("registration_status")
      .eq("id", body.militar_id)
      .single();
    if (militarProfile?.registration_status === "impedimento_administrativo") {
      return c.json(
        { error: "Militar com impedimento administrativo. Para dúvidas, procure o Departamento de Pessoas de sua unidade." },
        403
      );
    }

    const docHash = hashDocument({
      document_type: "lending",
      document_id:   "new",
      data: { item_id: body.item_id, militar_id: body.militar_id, armeiro_id: armeiroId, issued_at: new Date().toISOString() },
    });

    const { data: saida, error: sErr } = await supabase
      .from("lendings")
      .insert({
        tenant_id:       tenantId,
        item_id:         body.item_id,
        material_type_id: item.material_type_id,
        military_id:     body.militar_id,
        master_id:       armeiroId,
        reserve_id:      body.reserve_id ?? null,
        status:          "emitida",
        status_legacy:   "ativo",
        document_hash:   docHash,
        observacao_emissao: body.observacao ?? null,
        quantidade:      1,
        auth_mode:       "manual",
        issued_at:       new Date().toISOString(),
      })
      .select()
      .single();

    if (sErr || !saida) return c.json({ error: sErr?.message ?? "Erro ao criar saída" }, 500);

    // Atualizar status do item
    const { error: miErr } = await supabase
      .from("material_items")
      .update({
        status_operacional:     "em_saida",
        current_holder_user_id: body.militar_id,
        active_lending_id:      saida.id,
        last_movement_at:       new Date().toISOString(),
      })
      .eq("id", body.item_id);

    if (miErr) {
      await supabase.from("lendings").delete().eq("id", saida.id);
      return c.json({ error: miErr.message }, miErr.code === "P0001" ? 409 : 500);
    }

    auditLog(c, {
      action: "saida.created", resource_type: "saida", resource_id: saida.id,
      after_snapshot: { item_id: body.item_id, militar_id: body.militar_id },
    });

    return c.json({ lending: saida }, 201);
  }
);

// ─── POST /api/saidas/:id/sign-armeiro ───────────────────────────────────────

saidasRoutes.post(
  "/:id/sign-armeiro",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", signBodySchema),
  async (c) => {
    const id        = c.req.param("id");
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;

    const { data: saida } = await supabase
      .from("lendings")
      .select("id, status, document_hash, armeiro_signature_id, tenant_id")
      .eq("id", id)
      .not("item_id", "is", null)
      .single();

    if (!saida) return c.json({ error: "Saída não encontrada" }, 404);
    if (tenantId && saida.tenant_id !== tenantId) return c.json({ error: "Saída não encontrada" }, 404);
    if (saida.armeiro_signature_id) return c.json({ error: "Armeiro já assinou" }, 422);

    let authMethod: "totp" | "biometric" = "totp";
    if (body.use_biometric) {
      const r = await validateBiometric(armeiroId);
      if (!r.ok) return c.json({ error: r.error }, (r.status ?? 400) as 400 | 401 | 404 | 503);
      authMethod = "biometric";
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
        biometric_verified: authMethod === "biometric",
      })
      .select("id").single();

    if (sigErr || !sig) {
      console.error("[sign-armeiro] doc_sig insert error:", sigErr?.message, "| code:", sigErr?.code, "| tenantId:", tenantId);
      return c.json({ error: sigErr?.message ?? "Erro ao criar assinatura" }, 500);
    }

    await supabase.from("lendings").update({
      armeiro_signature_id: sig.id,
      status: "aguardando_confirmacao",
    }).eq("id", id);

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

    let authMethod: "totp" | "biometric" = "totp";
    if (body.use_biometric) {
      const r = await validateBiometric(militarId);
      if (!r.ok) return c.json({ error: r.error }, (r.status ?? 400) as 400 | 401 | 404 | 503);
      authMethod = "biometric";
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
        biometric_verified: authMethod === "biometric",
      })
      .select("id").single();

    if (sigErr || !sig) {
      console.error("[confirm] doc_sig insert error:", sigErr?.message, "| code:", sigErr?.code);
      return c.json({ error: sigErr?.message ?? "Erro ao criar assinatura" }, 500);
    }

    await supabase.from("lendings").update({
      militar_signature_id: sig.id,
      status: "ativa",
    }).eq("id", id);

    auditLog(c, { action: "signature.created", resource_type: "saida", resource_id: id,
      metadata: { signer_role: "militar", auth_method: authMethod } });

    return c.json({ ok: true, signature_id: sig.id });
  }
);

// ─── PATCH /api/saidas/:id/return ────────────────────────────────────────────

saidasRoutes.patch(
  "/:id/return",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", z.object({
    observacao: z.string().optional(),
    condicao_devolucao: z.enum(["bom","regular","ruim","inapto"]).optional(),
  })),
  async (c) => {
    const id      = c.req.param("id");
    const body    = c.req.valid("json");
    const tenantId = c.get("tenantId");

    let q = supabase
      .from("lendings")
      .select("id, status, status_legacy, item_id, tenant_id")
      .eq("id", id)
      .not("item_id", "is", null);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data: saida } = await q.single();

    if (!saida) return c.json({ error: "Saída não encontrada" }, 404);

    await supabase.from("lendings").update({
      status: "devolvida",
      status_legacy: "devolvido",
      returned_at: new Date().toISOString(),
      observacao_devolucao: body.observacao ?? null,
    }).eq("id", id);

    if (saida.item_id) {
      const novoStatus = body.condicao_devolucao === "inapto" ? "inapto" : "disponivel";
      await supabase.from("material_items").update({
        status_operacional: novoStatus,
        current_holder_user_id: null,
        active_lending_id: null,
        last_movement_at: new Date().toISOString(),
      }).eq("id", saida.item_id);
    }

    auditLog(c, { action: "saida.returned", resource_type: "saida", resource_id: id });
    return c.json({ ok: true });
  }
);
