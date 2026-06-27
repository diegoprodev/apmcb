import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHash } from "crypto";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";
import { generateInventoryPdf } from "../lib/pdf/inventory-pdf";
import { checkTotpGuard } from "../lib/totp-guard";

export const inventoryRoutes = new Hono<{ Variables: HonoVariables }>();

// ─── POST /api/inventory/campaigns ──────────────────────────────────────────
// admin_global pode targetar qualquer reserve do tenant.
// admin_reserva só pode targetar sua própria reserve.
inventoryRoutes.post(
  "/campaigns",
  roleGuard("admin_global", "admin_reserva"),
  zValidator("json", z.object({
    nome:         z.string().min(3).max(120),
    descricao:    z.string().max(500).optional(),
    reserve_ids:  z.array(z.string().uuid()).optional(), // null = todas
    prazo_inicio: z.string().datetime().optional(),
    prazo_fim:    z.string().datetime(),
  })),
  async (c) => {
    const tenantId  = c.get("tenantId");
    const userId    = c.get("userId");
    const role      = c.get("role");
    const reserveId = c.get("reserveId");
    const body      = c.req.valid("json");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    let targetReserveIds = body.reserve_ids ?? null;

    // admin_reserva só pode criar para a própria reserve
    if (role === "admin_reserva") {
      if (!reserveId) return c.json({ error: "Sessão sem reserve" }, 401);
      if (targetReserveIds && (targetReserveIds.length > 1 || targetReserveIds[0] !== reserveId)) {
        return c.json({ error: "admin_reserva só pode criar campanha para sua própria reserva" }, 403);
      }
      targetReserveIds = [reserveId];
    }

    // Validar que as reserves pertencem ao tenant
    if (targetReserveIds) {
      const { data: reserves } = await supabase
        .from("reserves").select("id").in("id", targetReserveIds).eq("tenant_id", tenantId);
      if ((reserves?.length ?? 0) !== targetReserveIds.length) {
        return c.json({ error: "Uma ou mais reserves não pertencem ao seu tenant" }, 400);
      }
    }

    const { data, error } = await supabase.from("inventory_campaigns").insert({
      tenant_id:    tenantId,
      nome:         body.nome,
      descricao:    body.descricao ?? null,
      reserve_ids:  targetReserveIds,
      prazo_inicio: body.prazo_inicio ?? null,
      prazo_fim:    body.prazo_fim,
      criado_por:   userId,
      status:       "planejado",
    }).select().single();

    if (error) return c.json({ error: error.message }, 500);

    auditLog(c, { action: "campaign.created", resource_type: "inventory_campaign", resource_id: data.id,
      after_snapshot: { nome: data.nome, status: data.status } });

    return c.json({ campaign: data }, 201);
  }
);

// ─── GET /api/inventory/campaigns ────────────────────────────────────────────
inventoryRoutes.get(
  "/campaigns",
  roleGuard("admin_global", "admin_reserva", "auditor"),
  async (c) => {
    const tenantId  = c.get("tenantId");
    const role      = c.get("role");
    const reserveId = c.get("reserveId");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    let query = supabase.from("inventory_campaigns")
      .select("id, nome, descricao, reserve_ids, prazo_inicio, prazo_fim, status, criado_por, created_at, document_hash")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    // admin_reserva só vê campanhas que incluem sua reserve
    if (role === "admin_reserva") {
      if (!reserveId) return c.json({ campaigns: [] });
      query = query.or(`reserve_ids.cs.{${reserveId}},reserve_ids.is.null`);
    }

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ campaigns: data ?? [] });
  }
);

