import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { validateMaterialMetadata, type NormalizedMaterialMetadata } from "../lib/material-metadata";
import { logShiftEvent } from "../lib/shift-events";
import { logger } from "../lib/logger";
import type { HonoVariables, Role } from "../types/hono";

export const arsenalRoutes = new Hono<{ Variables: HonoVariables }>();

type ApprovalType = "stock_adjustment" | "material_addition" | "material_deactivation";

function canReviewRequests(role: Role) {
  return role === "admin_reserva" || role === "admin_global";
}

async function materialBelongsToTenant(materialTypeId: string, tenantId: string) {
  const { data } = await supabase
    .from("material_types")
    .select("id")
    .eq("id", materialTypeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return !!data;
}

async function requestorBelongsToTenant(requestorId: string, tenantId: string) {
  // .limit(1) em vez de .maybeSingle(): um requestor pode ter membership em
  // mais de uma reserva do mesmo tenant, e PostgREST retorna erro (não
  // apenas null) quando .maybeSingle() casa 2+ linhas — o que negaria acesso
  // do admin_global por engano justamente para o caso mais comum (armeiro
  // ativo em múltiplas reservas do tenant).
  const { data } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, reserves!inner(tenant_id)")
    .eq("user_id", requestorId)
    .eq("reserves.tenant_id", tenantId)
    .limit(1);
  return (data ?? []).length > 0;
}

// admin_global tem escopo pelo tenant inteiro (todas as reservas), enquanto
// admin_reserva fica restrito à própria reserva — mesmo padrão usado em
// lendings.ts (assertActorReserveAccess) para não reintroduzir o bug de
// admin_global sem reserveId de sessão sendo barrado por engano.
async function requestBelongsToScope(
  requestorId: string,
  materialTypeId: string | null,
  role: Role,
  reserveId: string | null,
  tenantId: string | null
) {
  if (role === "admin_global") {
    if (!tenantId) return false;
    if (materialTypeId && (await materialBelongsToTenant(materialTypeId, tenantId))) return true;
    return requestorBelongsToTenant(requestorId, tenantId);
  }

  if (!reserveId) return false;

  const { data: requesterMembership } = await supabase
    .from("reserve_memberships")
    .select("id")
    .eq("reserve_id", reserveId)
    .eq("user_id", requestorId)
    .maybeSingle();

  if (requesterMembership) return true;
  if (!materialTypeId) return false;

  const { data: material } = await supabase
    .from("material_types")
    .select("id")
    .eq("id", materialTypeId)
    .eq("reserve_id", reserveId)
    .maybeSingle();

  return !!material;
}

// admin_reserva escopa por reserve_id, admin_global por tenant inteiro (via
// join reserve_memberships → reserves) — mesma lista de papéis elegíveis
// (armeiro, admin_reserva) nos dois casos, só muda o filtro de escopo.
async function scopedRequestorIds(scope: { reserveId: string | null } | { tenantId: string | null }) {
  const scopeValue = "reserveId" in scope ? scope.reserveId : scope.tenantId;
  if (!scopeValue) return [];

  let query = supabase
    .from("reserve_memberships")
    .select("user_id, reserves!inner(tenant_id)")
    .in("role", ["armeiro", "admin_reserva"]);
  query = "reserveId" in scope
    ? query.eq("reserve_id", scopeValue)
    : query.eq("reserves.tenant_id", scopeValue);

  const { data } = await query;
  return [...new Set((data ?? []).map((row) => row.user_id as string))];
}

// Fire-and-forget por design (não deve bloquear a resposta HTTP do caller),
// mas uma falha de insert não pode ficar muda — achado real: types
// "arsenal_request"/"arsenal_approved"/"arsenal_rejected" não existiam em
// notification_type_enum e toda notificação do fluxo de arsenal falhava em
// silêncio (mesma classe de bug já documentada para "armament_cancelled" em
// ssa.ts).
async function insertNotifications(
  rows: { user_id: string; type: string; title: string; body: string; metadata: Record<string, unknown> }[],
  logTag: string,
  logFields: Record<string, unknown> = {}
) {
  if (rows.length === 0) return;
  const { error } = await supabase.from("notifications").insert(rows);
  if (error) {
    logger.error(logTag, { ...logFields, error: error.message });
  }
}

async function notifyReviewers({
  requestId,
  requestType,
  payload,
  reserveId,
  tenantId,
}: {
  requestId: string;
  requestType: ApprovalType;
  payload: Record<string, unknown>;
  reserveId: string | null;
  tenantId: string | null;
}) {
  const titleByType: Record<ApprovalType, string> = {
    stock_adjustment: "Solicitacao de ajuste de estoque",
    material_addition: "Solicitacao de adicao de material",
    material_deactivation: "Solicitacao de desativacao de material",
  };
  const bodyByType: Record<ApprovalType, string> = {
    stock_adjustment: `Armeiro solicitou ajuste para ${String(payload.material_nome ?? "material")}`,
    material_addition: `Armeiro solicitou adicao de ${((payload.items as unknown[]) ?? []).length} material(is)`,
    material_deactivation: `Armeiro solicitou desativacao de ${String(payload.material_nome ?? "material")}`,
  };

  // Reserva pode não ter admin_reserva designado — nesse caso a revisão cabe
  // ao admin_global do tenant (canReviewRequests aceita os dois papéis), e
  // ele precisa ser avisado também, não só quando não há admin_reserva.
  const recipientIds = new Set<string>();
  if (reserveId) {
    const { data: reserveAdmins } = await supabase
      .from("reserve_memberships")
      .select("user_id")
      .eq("reserve_id", reserveId)
      .eq("role", "admin_reserva");
    for (const row of reserveAdmins ?? []) recipientIds.add(row.user_id as string);
  }
  if (tenantId) {
    const { data: globalAdmins } = await supabase
      .from("profiles")
      .select("id")
      .eq("default_tenant_id", tenantId)
      .eq("role", "admin_global");
    for (const row of globalAdmins ?? []) recipientIds.add(row.id as string);
  }

  if (recipientIds.size === 0) return;

  await insertNotifications(
    [...recipientIds].map((userId) => ({
      user_id: userId,
      type: "arsenal_request",
      title: titleByType[requestType],
      body: bodyByType[requestType],
      metadata: { request_id: requestId },
    })),
    "arsenal.notify_reviewers.insert_failure",
    { request_id: requestId, type: requestType }
  );
}

async function ensureMaterialCategory({
  tenantId,
  reserveId,
  createdBy,
  metadata,
}: {
  tenantId: string | null;
  reserveId: string | null;
  createdBy: string;
  metadata: NormalizedMaterialMetadata;
}) {
  if (metadata.category_id) return metadata.category_id;
  if (!tenantId) return null;

  let query = supabase
    .from("material_categories")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("slug", metadata.categoria_slug)
    .eq("active", true)
    .limit(1);
  if (reserveId) query = query.or(`reserve_id.eq.${reserveId},reserve_id.is.null`);
  else query = query.is("reserve_id", null);

  const { data: existing } = await query.maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: created, error } = await supabase
    .from("material_categories")
    .insert({
      tenant_id: tenantId,
      reserve_id: reserveId,
      nome: metadata.categoria,
      slug: metadata.categoria_slug,
      requires_caliber: metadata.categoria_slug === "arma",
      requires_validity: metadata.requires_validity,
      default_has_serial_numbers: metadata.has_serial_numbers,
      validity_alert_days: metadata.validity_alert_days,
      requires_vehicle_fields: metadata.requires_vehicle_fields,
      created_by: createdBy,
    })
    .select("id")
    .single();

  if (error) throw error;
  return created?.id as string | null;
}

const RequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stock_adjustment"),
    material_type_id: z.string().uuid(),
    new_quantity: z.number().int().min(0),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal("material_deactivation"),
    material_type_id: z.string().uuid(),
    notes: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal("material_addition"),
    category_id: z.string().uuid().optional().nullable(),
    nome: z.string().min(1).max(200).optional(),
    categoria: z.string().max(120).optional(),
    categoria_slug: z.string().max(120).optional(),
    quantidade_total: z.number().int().min(1).optional(),
    descricao: z.string().max(1000).optional().nullable(),
    calibre: z.string().max(80).optional().nullable(),
    has_serial_numbers: z.boolean().optional(),
    requires_validity: z.boolean().optional(),
    requires_vehicle_fields: z.boolean().optional(),
    validity_alert_days: z.array(z.number().int()).optional().nullable(),
    photo_url: z.string().url().optional(),
    photo_storage_path: z.string().optional().nullable(),
    vehicle_plate: z.string().max(30).optional().nullable(),
    vehicle_color: z.string().max(80).optional().nullable(),
    vehicle_year: z.number().int().optional().nullable(),
    vehicle_model: z.string().max(120).optional().nullable(),
    items: z.array(z.object({
      numero_serie: z.string().max(120).optional().nullable(),
      validade_item: z.string().optional().nullable(),
      descricao_adicional: z.string().max(1000).optional().nullable(),
    })).optional(),
    batch: z.array(z.object({
      category_id: z.string().uuid().optional().nullable(),
      nome: z.string().min(1).max(200),
      categoria: z.string().max(120),
      categoria_slug: z.string().max(120).optional(),
      quantidade_total: z.number().int().min(1),
      descricao: z.string().max(1000).optional().nullable(),
      calibre: z.string().max(80).optional().nullable(),
      has_serial_numbers: z.boolean().optional(),
      requires_validity: z.boolean().optional(),
      requires_vehicle_fields: z.boolean().optional(),
      validity_alert_days: z.array(z.number().int()).optional().nullable(),
      photo_url: z.string().url().optional(),
      photo_storage_path: z.string().optional().nullable(),
      vehicle_plate: z.string().max(30).optional().nullable(),
      vehicle_color: z.string().max(80).optional().nullable(),
      vehicle_year: z.number().int().optional().nullable(),
      vehicle_model: z.string().max(120).optional().nullable(),
      items: z.array(z.object({
        numero_serie: z.string().max(120).optional().nullable(),
        validade_item: z.string().optional().nullable(),
        descricao_adicional: z.string().max(1000).optional().nullable(),
      })).optional(),
    })).optional(),
    notes: z.string().max(500).optional(),
  }),
]);

