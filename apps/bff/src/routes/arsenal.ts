import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const arsenalRoutes = new Hono<{ Variables: HonoVariables }>();

// ─── POST /api/arsenal/requests ─────────────────────────────────────────────
// Armeiro submits a request (stock_adjustment or material_addition)
arsenalRoutes.post(
  "/requests",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator(
    "json",
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("stock_adjustment"),
        material_type_id: z.string().uuid(),
        new_quantity: z.number().int().min(0),
        notes: z.string().max(500).optional(),
      }),
      z.object({
        type: z.literal("material_addition"),
        // single material
        nome: z.string().min(1).max(200).optional(),
        categoria: z.string().max(50).optional(),
        quantidade_total: z.number().int().min(1).optional(),
        // or batch: array of materials
        batch: z.array(z.object({
          nome: z.string().min(1).max(200),
          categoria: z.string().max(50),
          quantidade_total: z.number().int().min(1),
        })).optional(),
        notes: z.string().max(500).optional(),
      }),
    ])
  ),
  async (c) => {
    const requestorId = c.get("userId");
    const body = c.req.valid("json");

    let payload: Record<string, unknown>;
    let materialTypeId: string | undefined;

    if (body.type === "stock_adjustment") {
      materialTypeId = body.material_type_id;
      // Validate material exists
      const { data: mat } = await supabase
        .from("material_types")
        .select("id, nome, quantidade_total")
        .eq("id", body.material_type_id)
        .single();
      if (!mat) return c.json({ error: "Material não encontrado" }, 404);
      payload = {
        material_nome: mat.nome,
        quantidade_atual: mat.quantidade_total,
        new_quantity: body.new_quantity,
        notes: body.notes ?? null,
      };
    } else {
      // material_addition
      const items = body.batch ?? (body.nome
        ? [{ nome: body.nome, categoria: body.categoria ?? "outro", quantidade_total: body.quantidade_total ?? 1 }]
        : []);
      if (items.length === 0) return c.json({ error: "Informe ao menos um material" }, 400);
      payload = { items, notes: body.notes ?? null };
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

    if (error) return c.json({ error: "Erro ao criar solicitação" }, 500);

    // Notify all admins
    const { data: admins } = await supabase
      .from("profiles")
      .select("id")
      .eq("role", "admin_global");

    if (admins && admins.length > 0) {
      const title = body.type === "stock_adjustment"
        ? "Solicitação de ajuste de estoque"
        : "Solicitação de adição de material";
      const bodyText = body.type === "stock_adjustment"
        ? `Armeiro solicitou ajuste de quantidade para ${(payload as { material_nome: string }).material_nome}`
        : `Armeiro solicitou adição de ${(payload as { items: unknown[] }).items.length} material(is)`;

      await supabase.from("notifications").insert(
        admins.map((a) => ({
          user_id: a.id,
          type: "arsenal_request",
          title,
          body: bodyText,
          metadata: { request_id: data.id },
        }))
      );
    }

    return c.json({ ok: true, request_id: data.id }, 201);
  }
);

// ─── GET /api/arsenal/requests ───────────────────────────────────────────────
// Admin: all requests; Armeiro: own requests
arsenalRoutes.get("/requests", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  const userId = c.get("userId");
  const userRole = c.get("role");
  const status = c.req.query("status") ?? "pendente";

  let query = supabase
    .from("admin_approval_requests")
    .select(`
      id, type, status, payload, admin_note, created_at, reviewed_at,
      requestor:requestor_id(id, nome_completo, posto, matricula),
      material:material_type_id(id, nome, categoria, quantidade_total),
      reviewer:reviewed_by(id, nome_completo)
    `)
    .order("created_at", { ascending: false });

  if (status !== "all") {
    query = query.eq("status", status);
  }

  if (userRole !== "admin_global" && userRole !== "superadmin") {
    query = query.eq("requestor_id", userId);
  }

  const { data, error } = await query;
  if (error) return c.json({ error: "Erro ao buscar solicitações" }, 500);
  return c.json(data ?? []);
});

// ─── PATCH /api/arsenal/requests/:id/approve ─────────────────────────────────
arsenalRoutes.patch(
  "/requests/:id/approve",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({ admin_note: z.string().max(500).optional() })),
  async (c) => {
    const requestId = c.req.param("id");
    const reviewerId = c.get("userId");
    const { admin_note } = c.req.valid("json");

    // Fetch request
    const { data: req } = await supabase
      .from("admin_approval_requests")
      .select("*")
      .eq("id", requestId)
      .eq("status", "pendente")
      .single();

    if (!req) return c.json({ error: "Solicitação não encontrada ou já processada" }, 404);

    // Execute the action
    if (req.type === "stock_adjustment") {
      const payload = req.payload as { new_quantity: number };
      const { error: upErr } = await supabase
        .from("material_types")
        .update({ quantidade_total: payload.new_quantity })
        .eq("id", req.material_type_id);
      if (upErr) return c.json({ error: "Erro ao atualizar estoque" }, 500);
    } else if (req.type === "material_addition") {
      const payload = req.payload as { items: { nome: string; categoria: string; quantidade_total: number }[] };
      const { error: insErr } = await supabase
        .from("material_types")
        .insert(payload.items.map((item) => ({
          nome: item.nome,
          categoria: item.categoria,
          quantidade_total: item.quantidade_total,
          ativo: true,
        })));
      if (insErr) return c.json({ error: "Erro ao inserir material" }, 500);
    }

    // Update request status
    await supabase
      .from("admin_approval_requests")
      .update({
        status: "aprovado",
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        admin_note: admin_note ?? null,
      })
      .eq("id", requestId);

    // Notify requestor
    await supabase.from("notifications").insert({
      user_id: req.requestor_id,
      type: "arsenal_approved",
      title: "Solicitação aprovada",
      body: req.type === "stock_adjustment"
        ? "Seu ajuste de estoque foi aprovado e aplicado."
        : "Sua solicitação de adição de material foi aprovada.",
      metadata: { request_id: requestId },
    });

    return c.json({ ok: true });
  }
);

// ─── PATCH /api/arsenal/requests/:id/reject ──────────────────────────────────
arsenalRoutes.patch(
  "/requests/:id/reject",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({ admin_note: z.string().min(5).max(500) })),
  async (c) => {
    const requestId = c.req.param("id");
    const reviewerId = c.get("userId");
    const { admin_note } = c.req.valid("json");

    const { data: req } = await supabase
      .from("admin_approval_requests")
      .select("requestor_id, type")
      .eq("id", requestId)
      .eq("status", "pendente")
      .single();

    if (!req) return c.json({ error: "Solicitação não encontrada ou já processada" }, 404);

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
      title: "Solicitação negada",
      body: `Motivo: ${admin_note}`,
      metadata: { request_id: requestId },
    });

    return c.json({ ok: true });
  }
);
