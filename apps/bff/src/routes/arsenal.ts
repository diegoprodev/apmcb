import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import { validateMaterialMetadata, type NormalizedMaterialMetadata } from "../lib/material-metadata";
import type { HonoVariables, Role } from "../types/hono";

export const arsenalRoutes = new Hono<{ Variables: HonoVariables }>();

type ApprovalType = "stock_adjustment" | "material_addition" | "material_deactivation";

function canReviewRequests(role: Role) {
  return role === "admin_reserva";
}

async function requestBelongsToReserve(
  requestorId: string,
  materialTypeId: string | null,
  reserveId: string | null
) {
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

async function scopedRequestorIds(reserveId: string | null) {
  if (!reserveId) return [];
  const { data } = await supabase
    .from("reserve_memberships")
    .select("user_id")
    .eq("reserve_id", reserveId)
    .in("role", ["armeiro", "admin_reserva"]);
  return (data ?? []).map((row) => row.user_id as string);
}

async function notifyReviewers({
  requestId,
  requestType,
  payload,
  reserveId,
}: {
  requestId: string;
  requestType: ApprovalType;
  payload: Record<string, unknown>;
  reserveId: string | null;
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

  const recipientIds = new Set<string>();
  if (reserveId) {
    const { data: reserveAdmins } = await supabase
      .from("reserve_memberships")
      .select("user_id")
      .eq("reserve_id", reserveId)
      .eq("role", "admin_reserva");
    for (const row of reserveAdmins ?? []) recipientIds.add(row.user_id as string);
  }

  if (recipientIds.size === 0) return;

  await supabase.from("notifications").insert(
    [...recipientIds].map((userId) => ({
      user_id: userId,
      type: "arsenal_request",
      title: titleByType[requestType],
      body: bodyByType[requestType],
      metadata: { request_id: requestId },
    }))
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
    });

    return c.json({ ok: true, request_id: data.id }, 201);
  }
);

arsenalRoutes.get("/requests", roleGuard("armeiro", "admin_reserva"), async (c) => {
  const userId = c.get("userId");
  const userRole = c.get("role");
  const reserveId = c.get("reserveId");
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
    const ids = await scopedRequestorIds(reserveId);
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
  roleGuard("admin_reserva"),
  zValidator("json", z.object({ admin_note: z.string().max(500).optional() })),
  async (c) => {
    const requestId = c.req.param("id");
    const reviewerId = c.get("userId");
    const role = c.get("role");
    const reserveId = c.get("reserveId");
    const { admin_note } = c.req.valid("json");

    if (!canReviewRequests(role)) return c.json({ error: "Acesso negado" }, 403);

    const { data: req } = await supabase
      .from("admin_approval_requests")
      .select("*")
      .eq("id", requestId)
      .eq("status", "pendente")
      .single();

    if (!req) return c.json({ error: "Solicitacao nao encontrada ou ja processada" }, 404);
    const allowed = await requestBelongsToReserve(req.requestor_id, req.material_type_id, reserveId);
    if (!allowed) return c.json({ error: "Solicitacao fora da reserva" }, 403);

    if (req.type === "stock_adjustment") {
      const payload = req.payload as { new_quantity: number };
      const { error: upErr } = await supabase
        .from("material_types")
        .update({ quantidade_total: payload.new_quantity })
        .eq("id", req.material_type_id);
      if (upErr) return c.json({ error: "Erro ao atualizar estoque" }, 500);
    } else if (req.type === "material_addition") {
      const payload = req.payload as {
        tenant_id?: string | null;
        reserve_id?: string | null;
        items: NormalizedMaterialMetadata[];
      };
      const rows = [];
      for (const item of payload.items) {
        const categoryId = await ensureMaterialCategory({
          tenantId: payload.tenant_id ?? c.get("tenantId"),
          reserveId: payload.reserve_id ?? reserveId,
          createdBy: reviewerId,
          metadata: item,
        });
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
      if (insErr) return c.json({ error: "Erro ao inserir material" }, 500);

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
        if (itemErr) return c.json({ error: "Erro ao inserir itens fisicos" }, 500);
      }
    } else if (req.type === "material_deactivation") {
      const { error: deactErr } = await supabase
        .from("material_types")
        .update({ ativo: false })
        .eq("id", req.material_type_id);
      if (deactErr) return c.json({ error: "Erro ao desativar material" }, 500);
    }

    await supabase
      .from("admin_approval_requests")
      .update({
        status: "aprovado",
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        admin_note: admin_note ?? null,
      })
      .eq("id", requestId);

    const approvedText: Record<ApprovalType, string> = {
      stock_adjustment: "Seu ajuste de estoque foi aprovado e aplicado.",
      material_addition: "Sua solicitacao de adicao de material foi aprovada.",
      material_deactivation: "Sua solicitacao de desativacao de material foi aprovada.",
    };

    await supabase.from("notifications").insert({
      user_id: req.requestor_id,
      type: "arsenal_approved",
      title: "Solicitacao aprovada",
      body: approvedText[req.type as ApprovalType],
      metadata: { request_id: requestId },
    });

    return c.json({ ok: true });
  }
);

arsenalRoutes.patch(
  "/requests/:id/reject",
  roleGuard("admin_reserva"),
  zValidator("json", z.object({ admin_note: z.string().min(5).max(500) })),
  async (c) => {
    const requestId = c.req.param("id");
    const reviewerId = c.get("userId");
    const role = c.get("role");
    const reserveId = c.get("reserveId");
    const { admin_note } = c.req.valid("json");

    const { data: req } = await supabase
      .from("admin_approval_requests")
      .select("requestor_id, material_type_id, type")
      .eq("id", requestId)
      .eq("status", "pendente")
      .single();

    if (!req) return c.json({ error: "Solicitacao nao encontrada ou ja processada" }, 404);
    const allowed = await requestBelongsToReserve(req.requestor_id, req.material_type_id, reserveId);
    if (!allowed) return c.json({ error: "Solicitacao fora da reserva" }, 403);

    await supabase
      .from("admin_approval_requests")
      .update({
        status: "rejeitado",
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        admin_note,
      })
      .eq("id", requestId);

    await supabase.from("notifications").insert({
      user_id: req.requestor_id,
      type: "arsenal_rejected",
      title: "Solicitacao negada",
      body: `Motivo: ${admin_note}`,
      metadata: { request_id: requestId },
    });

    return c.json({ ok: true });
  }
);