function makePhysicalItems({
  materialTypeId,
  tenantId,
  reserveId,
  metadata,
}: {
  materialTypeId: string;
  tenantId: string | null;
  reserveId: string | null;
  metadata: NormalizedMaterialMetadata;
}) {
  if (!tenantId) return [];
  if (!metadata.has_serial_numbers && !metadata.requires_validity && metadata.items.length === 0) return [];

  return metadata.items.map((item, index) => {
    const serial = item.numero_serie?.trim() || null;
    const identifier = serial || `${metadata.categoria_slug}-${materialTypeId}-${index + 1}`;
    return {
      tenant_id: tenantId,
      material_type_id: materialTypeId,
      tipo_identificador: serial ? "numero_serie" : "interno",
      identificador_principal: identifier,
      numero_serie: serial,
      validade_item: item.validade_item ?? null,
      descricao_adicional: item.descricao_adicional?.trim() || null,
      current_unit_id: reserveId,
    };
  });
}

arsenalRoutes.post(
  "/requests",
  roleGuard("armeiro", "admin_reserva"),
  zValidator("json", RequestSchema),
  async (c) => {
    const requestorId = c.get("userId");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const body = c.req.valid("json");

    let payload: Record<string, unknown>;
    let materialTypeId: string | undefined;

    if (body.type === "stock_adjustment") {
      materialTypeId = body.material_type_id;
      const { data: mat } = await supabase
        .from("material_types")
        .select("id, nome, quantidade_total, reserve_id")
        .eq("id", body.material_type_id)
        .single();
      if (!mat) return c.json({ error: "Material nao encontrado" }, 404);
      if (reserveId && mat.reserve_id && mat.reserve_id !== reserveId) {
        return c.json({ error: "Material fora da reserva" }, 403);
      }
      payload = {
        material_nome: mat.nome,
        quantidade_atual: mat.quantidade_total,
        new_quantity: body.new_quantity,
        reserve_id: reserveId,
        notes: body.notes ?? null,
      };
    } else if (body.type === "material_deactivation") {
      materialTypeId = body.material_type_id;
      const { data: mat } = await supabase
        .from("material_types")
        .select("id, nome, reserve_id")
        .eq("id", body.material_type_id)
        .single();
      if (!mat) return c.json({ error: "Material nao encontrado" }, 404);
      if (reserveId && mat.reserve_id && mat.reserve_id !== reserveId) {
        return c.json({ error: "Material fora da reserva" }, 403);
      }
      payload = {
        material_nome: mat.nome,
        reserve_id: reserveId,
        notes: body.notes ?? null,
      };
    } else {
      const items = body.batch ?? (body.nome
        ? [{
            category_id: body.category_id,
            nome: body.nome,
            categoria: body.categoria ?? "outro",
            categoria_slug: body.categoria_slug,
            quantidade_total: body.quantidade_total ?? 1,
            descricao: body.descricao,
            calibre: body.calibre,
            has_serial_numbers: body.has_serial_numbers,
            requires_validity: body.requires_validity,
            requires_vehicle_fields: body.requires_vehicle_fields,
            validity_alert_days: body.validity_alert_days,
            photo_url: body.photo_url,
            photo_storage_path: body.photo_storage_path,
            vehicle_plate: body.vehicle_plate,
            vehicle_color: body.vehicle_color,
            vehicle_year: body.vehicle_year,
            vehicle_model: body.vehicle_model,
            items: body.items,
          }]
        : []);
      if (items.length === 0) return c.json({ error: "Informe ao menos um material" }, 400);
      const validated = items.map((item) => validateMaterialMetadata(item));
      const invalid = validated.find((result) => !result.ok);
      if (invalid && !invalid.ok) return c.json({ error: invalid.error }, 400);
      payload = {
        items: validated.map((result) => result.ok ? result.value : null).filter(Boolean),
        tenant_id: tenantId,
        reserve_id: reserveId,
        notes: body.notes ?? null,
      };
    }

    const { data, error } = await supabase
      .from("admin_approval_requests")
      .insert({
        type: body.type,
        requestor_id: requestorId,
        material_type_id: materialTypeId ?? null,
        payload,
        status: "pendente",
      })
      .select("id")
      .single();

    if (error) return c.json({ error: "Erro ao criar solicitacao" }, 500);

    await notifyReviewers({
      requestId: data.id,
      requestType: body.type,
      payload,
      reserveId,
      tenantId,
    });

    return c.json({ ok: true, request_id: data.id }, 201);
  }
);

