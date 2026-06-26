import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const categoriesRoutes = new Hono<{ Variables: HonoVariables }>();

// GET /api/categories — listar categorias do tenant
categoriesRoutes.get(
  "/",
  roleGuard("admin_global", "superadmin", "armeiro", "admin_reserva", "auditor", "usuario"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "tenant não encontrado" }, 400);

    const { data, error } = await supabase
      .from("material_categories")
      .select("id, nome, created_at, created_by")
      .eq("tenant_id", tenantId)
      .order("nome");

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ categories: data ?? [] });
  }
);

// POST /api/categories — criar nova categoria
categoriesRoutes.post(
  "/",
  roleGuard("admin_global", "superadmin"),
  zValidator("json", z.object({
    nome: z.string().min(1).max(50).trim(),
  })),
  async (c) => {
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId");
    if (!tenantId) return c.json({ error: "tenant não encontrado" }, 400);

    const { nome } = c.req.valid("json");

    const { data, error } = await supabase
      .from("material_categories")
      .insert({ tenant_id: tenantId, nome: nome.toLowerCase(), created_by: userId })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return c.json({ error: "Categoria já existe" }, 409);
      return c.json({ error: error.message }, 500);
    }
    return c.json({ category: data }, 201);
  }
);

// DELETE /api/categories/:id — remover categoria (só se sem itens)
categoriesRoutes.delete(
  "/:id",
  roleGuard("admin_global", "superadmin"),
  async (c) => {
    const id       = c.req.param("id");
    const tenantId = c.get("tenantId");

    const { data: cat } = await supabase
      .from("material_categories")
      .select("nome, tenant_id")
      .eq("id", id)
      .single();

    if (!cat || cat.tenant_id !== tenantId) return c.json({ error: "Categoria não encontrada" }, 404);

    // Verificar se existem tipos usando esta categoria
    const { count } = await supabase
      .from("material_types")
      .select("id", { count: "exact", head: true })
      .eq("categoria", cat.nome)
      .eq("tenant_id", tenantId)
      .eq("ativo", true);

    if ((count ?? 0) > 0) {
      return c.json({
        error: `Não é possível remover — ${count} tipo(s) de material usam esta categoria`,
      }, 409);
    }

    await supabase.from("material_categories").delete().eq("id", id);
    return c.json({ ok: true });
  }
);