// ─── GET /api/inventory/campaigns/:id ────────────────────────────────────────
inventoryRoutes.get(
  "/campaigns/:id",
  roleGuard("admin_global", "admin_reserva", "auditor"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");
    const role     = c.get("role");
    const reserveId = c.get("reserveId");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    const { data: campaign, error } = await supabase.from("inventory_campaigns")
      .select("*").eq("id", id).eq("tenant_id", tenantId).single();
    if (error || !campaign) return c.json({ error: "Campanha não encontrada" }, 404);

    // admin_reserva: deve incluir sua reserve
    if (role === "admin_reserva" && reserveId) {
      const ids: string[] | null = campaign.reserve_ids;
      if (ids !== null && !ids.includes(reserveId)) {
        return c.json({ error: "Sem acesso a esta campanha" }, 403);
      }
    }

    // Buscar reserve_checks com itens
    const { data: checks } = await supabase.from("inventory_reserve_checks")
      .select("*, items:inventory_item_checks(*)")
      .eq("campaign_id", id);

    return c.json({ campaign, reserve_checks: checks ?? [] });
  }
);

// ─── POST /api/inventory/campaigns/:id/start ─────────────────────────────────
// Cria inventory_reserve_checks + inventory_item_checks (carga esperada)
inventoryRoutes.post(
  "/campaigns/:id/start",
  roleGuard("admin_global", "admin_reserva"),
  async (c) => {
    const id        = c.req.param("id");
    const tenantId  = c.get("tenantId");
    const userId    = c.get("userId");
    const role      = c.get("role");
    const reserveId = c.get("reserveId");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    const { data: campaign, error: ce } = await supabase.from("inventory_campaigns")
      .select("*").eq("id", id).eq("tenant_id", tenantId).single();
    if (ce || !campaign) return c.json({ error: "Campanha não encontrada" }, 404);
    if (campaign.status !== "planejado") return c.json({ error: "Campanha já iniciada ou encerrada" }, 422);

    // admin_reserva só pode iniciar se a campanha incluir sua reserve
    if (role === "admin_reserva" && reserveId) {
      const ids: string[] | null = campaign.reserve_ids;
      if (ids !== null && !ids.includes(reserveId)) {
        return c.json({ error: "Sem permissão para iniciar esta campanha" }, 403);
      }
    }

    // Determinar quais reserves participam
    let targetReserveIds: string[] = campaign.reserve_ids ?? [];
    if (targetReserveIds.length === 0) {
      const { data: allReserves } = await supabase.from("reserves")
        .select("id").eq("tenant_id", tenantId).eq("status", "active");
      targetReserveIds = (allReserves ?? []).map((r) => r.id);
    }

    if (targetReserveIds.length === 0) return c.json({ error: "Nenhuma reserve encontrada para inventário" }, 422);

    // Criar reserve_checks
    const rcInserts = targetReserveIds.map((rid) => ({
      tenant_id:     tenantId,
      campaign_id:   id,
      reserve_id:    rid,
      responsavel_id: null,
      armeiro_id:    null,
      status:        "pendente",
    }));

    const { data: createdChecks, error: rce } = await supabase
      .from("inventory_reserve_checks").insert(rcInserts).select();
    if (rce) return c.json({ error: rce.message }, 500);

    // Para cada reserve_check, criar item_checks com qtd_esperada
    let totalItems = 0;
    for (const rc of createdChecks ?? []) {
      const { data: mats } = await supabase.from("material_types")
        .select("id, quantidade").eq("reserve_id", rc.reserve_id).eq("tenant_id", tenantId);

      if (!mats || mats.length === 0) continue;

      const itemInserts = mats.map((m) => ({
        tenant_id:       tenantId,
        reserve_check_id: rc.id,
        material_type_id: m.id,
        qtd_esperada:    m.quantidade ?? 0,
        status:          "pendente",
      }));

      await supabase.from("inventory_item_checks").insert(itemInserts);
      totalItems += itemInserts.length;
    }

    // Atualizar status da campanha
    await supabase.from("inventory_campaigns")
      .update({ status: "em_andamento" }).eq("id", id);

    auditLog(c, { action: "campaign.started", resource_type: "inventory_campaign", resource_id: id,
      after_snapshot: { status: "em_andamento", reserves: targetReserveIds.length, items: totalItems } });

    return c.json({ ok: true, reserve_checks: createdChecks?.length ?? 0, items_created: totalItems });
  }
);

