import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import {
  MATERIAL_VALIDITY_ALERT_DAYS,
  getMaterialCategoryDefaults,
  normalizeMaterialCategory,
} from "../lib/material-metadata";
import type { HonoVariables } from "../types/hono";

export const categoriesRoutes = new Hono<{ Variables: HonoVariables }>();

const CategorySchema = z.object({
  nome: z.string().min(1).max(80).trim(),
  description: z.string().max(500).optional().nullable(),
  icon: z.string().max(40).optional().nullable(),
  requires_caliber: z.boolean().optional(),
  requires_validity: z.boolean().optional(),
  default_has_serial_numbers: z.boolean().optional(),
  validity_alert_days: z.array(z.number().int()).optional().nullable(),
  requires_vehicle_fields: z.boolean().optional(),
});

function normalizeCategoryBody(body: z.infer<typeof CategorySchema>) {
  const category = normalizeMaterialCategory(body.nome);
  const defaults = getMaterialCategoryDefaults(category.slug);
  const requiresValidity = body.requires_validity ?? defaults.requires_validity;
  const alertDays = requiresValidity
    ? (body.validity_alert_days?.length ? body.validity_alert_days : [...MATERIAL_VALIDITY_ALERT_DAYS])
    : [];
  const invalidAlert = alertDays.find((day) =>
    !MATERIAL_VALIDITY_ALERT_DAYS.includes(day as 365 | 180 | 90)
  );
  if (invalidAlert) return { ok: false as const, error: "Marco de alerta de validade invalido" };

  return {
    ok: true as const,
    value: {
      nome: category.label,
      slug: category.slug,
      description: body.description?.trim() || null,
      icon: body.icon ?? null,
      requires_caliber: body.requires_caliber ?? defaults.requires_caliber,
      requires_validity: requiresValidity,
      default_has_serial_numbers: body.default_has_serial_numbers ?? defaults.default_has_serial_numbers,
      validity_alert_days: alertDays,
      requires_vehicle_fields: body.requires_vehicle_fields ?? defaults.requires_vehicle_fields,
    },
  };
}

categoriesRoutes.get(
  "/",
  roleGuard("admin_global", "superadmin", "armeiro", "admin_reserva", "auditor", "usuario"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    if (!tenantId) return c.json({ error: "tenant nao encontrado" }, 400);

    let query = supabase
      .from("material_categories")
      .select(`
        id, tenant_id, reserve_id, nome, slug, description, icon,
        requires_caliber, requires_validity, default_has_serial_numbers,
        validity_alert_days, requires_vehicle_fields, active, created_at, created_by
      `)
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("nome");

    if (reserveId) query = query.or(`reserve_id.eq.${reserveId},reserve_id.is.null`);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ categories: data ?? [] });
  }
);

categoriesRoutes.post(
  "/",
  roleGuard("admin_reserva"),
  zValidator("json", CategorySchema),
  async (c) => {
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const userId = c.get("userId");
    if (!tenantId) return c.json({ error: "tenant nao encontrado" }, 400);
    if (!reserveId) return c.json({ error: "reserva nao encontrada" }, 400);

    const normalized = normalizeCategoryBody(c.req.valid("json"));
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);

    const { data, error } = await supabase
      .from("material_categories")
      .insert({
        tenant_id: tenantId,
        reserve_id: reserveId,
        ...normalized.value,
        created_by: userId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return c.json({ error: "Categoria ja existe" }, 409);
      return c.json({ error: error.message }, 500);
    }
    return c.json({ category: data }, 201);
  }
);