arsenalRoutes.get("/requests", roleGuard("armeiro", "admin_reserva", "admin_global"), async (c) => {
  const userId = c.get("userId");
  const userRole = c.get("role");
  const reserveId = c.get("reserveId");
  const tenantId = c.get("tenantId");
  const status = c.req.query("status") ?? "pendente";

  let query = supabase
    .from("admin_approval_requests")
    .select(`
      id, type, status, payload, admin_note, created_at, reviewed_at,
      requestor:requestor_id(id, nome_completo, posto, matricula),
      material:material_type_id(id, nome, categoria, quantidade_total, photo_url),
      reviewer:reviewed_by(id, nome_completo)
    `)
    .order("created_at", { ascending: false });

  if (status !== "all") query = query.eq("status", status);

  if (userRole === "armeiro") {
    query = query.eq("requestor_id", userId);
  } else if (userRole === "admin_reserva") {
    const ids = await scopedRequestorIds({ reserveId });
    if (ids.length === 0) return c.json([]);
    query = query.in("requestor_id", ids);
  } else if (userRole === "admin_global") {
    const ids = await scopedRequestorIds({ tenantId });
    if (ids.length === 0) return c.json([]);
    query = query.in("requestor_id", ids);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: "Erro ao buscar solicitacoes" }, 500);
  return c.json(data ?? []);
});

arsenalRoutes.post("/validity-alerts/run", roleGuard("admin_reserva"), async (c) => {
  const reserveId = c.get("reserveId");
  const tenantId = c.get("tenantId");
  if (!reserveId || !tenantId) return c.json({ error: "Reserva nao identificada" }, 400);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const { data: items, error } = await supabase
    .from("material_items")
    .select(`
      id, tenant_id, current_holder_user_id, current_unit_id, validade_item,
      material_type:material_types(id, nome, reserve_id, validity_alert_days)
    `)
    .eq("tenant_id", tenantId)
    .not("validade_item", "is", null);

  if (error) return c.json({ error: "Erro ao buscar validades" }, 500);

  const { data: staffRows } = await supabase
    .from("reserve_memberships")
    .select("user_id")
    .eq("reserve_id", reserveId)
    .in("role", ["admin_reserva", "armeiro"]);

  const staffIds = new Set((staffRows ?? []).map((row) => row.user_id as string));
  let alertsCreated = 0;
  let notificationsCreated = 0;

  for (const item of items ?? []) {
    const material = Array.isArray(item.material_type) ? item.material_type[0] : item.material_type;
    if (!material || material.reserve_id !== reserveId || !item.validade_item) continue;

    const validade = new Date(`${item.validade_item}T00:00:00`);
    const daysToExpire = Math.ceil((validade.getTime() - today.getTime()) / 86_400_000);
    const alertDays = (material.validity_alert_days?.length ? material.validity_alert_days : [365, 180, 90]) as number[];
    const dueDays = alertDays.filter((day) => daysToExpire >= 0 && daysToExpire <= day);

    for (const alertDaysBefore of dueDays) {
      const { data: eventRow, error: eventError } = await supabase
        .from("material_validity_alert_events")
        .insert({
          tenant_id: tenantId,
          reserve_id: reserveId,
          material_item_id: item.id,
          alert_days: alertDaysBefore,
          validade_item: item.validade_item,
        })
        .select("id")
        .single();

      if (eventError || !eventRow) continue;

      const recipients = new Set(staffIds);
      if (item.current_holder_user_id) recipients.add(item.current_holder_user_id as string);
      if (recipients.size === 0) continue;

      const notifications = [...recipients].map((userId) => ({
        user_id: userId,
        tenant_id: tenantId,
        type: "material_validity_warning",
        title: "Validade de material proxima",
        body: `${material.nome} vence em ${daysToExpire} dia(s).`,
        metadata: {
          material_item_id: item.id,
          alert_days: alertDaysBefore,
          validade_item: item.validade_item,
        },
      }));

      const { data: insertedNotifications } = await supabase
        .from("notifications")
        .insert(notifications)
        .select("id");

      const notificationIds = (insertedNotifications ?? []).map((row) => row.id as string);
      if (notificationIds.length > 0) {
        await supabase
          .from("material_validity_alert_events")
          .update({ notification_ids: notificationIds })
          .eq("id", eventRow.id);
      }
      alertsCreated += 1;
      notificationsCreated += notificationIds.length;
    }
  }

  return c.json({ ok: true, alerts_created: alertsCreated, notifications_created: notificationsCreated });
});