// ─── PATCH /api/inventory/reserve-checks/:id/assign ──────────────────────────
// admin_reserva atribui armeiro à sua reserve_check
inventoryRoutes.patch(
  "/reserve-checks/:id/assign",
  roleGuard("admin_global", "admin_reserva"),
  zValidator("json", z.object({
    armeiro_id:    z.string().uuid(),
    responsavel_id: z.string().uuid().optional(),
  })),
  async (c) => {
    const id        = c.req.param("id");
    const tenantId  = c.get("tenantId");
    const role      = c.get("role");
    const reserveId = c.get("reserveId");
    const userId    = c.get("userId");
    const body      = c.req.valid("json");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    const { data: rc, error } = await supabase.from("inventory_reserve_checks")
      .select("*").eq("id", id).eq("tenant_id", tenantId).single();
    if (error || !rc) return c.json({ error: "Conferência não encontrada" }, 404);

    // admin_reserva só pode atribuir para a sua reserve
    if (role === "admin_reserva" && reserveId && rc.reserve_id !== reserveId) {
      return c.json({ error: "Sem permissão para esta reserve" }, 403);
    }

    // Validar que o armeiro pertence à reserve
    const { data: armeiroProfile } = await supabase.from("reserve_memberships")
      .select("user_id").eq("user_id", body.armeiro_id).eq("reserve_id", rc.reserve_id).maybeSingle();
    if (!armeiroProfile) return c.json({ error: "Armeiro não pertence a esta reserva" }, 400);

    const { data: updated, error: ue } = await supabase.from("inventory_reserve_checks")
      .update({
        armeiro_id:    body.armeiro_id,
        responsavel_id: body.responsavel_id ?? userId,
        status:        "em_andamento",
      })
      .eq("id", id).select().single();
    if (ue) return c.json({ error: ue.message }, 500);

    return c.json({ reserve_check: updated });
  }
);

// ─── GET /api/inventory/reserve-checks/:id ───────────────────────────────────
inventoryRoutes.get(
  "/reserve-checks/:id",
  roleGuard("admin_global", "admin_reserva", "armeiro", "auditor"),
  async (c) => {
    const id        = c.req.param("id");
    const tenantId  = c.get("tenantId");
    const role      = c.get("role");
    const reserveId = c.get("reserveId");
    const userId    = c.get("userId");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    const { data: rc, error } = await supabase.from("inventory_reserve_checks")
      .select("*, items:inventory_item_checks(*, material:material_types(nome,tipo))")
      .eq("id", id).eq("tenant_id", tenantId).single();
    if (error || !rc) return c.json({ error: "Conferência não encontrada" }, 404);

    // armeiro só pode ver se foi atribuído
    if (role === "armeiro" && rc.armeiro_id !== userId) {
      return c.json({ error: "Você não está designado para esta conferência" }, 403);
    }

    // admin_reserva só vê sua reserve
    if (role === "admin_reserva" && reserveId && rc.reserve_id !== reserveId) {
      return c.json({ error: "Sem acesso a esta reserve" }, 403);
    }

    return c.json({ reserve_check: rc });
  }
);

