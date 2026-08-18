import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditLog } from "../middleware/audit";
import { supabase } from "../services/supabase";
import { validateMaterialMetadata, type NormalizedMaterialMetadata } from "../lib/material-metadata";
import { logShiftEvent } from "../lib/shift-events";
import { requireActiveShift } from "../lib/shift-guard";
import { logger } from "../lib/logger";
import { insertNotifications } from "../lib/notifications";
import {
  MaterialPhotoError,
  materialPhotoErrorStatus,
  processMaterialPhoto,
} from "../domain/material-photo/process-material-photo";
import { MATERIAL_PHOTO_FILE_LIMIT_BYTES } from "../middleware/request-body-limit";
import type { HonoVariables, Role } from "../types/hono";

export const arsenalRoutes = new Hono<{ Variables: HonoVariables }>();
type ArsenalContext = Context<{ Variables: HonoVariables }>;

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
    const role = c.get("role");
    const body = c.req.valid("json");

    // Regra canônica: armeiro não pode solicitar nenhuma movimentação
    // (inclusive gestão de categoria/material) com o turno fechado.
    const shiftCheck = await requireActiveShift(role, requestorId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

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

    // Livro Digital: registra no turno do armeiro que solicitou (não do
    // admin que aprovou) — mesmo padrão aplicado em categories.ts.
    await logShiftEvent({
      actorId: req.requestor_id, tenantId: tenantId!,
      eventType: "solicitacao_aprovada",
      description: `${approvedText[req.type as ApprovalType]}`,
      subjectId: requestId, subjectType: "admin_approval_request",
      metadata: { aprovado_por: reviewerId, tipo: req.type },
    }).catch(() => {});

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

    await logShiftEvent({
      actorId: req.requestor_id, tenantId: tenantId!,
      eventType: "solicitacao_negada",
      description: `Solicitação de ${req.type} rejeitada — motivo: ${admin_note}`,
      subjectId: requestId, subjectType: "admin_approval_request",
      metadata: { rejeitado_por: reviewerId, tipo: req.type },
    }).catch(() => {});

    return c.json({ ok: true });
  }
);