arsenalRoutes.patch(
  "/requests/:id/approve",
  roleGuard("admin_reserva", "admin_global"),
  zValidator("json", z.object({ admin_note: z.string().max(500).optional() })),
  async (c) => {
    const requestId = c.req.param("id");
    const reviewerId = c.get("userId");
    const role = c.get("role");
    const reserveId = c.get("reserveId");
    const tenantId = c.get("tenantId");
    const { admin_note } = c.req.valid("json");

    if (!canReviewRequests(role)) return c.json({ error: "Acesso negado" }, 403);

    const { data: req } = await supabase
      .from("admin_approval_requests")
      .select("*")
      .eq("id", requestId)
      .eq("status", "pendente")
      .single();

    if (!req) return c.json({ error: "Solicitacao nao encontrada ou ja processada" }, 404);
    const allowed = await requestBelongsToScope(req.requestor_id, req.material_type_id, role, reserveId, tenantId);
    if (!allowed) return c.json({ error: "Solicitacao fora do escopo" }, 403);

    // Concorrência otimista: reivindica a solicitação atomicamente ANTES de
    // aplicar a mutação de material. admin_reserva e admin_global agora
    // podem revisar o mesmo pool de solicitações (canReviewRequests) — sem
    // esse claim, dois revisores clicando quase ao mesmo tempo passariam
    // ambos pelo SELECT acima e duplicariam a mutação (estoque inserido ou
    // ajustado duas vezes). Mesmo padrão já usado em PATCH
    // /items/:id/ocorrencia (WHERE status = <esperado>, 409 se não afetou).
    const { data: claimed } = await supabase
      .from("admin_approval_requests")
      .update({
        status: "aprovado",
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        admin_note: admin_note ?? null,
      })
      .eq("id", requestId)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();

    if (!claimed) return c.json({ error: "Solicitacao ja foi processada por outro revisor" }, 409);

    async function revertClaim(reason: string) {
      await supabase
        .from("admin_approval_requests")
        .update({ status: "pendente", reviewed_by: null, reviewed_at: null, admin_note: reason })
        .eq("id", requestId);
    }

    if (req.type === "stock_adjustment") {
      const payload = req.payload as { new_quantity: number };
      const { error: upErr } = await supabase
        .from("material_types")
        .update({ quantidade_total: payload.new_quantity })
        .eq("id", req.material_type_id);
      if (upErr) {
        await revertClaim("Falha ao aplicar ajuste de estoque — solicitação reaberta automaticamente");
        return c.json({ error: "Erro ao atualizar estoque" }, 500);
      }
    } else if (req.type === "material_addition") {
      const payload = req.payload as {
        tenant_id?: string | null;
        reserve_id?: string | null;
        items: NormalizedMaterialMetadata[];
      };
      const rows = [];
      for (const item of payload.items) {
        // ensureMaterialCategory pode lançar (throw error na linha ~225) se o
        // insert de material_categories falhar — sem este try/catch, uma
        // exceção não capturada aqui vira 500 sem reabrir a solicitação
        // (achado real: nenhum revertClaim rodava nesse caminho).
        let categoryId: string | null;
        try {
          categoryId = await ensureMaterialCategory({
            tenantId: payload.tenant_id ?? c.get("tenantId"),
            reserveId: payload.reserve_id ?? reserveId,
            createdBy: reviewerId,
            metadata: item,
          });
        } catch (err) {
          logger.error("arsenal.approve.ensure_category_failure", {
            request_id: requestId,
            categoria_slug: item.categoria_slug,
            error: err instanceof Error ? err.message : String(err),
          });
          await revertClaim("Falha ao resolver categoria de material — solicitação reaberta automaticamente");
          return c.json({ error: "Erro ao resolver categoria de material" }, 500);
        }
        rows.push({
          nome: item.nome,
          category_id: categoryId,
          categoria: item.categoria,
          categoria_slug: item.categoria_slug,
          quantidade_total: item.quantidade_total,
          descricao: item.descricao,
          calibre: item.calibre,
          has_serial_numbers: item.has_serial_numbers,
          requires_validity: item.requires_validity,
          requires_vehicle_fields: item.requires_vehicle_fields,
          validity_alert_days: item.validity_alert_days,
          vehicle_plate: item.vehicle_plate,
          vehicle_color: item.vehicle_color,
          vehicle_year: item.vehicle_year,
          vehicle_model: item.vehicle_model,
          tenant_id: payload.tenant_id ?? c.get("tenantId"),
          reserve_id: payload.reserve_id ?? reserveId,
          photo_url: item.photo_url ?? null,
          photo_storage_path: item.photo_storage_path ?? null,
          ativo: true,
        });
      }

      const { data: insertedMaterials, error: insErr } = await supabase
        .from("material_types")
        .insert(rows)
        .select("id");
      if (insErr) {
        await revertClaim("Falha ao inserir material — solicitação reaberta automaticamente");
        return c.json({ error: "Erro ao inserir material" }, 500);
      }

      const physicalItems = (insertedMaterials ?? []).flatMap((material, index) =>
        makePhysicalItems({
          materialTypeId: material.id as string,
          tenantId: payload.tenant_id ?? c.get("tenantId"),
          reserveId: payload.reserve_id ?? reserveId,
          metadata: payload.items[index],
        })
      );

      if (physicalItems.length > 0) {
        const { error: itemErr } = await supabase.from("material_items").insert(physicalItems);
        if (itemErr) {
          await revertClaim("Falha ao inserir itens fisicos — solicitação reaberta automaticamente");
          return c.json({ error: "Erro ao inserir itens fisicos" }, 500);
        }
      }
    } else if (req.type === "material_deactivation") {
      const { error: deactErr } = await supabase
        .from("material_types")
        .update({ ativo: false })
        .eq("id", req.material_type_id);
      if (deactErr) {
        await revertClaim("Falha ao desativar material — solicitação reaberta automaticamente");
        return c.json({ error: "Erro ao desativar material" }, 500);
      }
    }

    const approvedText: Record<ApprovalType, string> = {
      stock_adjustment: "Seu ajuste de estoque foi aprovado e aplicado.",
      material_addition: "Sua solicitacao de adicao de material foi aprovada.",
      material_deactivation: "Sua solicitacao de desativacao de material foi aprovada.",
    };

    await insertNotifications(
      [{
        user_id: req.requestor_id,
        type: "arsenal_approved",
        title: "Solicitacao aprovada",
        body: approvedText[req.type as ApprovalType],
        metadata: { request_id: requestId },
      }],
      "arsenal.notify_approved.insert_failure",
      { request_id: requestId, requestor_id: req.requestor_id }
    );

    return c.json({ ok: true });
  }
);

