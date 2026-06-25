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

export const cautelamentosRoutes = new Hono<{ Variables: HonoVariables }>();

const createSchema = z.object({
  item_id:         z.string().uuid(),
  militar_id:      z.string().uuid(),
  reserve_id:      z.string().uuid(),
  motivo_emissao:  z.string().min(3).max(500),
  condicao_emissao: z.enum(["novo","bom","regular","ruim"]).default("bom"),
  prazo_proxima_conferencia: z.string().optional(),
});

const returnSchema = z.object({
  condicao_devolucao: z.enum(["bom","regular","ruim","inapto"]),
  motivo_devolucao:   z.string().optional(),
});

const substituteSchema = z.object({
  novo_item_id:       z.string().uuid(),
  condicao_devolucao: z.enum(["bom","regular","ruim","inapto"]),
  motivo_emissao:     z.string().min(3).max(500),
  condicao_emissao:   z.enum(["novo","bom","regular","ruim"]).default("bom"),
});

function makeDocHash(fields: Record<string, unknown>): string {
  return hashDocument({
    document_type: "cautelamento",
    document_id:   (fields.id as string | undefined) ?? "new",
    data:          fields,
  });
}

async function validateTotp(
  userId: string,
  token: string
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const { data: row, error } = await supabase
    .from("totp_secrets")
    .select("id, secret, failure_count, last_failure_at, last_used_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !row) return { ok: false, error: "TOTP não configurado", status: 404 };

  const RATE_MAX    = 5;
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
      return { ok: false, error: "Biometria não reconhecida ou não corresponde ao signatário esperado", status: 401 };
    }

    return { ok: true };
  } catch {
    return { ok: false, error: "Erro no hardware biométrico — tente TOTP", status: 503 };
  }
}

// Schema de assinatura: aceita TOTP ou biometria (nunca nenhum)
const signBodySchema = z
  .object({
    totp_token:   z.string().length(6).regex(/^\d{6}$/).optional(),
    use_biometric: z.boolean().optional(),
  })
  .refine((d) => d.totp_token || d.use_biometric, {
    message: "Informe totp_token ou use_biometric: true",
  });

// GET /api/cautelamentos — listar cautelas
cautelamentosRoutes.get(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin", "auditor"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const { status, militar_id } = c.req.query();

    let query = supabase
      .from("cautelamentos")
      .select(`
        *,
        item:material_items(id, numero_serie, status_operacional, material_type:material_types(nome, categoria)),
        militar:profiles!cautelamentos_militar_id_fkey(id, nome_completo, matricula, posto),
        armeiro:profiles!cautelamentos_armeiro_id_fkey(id, nome_completo, matricula)
      `)
      .order("created_at", { ascending: false });

    if (tenantId)   query = query.eq("tenant_id", tenantId);
    if (status)     query = query.eq("status", status);
    if (militar_id) query = query.eq("militar_id", militar_id);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ cautelamentos: data ?? [] });
  }
);

// GET /api/cautelamentos/ativos — cautelas ativas do próprio usuário
cautelamentosRoutes.get(
  "/ativos",
  roleGuard("usuario", "armeiro", "admin_reserva"),
  async (c) => {
    const userId   = c.get("userId")!;
    const tenantId = c.get("tenantId");

    let query = supabase
      .from("cautelamentos")
      .select(`
        *,
        item:material_items(id, numero_serie, status_operacional, material_type:material_types(nome, categoria)),
        armeiro:profiles!cautelamentos_armeiro_id_fkey(nome_completo, matricula)
      `)
      .eq("militar_id", userId)
      .eq("status", "ativa");

    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ cautelamentos: data ?? [] });
  }
);

// GET /api/cautelamentos/history/item/:material_id
cautelamentosRoutes.get(
  "/history/item/:material_id",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin", "auditor"),
  async (c) => {
    const materialId = c.req.param("material_id");
    const tenantId   = c.get("tenantId");

    let query = supabase
      .from("cautelamentos")
      .select(`*, militar:profiles!cautelamentos_militar_id_fkey(nome_completo, matricula, posto)`)
      .eq("item_id", materialId)
      .order("data_emissao", { ascending: false });

    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ history: data ?? [] });
  }
);

// GET /api/cautelamentos/history/militar/:user_id
cautelamentosRoutes.get(
  "/history/militar/:user_id",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  async (c) => {
    const userId   = c.req.param("user_id");
    const tenantId = c.get("tenantId");

    let query = supabase
      .from("cautelamentos")
      .select(`*, item:material_items(numero_serie, material_type:material_types(nome, categoria))`)
      .eq("militar_id", userId)
      .order("data_emissao", { ascending: false });

    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ history: data ?? [] });
  }
);

