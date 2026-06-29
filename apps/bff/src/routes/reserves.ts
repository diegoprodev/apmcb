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

// POST /api/reserves/switch/:id — switch active reserve in session (admin_global only)
reservesRoutes.post(
  "/switch/:id",
  roleGuard("admin_global", "superadmin"),
  async (c) => {
    const targetId = c.req.param("id");
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "tenant não identificado" }, 403);

    const { data: reserve } = await supabase
      .from("reserves")
      .select("id, nome, acronym")
      .eq("id", targetId)
      .eq("tenant_id", tenantId)
      .eq("status", "ativa")
      .single();

    if (!reserve) return c.json({ error: "Reserva não encontrada" }, 404);

    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    session.reserveId = reserve.id;
    await session.save();

    return c.json({ ok: true, reserve });
  }
);