arsenalRoutes.patch(
  "/requests/:id/reject",
  roleGuard("admin_reserva", "admin_global"),
  zValidator("json", z.object({ admin_note: z.string().min(5).max(500) })),
  async (c) => {
    const requestId = c.req.param("id");
    const reviewerId = c.get("userId");
    const role = c.get("role");
    const reserveId = c.get("reserveId");
    const tenantId = c.get("tenantId");
    const { admin_note } = c.req.valid("json");

    if (!canReviewRequests(role)) return c.json({ error: "Acesso negado" }, 403);

    const { data: req } = await supabase
      .from("admin_approval_requests")
      .select("requestor_id, material_type_id, type")
      .eq("id", requestId)
      .eq("status", "pendente")
      .single();

    if (!req) return c.json({ error: "Solicitacao nao encontrada ou ja processada" }, 404);
    const allowed = await requestBelongsToScope(req.requestor_id, req.material_type_id, role, reserveId, tenantId);
    if (!allowed) return c.json({ error: "Solicitacao fora do escopo" }, 403);

    // Concorrência otimista: WHERE status = "pendente" garante que só um
    // revisor "vence" quando dois clicam quase ao mesmo tempo (mesmo padrão
    // do approve acima e de PATCH /items/:id/ocorrencia).
    const { data: rejected } = await supabase
      .from("admin_approval_requests")
      .update({
        status: "rejeitado",
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        admin_note,
      })
      .eq("id", requestId)
      .eq("status", "pendente")
      .select("id")
      .maybeSingle();

    if (!rejected) return c.json({ error: "Solicitacao ja foi processada por outro revisor" }, 409);

    await insertNotifications(
      [{
        user_id: req.requestor_id,
        type: "arsenal_rejected",
        title: "Solicitacao negada",
        body: `Motivo: ${admin_note}`,
        metadata: { request_id: requestId },
      }],
      "arsenal.notify_rejected.insert_failure",
      { request_id: requestId, requestor_id: req.requestor_id }
    );

    return c.json({ ok: true });
  }
);