// POST /api/cautelamentos — emitir Termo de Cautela
cautelamentosRoutes.post(
  "/",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", createSchema),
  async (c) => {
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;

    const { data: item, error: itemErr } = await supabase
      .from("material_items")
      .select("id, status_operacional, tenant_id")
      .eq("id", body.item_id)
      .single();

    if (itemErr || !item) return c.json({ error: "Item não encontrado" }, 404);
    if (tenantId && item.tenant_id !== tenantId) return c.json({ error: "Item não encontrado" }, 404);
    if (item.status_operacional !== "disponivel") {
      return c.json({ error: `Item não disponível: ${item.status_operacional}` }, 409);
    }

    const docHash = makeDocHash({
      item_id: body.item_id, militar_id: body.militar_id, armeiro_id: armeiroId,
      motivo_emissao: body.motivo_emissao, data_emissao: new Date().toISOString(),
    });

    const { data: cautela, error: cErr } = await supabase
      .from("cautelamentos")
      .insert({
        tenant_id:                 tenantId,
        reserve_id:                body.reserve_id,
        item_id:                   body.item_id,
        militar_id:                body.militar_id,
        armeiro_id:                armeiroId,
        motivo_emissao:            body.motivo_emissao,
        condicao_emissao:          body.condicao_emissao,
        prazo_proxima_conferencia: body.prazo_proxima_conferencia ?? null,
        document_hash:             docHash,
      })
      .select()
      .single();

    if (cErr || !cautela) return c.json({ error: cErr?.message ?? "Erro ao criar cautela" }, 500);

    const { error: miErr } = await supabase
      .from("material_items")
      .update({
        status_operacional:     "cautelado",
        current_holder_user_id: body.militar_id,
        active_cautelamento_id: cautela.id,
        last_movement_at:       new Date().toISOString(),
      })
      .eq("id", body.item_id);

    if (miErr) {
      await supabase.from("cautelamentos").delete().eq("id", cautela.id);
      return c.json({ error: miErr.message }, miErr.code === "P0001" ? 409 : 500);
    }

    auditLog(c, {
      action: "cautelamento.created", resource_type: "cautelamento", resource_id: cautela.id,
      after_snapshot: { item_id: body.item_id, militar_id: body.militar_id },
    });

    return c.json({ cautelamento: cautela }, 201);
  }
);

// POST /api/cautelamentos/:id/sign-armeiro
cautelamentosRoutes.post(
  "/:id/sign-armeiro",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", signBodySchema),
  async (c) => {
    const id        = c.req.param("id");
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;

    const { data: cautela } = await supabase
      .from("cautelamentos")
      .select("id, status, document_hash, armeiro_signature_id, tenant_id")
      .eq("id", id)
      .single();

    if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
    if (tenantId && cautela.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
    if (cautela.status !== "ativa") return c.json({ error: "Cautela não está ativa" }, 422);
    if (cautela.armeiro_signature_id) return c.json({ error: "Armeiro já assinou" }, 422);

    let authVerified = false;
    let authMethod: "totp" | "biometric" = "totp";

    if (body.use_biometric) {
      const bioResult = await validateBiometric(armeiroId);
      if (!bioResult.ok) return c.json({ error: bioResult.error }, (bioResult.status ?? 400) as 400 | 401 | 404 | 503);
      authVerified = true;
      authMethod = "biometric";
    } else {
      const totpResult = await validateTotp(armeiroId, body.totp_token!);
      if (!totpResult.ok) return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);
      authVerified = true;
    }

    if (!authVerified) return c.json({ error: "Falha na verificação" }, 400);

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
    const { data: sig } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id: tenantId, document_id: cautela.id, document_type: "cautelamento",
        signer_id: armeiroId, signer_role: "armeiro", signed_at: new Date().toISOString(),
        document_hash: cautela.document_hash,
        signature_proof: `${cautela.document_hash}:${armeiroId}:armeiro`,
        ip,
        totp_verified: authMethod === "totp",
        biometric_verified: authMethod === "biometric",
      })
      .select("id")
      .single();

    if (!sig) return c.json({ error: "Erro ao criar assinatura" }, 500);

    await supabase.from("cautelamentos").update({ armeiro_signature_id: sig.id }).eq("id", id);
    auditLog(c, { action: "signature.created", resource_type: "cautelamento", resource_id: id,
      metadata: { signer_role: "armeiro", auth_method: authMethod } });

    return c.json({ ok: true, signature_id: sig.id, auth_method: authMethod });
  }
);