// ─── POST /api/inventory/reserve-checks/:id/items/:iid/check ─────────────────
// Armeiro ou admin_reserva confere item (registra qtd_contada)
inventoryRoutes.post(
  "/reserve-checks/:id/items/:iid/check",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", z.object({
    qtd_contada:     z.number().int().min(0),
    divergencia_desc: z.string().max(500).optional(),
  })),
  async (c) => {
    const rcId     = c.req.param("id");
    const itemId   = c.req.param("iid");
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const reserveId = c.get("reserveId");
    const body     = c.req.valid("json");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    // Verificar reserve_check
    const { data: rc, error: rce } = await supabase.from("inventory_reserve_checks")
      .select("armeiro_id, reserve_id, status").eq("id", rcId).eq("tenant_id", tenantId).single();
    if (rce || !rc) return c.json({ error: "Conferência não encontrada" }, 404);
    if (rc.status === "concluido") return c.json({ error: "Conferência já encerrada" }, 422);

    // armeiro só pode conferir se foi atribuído
    if (role === "armeiro" && rc.armeiro_id !== userId) {
      return c.json({ error: "Você não está designado para esta conferência" }, 403);
    }
    // admin_reserva só pode conferir sua reserve
    if (role === "admin_reserva" && reserveId && rc.reserve_id !== reserveId) {
      return c.json({ error: "Sem acesso a esta reserve" }, 403);
    }

    // Verificar item
    const { data: item, error: ie } = await supabase.from("inventory_item_checks")
      .select("qtd_esperada, status").eq("id", itemId).eq("reserve_check_id", rcId).single();
    if (ie || !item) return c.json({ error: "Item não encontrado" }, 404);

    const isDivergente = body.qtd_contada !== item.qtd_esperada;
    // Divergência exige justificativa
    if (isDivergente && !body.divergencia_desc) {
      return c.json({ error: "divergencia_desc obrigatório quando quantidade diverge do esperado" }, 422);
    }

    const newStatus = isDivergente ? "divergencia" : "conforme";
    const { data: updated, error: ue } = await supabase.from("inventory_item_checks")
      .update({
        qtd_contada:     body.qtd_contada,
        divergencia_desc: body.divergencia_desc ?? null,
        status:           newStatus,
        conferido_por:   userId,
        conferido_at:    new Date().toISOString(),
      }).eq("id", itemId).select().single();
    if (ue) return c.json({ error: ue.message }, 500);

    // Atualizar status do reserve_check se tiver divergência
    if (isDivergente) {
      await supabase.from("inventory_reserve_checks")
        .update({ status: "divergencia" }).eq("id", rcId);
    }

    return c.json({ item: updated });
  }
);

// ─── POST /api/inventory/reserve-checks/:id/sign ─────────────────────────────
// admin_reserva assina a conferência (valida TOTP + cria document_signature)
inventoryRoutes.post(
  "/reserve-checks/:id/sign",
  roleGuard("admin_reserva", "admin_global"),
  zValidator("json", z.object({
    totp_code: z.string().length(6),
    observacao: z.string().max(500).optional(),
  })),
  async (c) => {
    const id        = c.req.param("id");
    const tenantId  = c.get("tenantId");
    const userId    = c.get("userId");
    const role      = c.get("role");
    const reserveId = c.get("reserveId");
    const body      = c.req.valid("json");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    const { data: rc, error } = await supabase.from("inventory_reserve_checks")
      .select("*").eq("id", id).eq("tenant_id", tenantId).single();
    if (error || !rc) return c.json({ error: "Conferência não encontrada" }, 404);
    if (rc.signature_id) return c.json({ error: "Conferência já assinada" }, 422);
    if (role === "admin_reserva" && reserveId && rc.reserve_id !== reserveId) {
      return c.json({ error: "Sem acesso a esta reserve" }, 403);
    }

    // Validar todos os itens foram conferidos
    const { count: pendentes } = await supabase.from("inventory_item_checks")
      .select("id", { count: "exact", head: true })
      .eq("reserve_check_id", id).eq("status", "pendente");
    if ((pendentes ?? 0) > 0) {
      return c.json({ error: `${pendentes} item(s) ainda não conferidos. Conclua todos antes de assinar.` }, 422);
    }

    // Validar TOTP
    const { data: totpRow } = await supabase.from("totp_secrets")
      .select("secret, failure_count, last_failure_at, last_used_token")
      .eq("user_id", userId).maybeSingle();
    if (!totpRow) return c.json({ error: "TOTP não configurado" }, 400);

    const totpResult = checkTotpGuard(totpRow, body.totp_code);
    if (!totpResult.ok) return c.json({ error: totpResult.error }, totpResult.status);

    // Anti-replay: atualizar last_used_token
    await supabase.from("totp_secrets").update({ last_used_token: body.totp_code, failure_count: 0 }).eq("user_id", userId);

    // Conteúdo do documento
    const { data: items } = await supabase.from("inventory_item_checks")
      .select("material_type_id, qtd_esperada, qtd_contada, status").eq("reserve_check_id", id);

    const docContent = JSON.stringify({ reserve_check_id: id, items, signed_by: userId, signed_at: new Date().toISOString() });
    const docHash = createHash("sha256").update(docContent).digest("hex");

    // Criar document_signature
    const { data: sig, error: se } = await supabase.from("document_signatures").insert({
      user_id:       userId,
      tenant_id:     tenantId,
      document_type: "inventory_reserve_check",
      document_id:   id,
      document_hash: docHash,
      content_json:  docContent,
      totp_verified: true,
    }).select().single();
    if (se) return c.json({ error: se.message }, 500);

    // Determinar status final
    const { count: divs } = await supabase.from("inventory_item_checks")
      .select("id", { count: "exact", head: true })
      .eq("reserve_check_id", id).eq("status", "divergencia");
    const finalStatus = (divs ?? 0) > 0 ? "divergencia" : "concluido";

    await supabase.from("inventory_reserve_checks").update({
      signature_id: sig.id,
      status:       finalStatus,
      observacao:   body.observacao ?? rc.observacao,
      responsavel_id: userId,
      concluido_at:  new Date().toISOString(),
    }).eq("id", id);

    auditLog(c, { action: "reserve_check.signed", resource_type: "inventory_reserve_check", resource_id: id,
      after_snapshot: { status: finalStatus, signature_id: sig.id } });

    return c.json({ ok: true, signature_id: sig.id, status: finalStatus });
  }
);

