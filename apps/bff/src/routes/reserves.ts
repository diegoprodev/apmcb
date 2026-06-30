import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import type { HonoVariables } from "../types/hono";

export const reservesRoutes = new Hono<{ Variables: HonoVariables }>();

// GET /api/reserves/mine — reserves accessible to the user
reservesRoutes.get(
  "/mine",
  roleGuard("admin_global", "superadmin", "admin_reserva", "armeiro", "auditor", "usuario"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const role = c.get("role");
    if (!tenantId) return c.json({ error: "tenant não identificado" }, 403);

    // Roles com acesso global ou usuario (pode requisitar de qualquer reserva do tenant)
    if (role === "admin_global" || role === "superadmin" || role === "auditor" || role === "usuario") {
      const { data } = await supabase
        .from("reserves")
        .select("id, nome, acronym, logo_url, status")
        .eq("tenant_id", tenantId)
        .eq("status", "ativa")
        .order("nome");
      return c.json({ reserves: data ?? [] });
    }

    if (!reserveId) return c.json({ reserves: [] });
    const { data } = await supabase
      .from("reserves")
      .select("id, nome, acronym, logo_url, status")
      .eq("id", reserveId)
      .eq("tenant_id", tenantId)
      .single();
    return c.json({ reserves: data ? [data] : [] });
  }
);

// POST /api/reserves/switch/:id — switch active reserve in session
// admin_global/superadmin: qualquer reserva ativa do tenant
// armeiro/admin_reserva: apenas reservas com membership do próprio usuário
reservesRoutes.post(
  "/switch/:id",
  roleGuard("admin_global", "superadmin", "armeiro", "admin_reserva"),
  async (c) => {
    const targetId = c.req.param("id");
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId");
    const role     = c.get("role");
    if (!tenantId) return c.json({ error: "tenant não identificado" }, 403);

    // Verifica que a reserva existe e pertence ao tenant
    const { data: reserve } = await supabase
      .from("reserves")
      .select("id, nome, acronym")
      .eq("id", targetId)
      .eq("tenant_id", tenantId)
      .eq("status", "ativa")
      .single();

    if (!reserve) return c.json({ error: "Reserva não encontrada" }, 404);

    // Para armeiro/admin_reserva: validar membership na reserva de destino
    if (role === "armeiro" || role === "admin_reserva") {
      const { data: membership } = await supabase
        .from("reserve_memberships")
        .select("id")
        .eq("user_id", userId)
        .eq("reserve_id", targetId)
        .maybeSingle();

      if (!membership) return c.json({ error: "Sem permissão para esta reserva" }, 403);
    }

    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    session.reserveId = reserve.id;
    await session.save();

    return c.json({ ok: true, reserve });
  }
);

// PATCH /api/reserves/:id/settings — configurar acesso remoto SSA
// admin_reserva: apenas a própria reserva; admin_global: qualquer reserva do tenant
// superadmin NÃO tem controle estrutural — apenas provisiona tenants (Nexus)
reservesRoutes.patch(
  "/:id/settings",
  roleGuard("admin_reserva", "admin_global"),
  async (c) => {
    const targetId  = c.req.param("id");
    const tenantId  = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const role      = c.get("role");

    if (!tenantId) return c.json({ error: "tenant não identificado" }, 403);

    const { data: reserve } = await supabase
      .from("reserves")
      .select("id, nome, tenant_id, allow_remote_requests")
      .eq("id", targetId)
      .eq("tenant_id", tenantId)
      .single();

    if (!reserve) return c.json({ error: "Reserva não encontrada" }, 404);

    if (role === "admin_reserva" && reserve.id !== reserveId) {
      return c.json({ error: "Acesso negado à reserva" }, 403);
    }

    const body = await c.req.json<{ allow_remote_requests: boolean }>();
    if (typeof body.allow_remote_requests !== "boolean") {
      return c.json({ error: "allow_remote_requests deve ser boolean" }, 400);
    }

    const { data: updated, error } = await supabase
      .from("reserves")
      .update({ allow_remote_requests: body.allow_remote_requests })
      .eq("id", targetId)
      .select("id, nome, allow_remote_requests")
      .single();

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ ok: true, reserve: updated });
  }
);
