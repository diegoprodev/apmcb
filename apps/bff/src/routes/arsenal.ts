import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
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
    nome: z.string().min(1).max(200).optional(),
    categoria: z.string().max(50).optional(),
    quantidade_total: z.number().int().min(1).optional(),
    photo_url: z.string().url().optional(),
    batch: z.array(z.object({
      nome: z.string().min(1).max(200),
      categoria: z.string().max(50),
      quantidade_total: z.number().int().min(1),
      photo_url: z.string().url().optional(),
    })).optional(),
    notes: z.string().max(500).optional(),
  }),
]);

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
            nome: body.nome,
            categoria: body.categoria ?? "outro",
            quantidade_total: body.quantidade_total ?? 1,
            photo_url: body.photo_url,
          }]
        : []);
      if (items.length === 0) return c.json({ error: "Informe ao menos um material" }, 400);
      payload = { items, tenant_id: tenantId, reserve_id: reserveId, notes: body.notes ?? null };
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
        items: { nome: string; categoria: string; quantidade_total: number; photo_url?: string | null }[];
      };
      const { error: insErr } = await supabase
        .from("material_types")
        .insert(payload.items.map((item) => ({
          nome: item.nome,
          categoria: item.categoria,
          quantidade_total: item.quantidade_total,
          tenant_id: payload.tenant_id ?? c.get("tenantId"),
          reserve_id: payload.reserve_id ?? reserveId,
          photo_url: item.photo_url ?? null,
          ativo: true,
        })));
      if (insErr) return c.json({ error: "Erro ao inserir material" }, 500);
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