// ─── POST /api/inventory/campaigns/:id/close ─────────────────────────────────
// admin_global fecha campanha e gera PDF
inventoryRoutes.post(
  "/campaigns/:id/close",
  roleGuard("admin_global"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    const { data: campaign, error: ce } = await supabase.from("inventory_campaigns")
      .select("*").eq("id", id).eq("tenant_id", tenantId).single();
    if (ce || !campaign) return c.json({ error: "Campanha não encontrada" }, 404);
    if (campaign.status !== "em_andamento") return c.json({ error: "Campanha não está em andamento" }, 422);

    // Verificar que todas as reserve_checks estão assinadas
    const { count: naoAssinadas } = await supabase.from("inventory_reserve_checks")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", id).is("signature_id", null);
    if ((naoAssinadas ?? 0) > 0) {
      return c.json({ error: `${naoAssinadas} reserva(s) ainda sem assinatura. Todas devem assinar antes do fechamento.` }, 422);
    }

    // Montar dados para PDF
    const { data: tenant } = await supabase.from("tenants").select("nome").eq("id", tenantId).single();
    const { data: criador } = await supabase.from("profiles").select("nome_completo").eq("id", campaign.criado_por).single();
    const { data: checks } = await supabase.from("inventory_reserve_checks")
      .select("*, reserve:reserves(nome,acronym), responsavel:profiles!responsavel_id(nome_completo), armeiro:profiles!armeiro_id(nome_completo), items:inventory_item_checks(*, material:material_types(nome))")
      .eq("campaign_id", id);

    const docHash = createHash("sha256")
      .update(JSON.stringify({ campaign_id: id, closed_by: userId, closed_at: new Date().toISOString(), checks }))
      .digest("hex");

    const pdfData = {
      id: campaign.id,
      nome: campaign.nome,
      descricao: campaign.descricao ?? undefined,
      tenant_nome: tenant?.nome ?? tenantId,
      prazo_inicio: campaign.prazo_inicio ?? undefined,
      prazo_fim: campaign.prazo_fim,
      criado_por_nome: criador?.nome_completo ?? "—",
      document_hash: docHash,
      created_at: campaign.created_at,
      reserve_checks: (checks ?? []).map((rc) => ({
        reserve_nome:     (rc.reserve as { nome: string; acronym: string } | null)?.nome ?? "—",
        reserve_acronym:  (rc.reserve as { nome: string; acronym: string } | null)?.acronym ?? "—",
        responsavel_nome: (rc.responsavel as { nome_completo: string } | null)?.nome_completo ?? "—",
        armeiro_nome:     (rc.armeiro as { nome_completo: string } | null)?.nome_completo ?? undefined,
        status:           rc.status,
        observacao:       rc.observacao ?? undefined,
        concluido_at:     rc.concluido_at ?? undefined,
        items: ((rc.items as Array<{
          material: { nome: string } | null;
          qtd_esperada: number;
          qtd_contada: number | null;
          status: string;
          divergencia_desc?: string;
        }>) ?? []).map((i) => ({
          material_nome:    i.material?.nome ?? "—",
          qtd_esperada:     i.qtd_esperada,
          qtd_contada:      i.qtd_contada,
          status:           i.status,
          divergencia_desc: i.divergencia_desc,
        })),
      })),
    };

    const pdfBytes = await generateInventoryPdf(pdfData);
    const pdfBuffer = Buffer.from(pdfBytes.buffer as ArrayBuffer);

    // Upload para Storage
    const path = `${tenantId}/campaigns/${id}/relatorio-inventario.pdf`;
    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const uploadRes = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/inventory-reports/${path}`, {
      method: "POST",
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
        "Content-Type": "application/pdf",
        "x-upsert": "true",
      },
      body: pdfBuffer,
    });

    let pdfPath: string | null = null;
    if (uploadRes.ok) {
      pdfPath = path;
    }

    await supabase.from("inventory_campaigns").update({
      status:           "concluido",
      document_hash:    docHash,
      pdf_storage_path: pdfPath,
    }).eq("id", id);

    auditLog(c, { action: "campaign.closed", resource_type: "inventory_campaign", resource_id: id,
      after_snapshot: { status: "concluido", document_hash: docHash, pdf_path: pdfPath } });

    return c.json({ ok: true, document_hash: docHash, pdf_path: pdfPath });
  }
);

// ─── GET /api/inventory/campaigns/:id/pdf ────────────────────────────────────
inventoryRoutes.get(
  "/campaigns/:id/pdf",
  roleGuard("admin_global", "admin_reserva", "auditor"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");

    if (!tenantId) return c.json({ error: "Sessão sem tenant" }, 401);

    const { data: campaign, error } = await supabase.from("inventory_campaigns")
      .select("pdf_storage_path, document_hash, status").eq("id", id).eq("tenant_id", tenantId).single();
    if (error || !campaign) return c.json({ error: "Campanha não encontrada" }, 404);
    if (!campaign.pdf_storage_path) return c.json({ error: "PDF ainda não gerado" }, 404);

    const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const pdfRes = await fetch(
      `${process.env.SUPABASE_URL}/storage/v1/object/inventory-reports/${campaign.pdf_storage_path}`,
      { headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` } }
    );
    if (!pdfRes.ok) return c.json({ error: "PDF não encontrado no storage" }, 404);

    const buf = await pdfRes.arrayBuffer();
    return new Response(buf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="inventario-${id.slice(0, 8)}.pdf"`,
        "X-Document-Hash": campaign.document_hash ?? "",
      },
    });
  }
);

// ─── GET /api/inventory/verify/:id ───────────────────────────────────────────
// Verificação pública de hash (sem auth)
inventoryRoutes.get("/verify/:id", async (c) => {
  const id   = c.req.param("id");
  const hash = c.req.query("hash");

  const { data } = await supabase.from("inventory_campaigns")
    .select("id, nome, status, document_hash, created_at").eq("id", id).single();

  if (!data) return c.json({ valid: false, reason: "Campanha não encontrada" }, 404);
  if (!hash || data.document_hash !== hash) return c.json({ valid: false, reason: "Hash inválido ou adulterado" }, 400);

  return c.json({ valid: true, campaign: { id: data.id, nome: data.nome, status: data.status, created_at: data.created_at } });
});