// POST /api/cautelamentos/:id/sign-militar
cautelamentosRoutes.post(
  "/:id/sign-militar",
  roleGuard("usuario", "armeiro", "admin_reserva"),
  zValidator("json", signBodySchema),
  async (c) => {
    const id        = c.req.param("id");
    const body      = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const militarId = c.get("userId")!;

    const { data: cautela } = await supabase
      .from("cautelamentos")
      .select("id, status, militar_id, document_hash, armeiro_signature_id, militar_signature_id, tenant_id")
      .eq("id", id)
      .single();

    if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
    if (tenantId && cautela.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
    if (cautela.militar_id !== militarId) return c.json({ error: "Apenas o militar responsável pode assinar" }, 403);
    if (cautela.status !== "ativa") return c.json({ error: "Cautela não está ativa" }, 422);
    if (!cautela.armeiro_signature_id) return c.json({ error: "Armeiro ainda não assinou" }, 422);
    if (cautela.militar_signature_id) return c.json({ error: "Militar já assinou" }, 422);

    let authMethod: "totp" | "biometric" = "totp";

    if (body.use_biometric) {
      // Biometria: captura o dedo do militar no leitor e valida identidade
      const bioResult = await validateBiometric(militarId);
      if (!bioResult.ok) return c.json({ error: bioResult.error }, (bioResult.status ?? 400) as 400 | 401 | 404 | 503);
      authMethod = "biometric";
    } else {
      const totpResult = await validateTotp(militarId, body.totp_token!);
      if (!totpResult.ok) return c.json({ error: totpResult.error }, (totpResult.status ?? 400) as 400 | 404 | 429);
    }

    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "127.0.0.1";
    const { data: sig } = await supabase
      .from("document_signatures")
      .insert({
        tenant_id: tenantId, document_id: cautela.id, document_type: "cautelamento",
        signer_id: militarId, signer_role: "militar", signed_at: new Date().toISOString(),
        document_hash: cautela.document_hash,
        signature_proof: `${cautela.document_hash}:${militarId}:militar`,
        ip,
        totp_verified: authMethod === "totp",
        biometric_verified: authMethod === "biometric",
      })
      .select("id")
      .single();

    if (!sig) return c.json({ error: "Erro ao criar assinatura" }, 500);

    await supabase.from("cautelamentos").update({ militar_signature_id: sig.id }).eq("id", id);
    auditLog(c, { action: "signature.created", resource_type: "cautelamento", resource_id: id,
      metadata: { signer_role: "militar", auth_method: authMethod } });

    return c.json({ ok: true, signature_id: sig.id, auth_method: authMethod });
  }
);

// POST /api/cautelamentos/:id/return
cautelamentosRoutes.post(
  "/:id/return",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", returnSchema),
  async (c) => {
    const id   = c.req.param("id");
    const body = c.req.valid("json");
    const tenantId = c.get("tenantId");

    const { data: cautela } = await supabase
      .from("cautelamentos")
      .select("id, status, item_id, tenant_id")
      .eq("id", id)
      .single();

    if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
    if (tenantId && cautela.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
    if (cautela.status !== "ativa") return c.json({ error: "Apenas cautelas ativas podem ser encerradas" }, 422);

    await supabase.from("cautelamentos").update({
      status: "devolvida", condicao_devolucao: body.condicao_devolucao,
      motivo_devolucao: body.motivo_devolucao ?? null, data_devolucao: new Date().toISOString(),
    }).eq("id", id);

    const novoStatus = body.condicao_devolucao === "inapto" ? "inapto" : "disponivel";
    await supabase.from("material_items").update({
      status_operacional: novoStatus, current_holder_user_id: null,
      active_cautelamento_id: null, last_movement_at: new Date().toISOString(),
    }).eq("id", cautela.item_id);

    auditLog(c, {
      action: "cautelamento.returned", resource_type: "cautelamento", resource_id: id,
      after_snapshot: { condicao: body.condicao_devolucao, novo_status_item: novoStatus },
    });

    return c.json({ ok: true });
  }
);

// POST /api/cautelamentos/:id/substitute
cautelamentosRoutes.post(
  "/:id/substitute",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin"),
  zValidator("json", substituteSchema),
  async (c) => {
    const id   = c.req.param("id");
    const body = c.req.valid("json");
    const tenantId  = c.get("tenantId");
    const armeiroId = c.get("userId")!;

    const { data: antiga } = await supabase
      .from("cautelamentos")
      .select("id, status, item_id, militar_id, reserve_id, tenant_id")
      .eq("id", id)
      .single();

    if (!antiga) return c.json({ error: "Cautela não encontrada" }, 404);
    if (tenantId && antiga.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);
    if (antiga.status !== "ativa") return c.json({ error: "Apenas cautelas ativas podem ser substituídas" }, 422);

    const { data: novoItem } = await supabase
      .from("material_items")
      .select("id, status_operacional, tenant_id")
      .eq("id", body.novo_item_id)
      .single();

    if (!novoItem) return c.json({ error: "Novo item não encontrado" }, 404);
    if (tenantId && novoItem.tenant_id !== tenantId) return c.json({ error: "Novo item não encontrado" }, 404);
    if (novoItem.status_operacional !== "disponivel") {
      return c.json({ error: `Novo item não disponível: ${novoItem.status_operacional}` }, 409);
    }

    const docHash = makeDocHash({
      item_id: body.novo_item_id, militar_id: antiga.militar_id, armeiro_id: armeiroId,
      motivo_emissao: body.motivo_emissao, data_emissao: new Date().toISOString(),
    });

    const { data: nova } = await supabase
      .from("cautelamentos")
      .insert({
        tenant_id: tenantId, reserve_id: antiga.reserve_id, item_id: body.novo_item_id,
        militar_id: antiga.militar_id, armeiro_id: armeiroId, motivo_emissao: body.motivo_emissao,
        condicao_emissao: body.condicao_emissao, document_hash: docHash, substitui: id,
      })
      .select("id")
      .single();

    if (!nova) return c.json({ error: "Erro ao criar nova cautela" }, 500);

    await supabase.from("cautelamentos").update({
      status: "substituida", condicao_devolucao: body.condicao_devolucao,
      data_substituicao: new Date().toISOString(), substituido_por: nova.id,
    }).eq("id", id);

    const statusAntigo = body.condicao_devolucao === "inapto" ? "inapto" : "disponivel";
    await supabase.from("material_items").update({
      status_operacional: statusAntigo, current_holder_user_id: null,
      active_cautelamento_id: null, last_movement_at: new Date().toISOString(),
    }).eq("id", antiga.item_id);

    const { error: miErr } = await supabase.from("material_items").update({
      status_operacional: "cautelado", current_holder_user_id: antiga.militar_id,
      active_cautelamento_id: nova.id, last_movement_at: new Date().toISOString(),
    }).eq("id", body.novo_item_id);

    if (miErr) {
      await supabase.from("cautelamentos").delete().eq("id", nova.id);
      await supabase.from("cautelamentos").update({ status: "ativa", substituido_por: null }).eq("id", id);
      return c.json({ error: "Novo item não pôde ser cautelado" }, 409);
    }

    auditLog(c, {
      action: "cautelamento.substituted", resource_type: "cautelamento", resource_id: nova.id,
      metadata: { item_antigo: antiga.item_id, item_novo: body.novo_item_id, cautela_antiga: id },
    });

    return c.json({ ok: true, nova_cautela_id: nova.id });
  }
);

// GET /api/cautelamentos/:id/pdf
cautelamentosRoutes.get(
  "/:id/pdf",
  roleGuard("armeiro", "admin_reserva", "admin_global", "superadmin", "usuario"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");

    const { data: cautela } = await supabase
      .from("cautelamentos")
      .select(`
        *,
        item:material_items(id, numero_serie, material_type:material_types(nome, categoria), validade_item, condicao),
        militar:profiles!cautelamentos_militar_id_fkey(nome_completo, matricula, posto),
        armeiro:profiles!cautelamentos_armeiro_id_fkey(nome_completo, matricula),
        reserve:reserves(nome, acronym)
      `)
      .eq("id", id)
      .single();

    if (!cautela) return c.json({ error: "Cautela não encontrada" }, 404);
    const r = cautela as Record<string, unknown>;
    if (tenantId && r.tenant_id !== tenantId) return c.json({ error: "Cautela não encontrada" }, 404);

    const { generateCautelaPdf } = await import("../lib/pdf/cautela-pdf");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBytes = await generateCautelaPdf(cautela as any);
    const buf = Buffer.from(pdfBytes);

    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="cautela-${id.slice(0, 8)}.pdf"`,
      },
    });
  }
);