categoriesRoutes.patch(
  "/:id",
  roleGuard("admin_reserva"),
  zValidator("json", CategorySchema),
  async (c) => {
    const id = c.req.param("id");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    if (!tenantId || !reserveId) return c.json({ error: "escopo nao encontrado" }, 400);

    const normalized = normalizeCategoryBody(c.req.valid("json"));
    if (!normalized.ok) return c.json({ error: normalized.error }, 400);

    const { data, error } = await supabase
      .from("material_categories")
      .update({ ...normalized.value, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .eq("reserve_id", reserveId)
      .select()
      .single();

    if (error) return c.json({ error: error.message }, 500);
    if (!data) return c.json({ error: "Categoria nao encontrada" }, 404);
    return c.json({ category: data });
  }
);

categoriesRoutes.delete(
  "/:id",
  roleGuard("admin_reserva"),
  async (c) => {
    const id = c.req.param("id");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");

    const { data: cat } = await supabase
      .from("material_categories")
      .select("id, nome, slug, tenant_id, reserve_id")
      .eq("id", id)
      .single();

    if (!cat || cat.tenant_id !== tenantId || cat.reserve_id !== reserveId) {
      return c.json({ error: "Categoria nao encontrada" }, 404);
    }

    const { count } = await supabase
      .from("material_types")
      .select("id", { count: "exact", head: true })
      .or(`category_id.eq.${cat.id},categoria_slug.eq.${cat.slug}`)
      .eq("tenant_id", tenantId)
      .eq("reserve_id", reserveId)
      .eq("ativo", true);

    if ((count ?? 0) > 0) {
      return c.json({
        error: `Nao e possivel remover: ${count} tipo(s) de material usam esta categoria`,
      }, 409);
    }

    await supabase.from("material_categories").update({ active: false }).eq("id", id);
    return c.json({ ok: true });
  }
);

// ── Category Requests (armeiro solicita, admin aprova) ─────────────────────

const CategoryRequestSchema = z.object({
  nome: z.string().min(1).max(80).trim(),
  slug: z.string().min(1).max(80).trim().optional(),
  icon: z.string().max(40).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
});

// POST /api/categories/request — armeiro cria solicitação
categoriesRoutes.post(
  "/request",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  zValidator("json", CategoryRequestSchema),
  async (c) => {
    const userId = c.get("userId");
    const reserveId = c.get("reserveId");
    if (!reserveId) return c.json({ error: "reserva nao encontrada" }, 400);

    const body = c.req.valid("json");
    const category = normalizeMaterialCategory(body.nome);
    const slug = body.slug ?? category.slug;

    const { data, error } = await supabase
      .from("category_requests")
      .insert({
        reserve_id: reserveId,
        requested_by: userId,
        nome: category.label,
        slug,
        icon: body.icon ?? null,
        description: body.description?.trim() || null,
        status: "pendente",
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return c.json({ error: "Solicitacao ja existe" }, 409);
      return c.json({ error: error.message }, 500);
    }
    return c.json({ request: data }, 201);
  }
);

// GET /api/categories/requests — admin lista pendentes
categoriesRoutes.get(
  "/requests",
  roleGuard("admin_global", "admin_reserva", "superadmin"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    if (!tenantId) return c.json({ error: "tenant nao encontrado" }, 400);

    let query = supabase
      .from("category_requests")
      .select(`
        id, nome, slug, icon, description, status,
        created_at, reviewed_at, rejection_reason,
        requested_by:profiles!requested_by(nome_completo, matricula),
        reviewed_by:profiles!reviewed_by(nome_completo),
        reserve:reserves(nome)
      `)
      .order("created_at", { ascending: false });

    if (reserveId) query = query.eq("reserve_id", reserveId);

    const { data, error } = await query;
    if (error) return c.json({ error: error.message }, 500);
    return c.json({ requests: data ?? [] });
  }
);

// POST /api/categories/requests/:id/approve — admin aprova
categoriesRoutes.post(
  "/requests/:id/approve",
  roleGuard("admin_global", "admin_reserva", "superadmin"),
  async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    if (!tenantId || !reserveId) return c.json({ error: "escopo nao encontrado" }, 400);

    const { data: req } = await supabase
      .from("category_requests")
      .select("id, nome, slug, icon, description, reserve_id, status")
      .eq("id", id)
      .maybeSingle();

    if (!req) return c.json({ error: "Solicitacao nao encontrada" }, 404);
    if (req.status !== "pendente") return c.json({ error: "Solicitacao ja processada" }, 409);

    const defaults = getMaterialCategoryDefaults(req.slug);

    const [{ error: catError }, { error: reqError }] = await Promise.all([
      supabase.from("material_categories").insert({
        tenant_id: tenantId,
        reserve_id: req.reserve_id,
        nome: req.nome,
        slug: req.slug,
        icon: req.icon,
        description: req.description,
        requires_caliber: defaults.requires_caliber,
        requires_validity: defaults.requires_validity,
        default_has_serial_numbers: defaults.default_has_serial_numbers,
        validity_alert_days: defaults.requires_validity ? [...MATERIAL_VALIDITY_ALERT_DAYS] : [],
        requires_vehicle_fields: defaults.requires_vehicle_fields,
        active: true,
        created_by: userId,
      }),
      supabase.from("category_requests").update({
        status: "aprovado",
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", id),
    ]);

    if (catError?.code === "23505") return c.json({ error: "Categoria ja existe" }, 409);
    if (catError) return c.json({ error: catError.message }, 500);
    if (reqError) return c.json({ error: reqError.message }, 500);

    return c.json({ ok: true });
  }
);

// POST /api/categories/requests/:id/reject — admin rejeita
categoriesRoutes.post(
  "/requests/:id/reject",
  roleGuard("admin_global", "admin_reserva", "superadmin"),
  zValidator("json", z.object({ reason: z.string().max(300).optional() })),
  async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const { reason } = c.req.valid("json");

    const { error } = await supabase.from("category_requests").update({
      status: "rejeitado",
      reviewed_by: userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", id).eq("status", "pendente");

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ ok: true });
  }
);