// ─── DELETE /api/arsenal/:id ──────────────────────────────────────────────
// Soft-delete direto de um material_type (ativo=false) por admin_reserva —
// mesmo padrão de segurança de DELETE /api/categories/:id (categories.ts):
// escopo por tenant/reserve do CALLER (sessão, via c.get), nunca por
// reserve_id do corpo/query da requisição, e bloqueio 409 com contagem
// quando há uso ativo.
//
// Complementa (não substitui) dois fluxos já existentes:
//  - POST /api/arsenal/requests {type:"material_deactivation"} — fluxo de
//    APROVAÇÃO usado pelo armeiro (sem canManageDirectly), que pede
//    aprovação do admin_reserva antes de desativar (ver PATCH
//    /requests/:id/approve acima, branch material_deactivation).
//  - DELETE /api/admin/almoxarifado?id= (apps/web/src/app/api/admin/
//    almoxarifado/route.ts) — rota edge do Next.js pré-existente que já
//    fazia essa desativação direto. Duas diferenças relevantes ficam
//    documentadas aqui (achado de investigação, fora do escopo desta tarefa
//    corrigir a rota edge em si): (a) ela chama Supabase com a service role
//    key fora do BFF, algo que o CLAUDE.md deste projeto reserva
//    explicitamente para rotas do BFF; e (b) ela bloqueia usando
//    material_availability.quantidade_armada, que é somado a partir de
//    `lendings` (saídas diárias, sistema legado) — não enxerga item
//    cautelado por tempo indeterminado (material_items.status_operacional
//    = 'cautelado', sistema mais novo de rastreio por unidade física), então
//    um material com 0 saídas diárias ativas mas com unidades em cautela
//    passava pelo bloqueio antigo sem barrar nada. Este endpoint conta
//    diretamente em material_items (em_saida + cautelado), a fonte real de
//    posse ativa por unidade física — a contagem correta.
arsenalRoutes.delete(
  "/:id",
  roleGuard("admin_reserva"),
  async (c) => {
    const id = c.req.param("id");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    if (!tenantId || !reserveId) return c.json({ error: "Reserva não identificada" }, 400);

    const { data: material, error: selectError } = await supabase
      .from("material_types")
      .select("id, nome, tenant_id, reserve_id, ativo")
      .eq("id", id)
      .maybeSingle();

    if (selectError) {
      c.get("log").error({ error: selectError.message }, "arsenal.delete.select_failure");
      return c.json({ error: selectError.message }, 500);
    }
    if (!material || material.tenant_id !== tenantId || material.reserve_id !== reserveId) {
      return c.json({ error: "Material não encontrado" }, 404);
    }
    if (!material.ativo) {
      return c.json({ error: "Material já está desativado" }, 409);
    }

    const { count, error: countError } = await supabase
      .from("material_items")
      .select("id", { count: "exact", head: true })
      .eq("material_type_id", id)
      .in("status_operacional", ["em_saida", "cautelado"]);

    if (countError) {
      c.get("log").error({ error: countError.message }, "arsenal.delete.count_failure");
      return c.json({ error: countError.message }, 500);
    }
    if ((count ?? 0) > 0) {
      return c.json({
        error: `Não é possível desativar: ${count} item(ns) físico(s) em uso (saída ou cautela)`,
      }, 409);
    }

    const { error: updateError } = await supabase
      .from("material_types")
      .update({ ativo: false })
      .eq("id", id);

    if (updateError) {
      c.get("log").error({ error: updateError.message }, "arsenal.delete.update_failure");
      return c.json({ error: updateError.message }, 500);
    }

    auditLog(c, {
      action: "material_type.desativado_diretamente",
      resource_type: "material_type",
      resource_id: id,
      before_snapshot: { ativo: true },
      after_snapshot: { ativo: false },
      metadata: { nome: material.nome },
    });

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
// foto_url e usuario_associado_id são opcionais (achado de produto: upload de
// evidência visual e associação de um militar à ocorrência) — ver migration
// 20260816120100_add_material_items_ocorrencia_columns.sql. foto_url é o path
// relativo devolvido por POST /api/arsenal/material-photo (bucket privado
// material-photos, mesmo padrão de material_types.photo_url — NUNCA uma URL
// pública), por isso NÃO usamos z.string().url() aqui.
const OcorrenciaSchema = z
  .object({
    novo_status: z.enum(["avariado", "extraviado", "furtado", "em_pericia", "bloqueado", "em_transito"]),
    motivo: z.string().min(5, "Motivo deve ter ao menos 5 caracteres").max(500),
    numero_bo: z.string().trim().min(3, "Informe o número do B.O.").max(60).optional(),
    foto_url: z.string().min(1).max(500).optional(),
    usuario_associado_id: z.string().uuid().optional(),
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
    const { novo_status, motivo, numero_bo, foto_url, usuario_associado_id } = c.req.valid("json");
    const tenantId = c.get("tenantId");
    const userId = c.get("userId");
    const role = c.get("role");

    if (!tenantId) return c.json({ error: "Tenant não identificado" }, 400);

    // Regra canônica: registrar ocorrência de material (fluxo de
    // manutenção) também é uma movimentação — não pode ocorrer com o turno
    // fechado.
    const shiftCheck = await requireActiveShift(role, userId);
    if (!shiftCheck.ok) return c.json(shiftCheck.body, 403);

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

    // O client (AsyncComboBox) só oferece resultados de
    // GET /api/admin/search-profiles, mas o id chega aqui como texto livre no
    // corpo do PATCH — sem revalidar, um usuario_associado_id forjado
    // associaria (e notificaria) alguém de outro tenant, um IDOR clássico.
    // Mesmo padrão de checagem de escopo já usado em requestorBelongsToTenant
    // acima neste arquivo.
    if (usuario_associado_id) {
      const { data: associado } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", usuario_associado_id)
        .eq("default_tenant_id", tenantId)
        .maybeSingle();
      if (!associado) return c.json({ error: "Militar associado inválido ou fora do seu tenant" }, 400);
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
    const baseUpdate = {
      status_operacional: novo_status,
      descricao_adicional: descricao,
      last_movement_at: new Date().toISOString(),
    };
    // ocorrencia_foto_url/ocorrencia_usuario_associado_id/
    // ocorrencia_registrada_por/ocorrencia_registrada_em (migration
    // 20260816120100_add_material_items_ocorrencia_columns.sql) refletem a
    // ocorrência MAIS RECENTE deste item — mesma semântica de
    // status_operacional (não é histórico append-only). Sempre gravados
    // nesta atualização, inclusive como null quando não informados, pra não
    // deixar foto/associação de uma ocorrência anterior "grudada" na atual
    // quando o item é reclassificado (ex: avariado → furtado).
    const attachmentUpdate = {
      ocorrencia_foto_url: foto_url ?? null,
      ocorrencia_usuario_associado_id: usuario_associado_id ?? null,
      ocorrencia_registrada_por: userId,
      ocorrencia_registrada_em: new Date().toISOString(),
    };

    let { data: updated, error: updErr } = await supabase
      .from("material_items")
      .update({ ...baseUpdate, ...attachmentUpdate })
      .eq("id", id)
      .eq("status_operacional", item.status_operacional)
      .select("id")
      .maybeSingle();

    // DDL requer aprovação humana neste ambiente — a migration acima pode
    // ainda não ter sido aplicada quando este código já estiver em produção.
    // Sem este fallback, TODO registro de ocorrência (mesmo sem foto/usuário
    // associado) quebraria com "column does not exist" até a migration ser
    // aplicada manualmente — o fluxo principal não pode ficar refém de uma
    // migration pendente (mesmo raciocínio defensivo já aplicado ao insert de
    // notification abaixo, generalizado aqui pro update em si). Reexecuta só
    // com os campos que sempre existiram; loga a degradação pra ficar visível
    // que a migration ainda não rodou neste ambiente.
    //
    // Confere a mensagem além do code, não só o code sozinho: tanto 42703
    // (Postgres, undefined_column — SQL chegou a rodar) quanto PGRST204
    // (PostgREST, "column ... not found in the schema cache" — PostgREST
    // barra a request ANTES de gerar SQL, quando sua cache de schema, TTL
    // próprio, ainda não viu a coluna nova; confirmado ao vivo via Playwright
    // contra o Supabase real: o erro observado foi PGRST204, não 42703 — sem
    // este segundo code o fallback nunca disparava e TODO registro de
    // ocorrência quebrava com 500) cobririam QUALQUER coluna ausente, não só
    // as 4 novas de anexo — sem checar a mensagem, um erro genuinamente não
    // relacionado (ex: erro futuro em status_operacional/descricao_adicional)
    // seria mascarado com um log enganoso de "migration de anexo pendente"
    // em vez do erro real.
    const ATTACHMENT_COLUMNS = ["ocorrencia_foto_url", "ocorrencia_usuario_associado_id", "ocorrencia_registrada_por", "ocorrencia_registrada_em"];
    const isMissingColumnError = updErr && (updErr.code === "42703" || updErr.code === "PGRST204");
    let attachmentPersisted = true;
    if (isMissingColumnError && ATTACHMENT_COLUMNS.some((col) => updErr!.message.includes(col))) {
      attachmentPersisted = false;
      c.get("log").warn(
        { tenantId, error: updErr!.message },
        "arsenal.ocorrencia.attachment_columns_missing_fallback"
      );
      ({ data: updated, error: updErr } = await supabase
        .from("material_items")
        .update(baseUpdate)
        .eq("id", id)
        .eq("status_operacional", item.status_operacional)
        .select("id")
        .maybeSingle());
    }

    if (updErr) {
      c.get("log").error({ code: updErr.code, error: updErr.message, tenantId }, "arsenal.ocorrencia.update_failure");
      return c.json({ error: "Erro ao registrar ocorrência" }, 500);
    }

    if (!updated) {
      return c.json({ error: "O status do item mudou enquanto a ocorrência era registrada. Recarregue e tente novamente." }, 409);
    }

    // Achado de code review: auditLog/logShiftEvent são a trilha de
    // compliance deste sistema de custódia de armamento — não podem afirmar
    // "havia foto/militar associado" quando o fallback 42703 acima significa
    // que essas colunas NÃO foram de fato gravadas em material_items.
    // attachment_persisted=false no metadata deixa explícito, pra quem ler o
    // log depois, que a foto/associação foi solicitada mas não persistida
    // (migration pendente), sem precisar cruzar com outro log pra descobrir.
    const auditFotoUrl = attachmentPersisted ? (foto_url ?? null) : null;
    const auditUsuarioAssociadoId = attachmentPersisted ? (usuario_associado_id ?? null) : null;

    auditLog(c, {
      action: "material_item.ocorrencia_registrada",
      resource_type: "material_item",
      resource_id: id,
      before_snapshot: { status_operacional: item.status_operacional },
      after_snapshot: { status_operacional: novo_status },
      metadata: {
        motivo, numero_bo: numero_bo ?? null,
        foto_url: auditFotoUrl, usuario_associado_id: auditUsuarioAssociadoId,
        attachment_persisted: attachmentPersisted,
      },
    });

    logShiftEvent({
      actorId: userId,
      tenantId,
      eventType: "ocorrencia_registrada",
      description: `Ocorrência registrada em ${item.identificador_principal}: ${OCORRENCIA_STATUS_LABEL[novo_status]} — ${motivo}`,
      subjectId: id,
      subjectType: "material_item",
      metadata: {
        novo_status, motivo, numero_bo: numero_bo ?? null,
        foto_url: auditFotoUrl, usuario_associado_id: auditUsuarioAssociadoId,
        attachment_persisted: attachmentPersisted,
      },
    }).catch(() => {});

    // Notifica o militar associado (sino + página de histórico, ver
    // GET /api/usuario/historico) — best-effort via insertNotifications, que
    // já checa e loga o erro do insert sem lançar (mesmo padrão usado acima
    // em notifyReviewers/approve/reject). O type 'ocorrencia_associada'
    // depende da migration 20260816120000_add_ocorrencia_associada_notification_type.sql
    // — até ela ser aplicada, o insert falha e é só logado (mesma classe de
    // achado já documentada nessa migration): o registro da ocorrência em si
    // não é afetado.
    //
    // Só notifica se attachmentPersisted: sem isso, no fallback acima (coluna
    // ocorrencia_usuario_associado_id ainda não existe), enviaríamos "você
    // foi associado a esta ocorrência" para alguém cuja associação NÃO foi
    // de fato gravada em lugar nenhum — o militar receberia o aviso mas
    // nunca veria o registro na própria página de histórico, incoerente.
    if (usuario_associado_id && attachmentPersisted) {
      await insertNotifications(
        [{
          user_id: usuario_associado_id,
          type: "ocorrencia_associada",
          title: "Ocorrência de material associada ao seu nome",
          body: `${item.identificador_principal} — ${OCORRENCIA_STATUS_LABEL[novo_status]}: ${motivo}`,
          metadata: {
            material_item_id: id,
            identificador_principal: item.identificador_principal,
            novo_status,
            motivo,
            numero_bo: numero_bo ?? null,
            registrado_por: userId,
          },
        }],
        "arsenal.notify_ocorrencia_associada.insert_failure",
        { material_item_id: id, usuario_associado_id }
      );
    }

    return c.json({ ok: true });
  }
);

// ─── POST /api/arsenal/material-photo ────────────────────────────────────────
// Upload de foto de material do arsenal (arma/equipamento/viatura) — usado
// tanto pelo dialog de cadastro/edição de material (_material-dialog.tsx,
// grava em material_types.photo_url via /requests → material_addition) quanto
// pelo registro de ocorrência de manutenção (_registrar-ocorrencia-dialog.tsx,
// grava em material_items.ocorrencia_foto_url via PATCH /items/:id/ocorrencia
// acima). Antes desta rota existir, o Next.js edge route
// (apps/web/src/app/api/arsenal/material-photo/route.ts) fazia o upload DIRETO
// pro Storage com os bytes brutos do cliente — até 5 MiB sem nenhuma
// compressão nem cap de dimensão — o MESMO bug de custo de egress já corrigido
// pra fotos de perfil (ver CHANGELOG, 2026-07-27) só que nunca replicado
// aqui. Mesmo padrão agora: o BFF é o único lugar que toca Sharp e o client
// de service role do Storage; a rota Next vira um proxy fino (auth via
// cookie de sessão + CSRF, sem lógica própria).
//
// Staff-only: mesmo conjunto de papéis operacionais que replace-profile-photo
// usa pra "alguém alterando a foto de OUTRA entidade" (OPERATIONAL_ROLES em
// domain/profile-photo/replace-profile-photo.ts) — a rota edge antiga também
// aceitava os literais "admin"/"master", mas esses nunca existiram no enum
// profiles.role deste projeto (ver types/hono.ts Role) nem no schema do
// banco; eram defensivos/mortos, não um papel real a preservar aqui.
//
// Sem CAS/dedup-on-replace (ao contrário de replace-profile-photo): fotos de
// material antigas já não são limpas na troca hoje (limitação pré-existente,
// não documentada, fora de escopo desta correção) — path novo por UUID a
// cada upload é suficiente pra fechar o problema real (custo de egress por
// bytes brutos), sem reintroduzir a complexidade de compare-and-swap que só
// faz sentido quando há 1 dono claro do registro (perfil tem 1 foto; um
// material pode ter fotos referenciadas por múltiplas solicitações pendentes
// simultâneas, então "a última grava por cima" já é o comportamento atual).
const MATERIAL_PHOTO_BUCKET = "material-photos";

function materialPhotoErrorResponse(c: ArsenalContext, error: unknown) {
  if (error instanceof MaterialPhotoError) {
    return c.json(
      { error: error.message, code: error.code },
      materialPhotoErrorStatus(error.code),
    );
  }
  c.get("log").error(
    { error: error instanceof Error ? error.message : "unknown" },
    "material_photo.unexpected_failure",
  );
  return c.json({ error: "Erro interno" }, 500);
}

arsenalRoutes.post(
  "/material-photo",
  roleGuard("admin_global", "admin_reserva", "armeiro"),
  async (c) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Envie multipart/form-data" }, 400);
    }

    const file = formData.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "Arquivo não informado" }, 400);
    }
    if (file.size > MATERIAL_PHOTO_FILE_LIMIT_BYTES) {
      return c.json({ error: "A foto excede o limite de 5 MiB" }, 413);
    }

    let processed;
    try {
      const rawBytes = new Uint8Array(await file.arrayBuffer());
      processed = await processMaterialPhoto(rawBytes);
    } catch (error) {
      return materialPhotoErrorResponse(c, error);
    }

    // Path novo (UUID) a cada upload — nunca colide, dispensa upsert.
    const path = `materials/${crypto.randomUUID()}.webp`;
    const { error: uploadError } = await supabase.storage
      .from(MATERIAL_PHOTO_BUCKET)
      .upload(path, processed.bytes, {
        contentType: "image/webp",
        cacheControl: "31536000",
        upsert: false,
      });

    if (uploadError) {
      c.get("log").error(
        { error: uploadError.message },
        "material_photo.storage_upload_failed",
      );
      return c.json({ error: "Erro ao enviar foto" }, 500);
    }

    // material-photos é privado (20260629000001_fix_rls_security_audit.sql) —
    // getPublicUrl() geraria um link que sempre 400 no Storage. photo_url é
    // persistido bruto em material_types/admin_approval_requests.payload por
    // possivelmente semanas (solicitação pendente) até ser resolvido pra
    // exibição via resolvePhotoUrl (apps/web/src/lib/storage.ts), que já
    // aceita path relativo — devolver o path direto (nos dois campos, mesmo
    // formato já consumido pelos dois callers web) evita gerar/propagar uma
    // URL pública que nunca funcionaria, sem depender de signed URL (que
    // expiraria muito antes da solicitação ser revisada).
    return c.json({ photo_url: path, photo_storage_path: path });
  }
);