// ─── GET /api/arsenal/items/disponiveis ──────────────────────────────────────
// Lista material_items com status_operacional='disponivel' do tenant, para
// popular o autocomplete do modal de "Registrar Ocorrência" (e qualquer outro
// seletor de item físico individual). Existia antes como query direta do
// client Supabase (RLS) em vários componentes — mas a sessão sb-* vira
// HttpOnly ~100ms após o login (endurecimento de segurança, ver
// auth/exchange/page.tsx), então o SDK do browser nunca consegue anexar um
// Authorization Bearer válido nessas chamadas depois do redirect pós-login:
// a query sempre roda como anon e a RLS corretamente devolve vazio — bug
// silencioso, reproduzido e confirmado via trace de rede (Authorization
// enviado era a própria anon key, não um JWT de usuário). Rota BFF evita
// depender dessa sessão client-side, igual ao padrão já usado para
// GET /api/profiles/me/reserves no mesmo formulário de cautela.
arsenalRoutes.get(
  "/items/disponiveis",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant não identificado" }, 400);
    const q = c.req.query("q")?.trim() ?? "";

    let query = supabase
      .from("material_items")
      .select("id, identificador_principal, status_operacional, material_type:material_types(nome, categoria), reserve:reserves(nome, acronym)")
      .eq("tenant_id", tenantId)
      .eq("status_operacional", "disponivel")
      .order("identificador_principal")
      .limit(300);

    if (q) query = query.ilike("identificador_principal", `%${q}%`);

    const { data, error } = await query;
    if (error) return c.json({ error: "Erro ao buscar materiais disponíveis" }, 500);
    return c.json(data ?? []);
  }
);

// ─── PATCH /api/arsenal/items/:id/ocorrencia ─────────────────────────────────
// Registra uma ocorrência de campo sobre um item físico que nunca saiu do
// estoque (achado avariado/sumido numa conferência), ou reclassifica um item
// que já está num dos status "reportáveis" abaixo. Para itens em posse ativa
// (em_saida/cautelado) o fluxo correto é a devolução com condição inadequada
// — ver PATCH /api/saidas/:id/return e PATCH /api/cautelamentos/:id/return —
// este endpoint recusa com 409 nesse caso para não conflitar com aquele fluxo.
//
// NOTA DE ESCOPO (2026-07): a CHECK constraint de material_items.status_operacional
// e a fn_validate_item_transition foram expandidas em produção (verificado via
// MCP read-only: pg_constraint + pg_get_functiondef) para incluir avariado,
// furtado, em_pericia, bloqueado, em_transito e aguardando_baixa, além dos
// originais manutencao/extraviado. A taxonomia de 3 grupos (Dano/Perda/
// Administrativo) e a exigência de numero_bo para "furtado" são decisão de
// implementação própria — não havia especificação campo a campo — documentada
// no relatório da tarefa para revisão do dono do produto. "manutencao" e
// "aguardando_baixa" ficam de fora do enum de destino (são estados de triagem
// posteriores, não um relato inicial de campo), mas continuam bloqueando
// em_saida/cautelado no trigger e continuam sendo listados na página.
const OcorrenciaSchema = z
  .object({
    novo_status: z.enum(["avariado", "extraviado", "furtado", "em_pericia", "bloqueado", "em_transito"]),
    motivo: z.string().min(5, "Motivo deve ter ao menos 5 caracteres").max(500),
    numero_bo: z.string().trim().min(3, "Informe o número do B.O.").max(60).optional(),
  })
  .refine((data) => data.novo_status !== "furtado" || !!data.numero_bo, {
    message: "Número do Boletim de Ocorrência (B.O.) é obrigatório para itens furtados",
    path: ["numero_bo"],
  });

