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
        id, tenant_id, reserve_id, nome, slug, description,
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
