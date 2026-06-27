import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { auditAction } from "../middleware/audit";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const lendingRoutes = new Hono<{ Variables: HonoVariables }>();

// GET /api/lendings/:id — full detail with all relations
lendingRoutes.get("/:id", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  const id = c.req.param("id");
  const tenantId = c.get("tenantId");
  if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

  const { data, error } = await supabase
    .from("lendings")
    .select(`
      *,
      material_type:material_types(nome, categoria),
      military:profiles!lendings_military_id_fkey(nome_completo, matricula, posto, foto_url),
      master:profiles!lendings_master_id_fkey(nome_completo, matricula, posto),
      material_request:material_requests(id, status, notes, totp_validated)
    `)
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .single();

  if (error || !data) return c.json({ error: "Saída não encontrada." }, 404);
  return c.json(data);
});

lendingRoutes.get("/", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  const { military_id, status, material_type_id } = c.req.query();
  const tenantId = c.get("tenantId");
  if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

  let query = supabase
    .from("lendings")
    .select(`
      *,
      material_type:material_types(nome, categoria),
      military:profiles!lendings_military_id_fkey(nome_completo, matricula, posto),
      master:profiles!lendings_master_id_fkey(nome_completo)
    `)
    .eq("tenant_id", tenantId)
    .order("issued_at", { ascending: false });
  if (military_id) query = query.eq("military_id", military_id);
  // status agora em status_legacy (Fase 5 criará coluna status canônica)
  if (status) query = query.eq("status_legacy", status);
  if (material_type_id) query = query.eq("material_type_id", material_type_id);

  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 500);
  return c.json(data);
});

lendingRoutes.post(
  "/",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator(
    "json",
    z.object({
      material_type_id: z.string().uuid(),
      military_id: z.string().uuid(),
      quantidade: z.number().int().min(1).default(1),
      notes: z.string().optional(),
      auth_mode: z.enum(["biometria", "totp", "manual"]).default("manual"),
      material_request_id: z.string().uuid().optional(),
    })
  ),
  auditAction("lending.created", "lendings"),
  async (c) => {
    const body = c.req.valid("json");
    const masterId = c.get("userId");

    // Block armament for military with administrative impediment
    const { data: militaryProfile } = await supabase
      .from("profiles")
      .select("registration_status")
      .eq("id", body.military_id)
      .single();

    if (militaryProfile?.registration_status === "impedimento_administrativo") {
      return c.json(
        { error: "Militar com impedimento administrativo. Para dúvidas, procure o Departamento de Pessoas de sua unidade." },
        403
      );
    }

    const { data: material } = await supabase
      .from("material_types")
      .select("quantidade_total")
      .eq("id", body.material_type_id)
      .single();

    if (!material) return c.json({ error: "Material not found" }, 404);

    const { data: activeCount } = await supabase
      .from("lendings")
      .select("quantidade")
      .eq("material_type_id", body.material_type_id)
      .eq("status_legacy", "ativo");

    const totalActive = (activeCount ?? []).reduce(
      (sum, r) => sum + r.quantidade,
      0
    );

    if (totalActive + body.quantidade > material.quantidade_total) {
      return c.json({ error: "Insufficient stock" }, 409);
    }

    const { data, error } = await supabase
      .from("lendings")
      .insert({
        material_type_id: body.material_type_id,
        military_id: body.military_id,
        quantidade: body.quantidade,
        notes: body.notes,
        auth_mode: body.auth_mode,
        material_request_id: body.material_request_id ?? null,
        master_id: masterId,
      })
      .select()
      .single();

    if (error) return c.json({ error: error.message }, 500);

    await supabase.from("notifications").insert({
      user_id: body.military_id,
      type: "material_issued",
      title: "Material recebido",
      body: `Você recebeu ${body.quantidade}x material da Reserva de Armamento.`,
      metadata: { lending_id: data.id, material_type_id: body.material_type_id },
    });

    return c.json(data, 201);
  }
);

lendingRoutes.patch(
  "/:id/return",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  auditAction("lending.returned", "lendings"),
  async (c) => {
    const id = c.req.param("id");

    const { data, error } = await supabase
      .from("lendings")
      .update({ status_legacy: "devolvido", returned_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status_legacy", "ativo")
      .select("*, military:profiles!lendings_military_id_fkey(id)")
      .single();

    if (error || !data) return c.json({ error: "Lending not found or already returned" }, 404);

    await supabase.from("notifications").insert({
      user_id: (data.military as any).id,
      type: "material_returned",
      title: "Material devolvido",
      body: "Sua devolução de material foi registrada com sucesso.",
      metadata: { lending_id: id },
    });

    return c.json(data);
  }
);
