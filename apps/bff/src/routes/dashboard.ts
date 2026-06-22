import { Hono } from "hono";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const dashboardRoutes = new Hono<{ Variables: HonoVariables }>();

dashboardRoutes.get("/stats", roleGuard("admin_global", "armeiro", "admin_reserva"), async (c) => {
  const [activeCount, pendingCount, materialsResult, profilesCount] =
    await Promise.all([
      supabase
        .from("lendings")
        .select("*", { count: "exact", head: true })
        .eq("status_legacy", "ativo"),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("registration_status", "pending_biometric"),
      supabase.from("material_availability").select("*"),
      supabase
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .eq("role", "usuario"),
    ]);

  const lowStock = (materialsResult.data ?? []).filter(
    (m) => m.quantidade_disponivel <= 3
  );

  return c.json({
    total_armados: activeCount.count ?? 0,
    cadastros_pendentes: pendingCount.count ?? 0,
    total_militares: profilesCount.count ?? 0,
    materiais_estoque_baixo: lowStock,
    materiais: materialsResult.data ?? [],
  });
});