// disponivel = relato inicial num item que nunca deu problema; os demais
// permitem reclassificar entre os status "reportáveis" (ex: avariado → furtado,
// se a triagem descobrir indício de furto). manutencao/aguardando_baixa/baixado/
// inapto ficam de fora — são estados de decisão administrativa posterior.
const OCORRENCIA_ALLOWED_SOURCE = new Set([
  "disponivel", "avariado", "extraviado", "furtado", "em_pericia", "bloqueado", "em_transito",
]);
const OCORRENCIA_STATUS_LABEL: Record<string, string> = {
  avariado: "Avariado",
  extraviado: "Extraviado",
  furtado: "Furtado",
  em_pericia: "Em perícia",
  bloqueado: "Bloqueado",
  em_transito: "Em trânsito",
};

arsenalRoutes.patch(
  "/items/:id/ocorrencia",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", OcorrenciaSchema),
  async (c) => {
    const id = c.req.param("id");
    const { novo_status, motivo, numero_bo } = c.req.valid("json");
    const tenantId = c.get("tenantId");
    const userId = c.get("userId");

    if (!tenantId) return c.json({ error: "Tenant não identificado" }, 400);

    const { data: item } = await supabase
      .from("material_items")
      .select("id, status_operacional, identificador_principal, descricao_adicional")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!item) return c.json({ error: "Item não encontrado" }, 404);

    if (!OCORRENCIA_ALLOWED_SOURCE.has(item.status_operacional)) {
      const message =
        item.status_operacional === "em_saida" || item.status_operacional === "cautelado"
          ? "Item está em posse ativa — registre a devolução com condição inadequada em vez de reportar ocorrência direta."
          : `Item está com status "${item.status_operacional}" e não pode receber nova ocorrência.`;
      return c.json({ error: message }, 409);
    }

    // Sem coluna dedicada para o nº do B.O. — anexa ao texto livre já exibido
    // na listagem (descricao_adicional), preservando o que já estava anotado
    // em vez de sobrescrever (ex: especificações do item cadastradas antes).
    const novaOcorrencia = numero_bo ? `${motivo} (B.O. nº ${numero_bo})` : motivo;
    const descricao = item.descricao_adicional
      ? `${item.descricao_adicional} | ${novaOcorrencia}`
      : novaOcorrencia;

    // Concorrência otimista: só efetiva se o status ainda for o que acabamos
    // de ler. Sem isso, uma saída/cautela processada entre o SELECT e este
    // UPDATE (disponivel → em_saida) seria sobrescrita sem checagem, deixando
    // o item marcado como avariado/furtado enquanto ainda está com posse
    // ativa — estado duplo inválido num sistema de custódia de armamento.
    const { data: updated, error: updErr } = await supabase
      .from("material_items")
      .update({
        status_operacional: novo_status,
        descricao_adicional: descricao,
        last_movement_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status_operacional", item.status_operacional)
      .select("id")
      .maybeSingle();

    if (updErr) {
      c.get("log").error({ code: updErr.code, error: updErr.message, tenantId }, "arsenal.ocorrencia.update_failure");
      return c.json({ error: "Erro ao registrar ocorrência" }, 500);
    }

    if (!updated) {
      return c.json({ error: "O status do item mudou enquanto a ocorrência era registrada. Recarregue e tente novamente." }, 409);
    }

    auditLog(c, {
      action: "material_item.ocorrencia_registrada",
      resource_type: "material_item",
      resource_id: id,
      before_snapshot: { status_operacional: item.status_operacional },
      after_snapshot: { status_operacional: novo_status },
      metadata: { motivo, numero_bo: numero_bo ?? null },
    });

    logShiftEvent({
      actorId: userId,
      tenantId,
      eventType: "ocorrencia_registrada",
      description: `Ocorrência registrada em ${item.identificador_principal}: ${OCORRENCIA_STATUS_LABEL[novo_status]} — ${motivo}`,
      subjectId: id,
      subjectType: "material_item",
      metadata: { novo_status, motivo, numero_bo: numero_bo ?? null },
    }).catch(() => {});

    return c.json({ ok: true });
  }
);
