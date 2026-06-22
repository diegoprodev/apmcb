import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export const profileRoutes = new Hono<{ Variables: HonoVariables }>();

const ALL_STATUSES = z.enum([
  "complete",
  "inactive",
  "pending_biometric",
  "impedimento_administrativo",
]);

// PATCH /api/profiles/:id/status
// Admin: any status. Master: only complete / inactive / pending_biometric.
profileRoutes.patch(
  "/:id/status",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
  zValidator("json", z.object({ status: ALL_STATUSES })),
  async (c) => {
    const targetId = c.req.param("id");
    const callerRole = c.get("role");
    const callerId = c.get("userId");
    const { status } = c.req.valid("json");

    if (callerId === targetId) {
      return c.json({ error: "Não é possível alterar o próprio status." }, 403);
    }

    if (callerRole === "armeiro" && status === "impedimento_administrativo") {
      return c.json(
        { error: "Apenas administradores podem aplicar impedimento administrativo." },
        403
      );
    }

    // Fetch current status for audit trail
    const { data: current } = await supabase
      .from("profiles")
      .select("registration_status, nome_completo, role")
      .eq("id", targetId)
      .single();

    if (!current) return c.json({ error: "Usuário não encontrado." }, 404);

    // Master cannot change status of admin users
    if (callerRole === "armeiro" && current.role === "admin_global") {
      return c.json({ error: "Armeiro não pode alterar status de administrador." }, 403);
    }

    const { error } = await supabase
      .from("profiles")
      .update({ registration_status: status })
      .eq("id", targetId);

    if (error) return c.json({ error: error.message }, 500);

    // Audit log
    await supabase.from("audit_logs").insert({
      actor_id: callerId,
      action: "profile.status_changed",
      resource_type: "profiles",
      resource_id: targetId,
      metadata: {
        status_anterior: current.registration_status,
        status_novo: status,
        nome: current.nome_completo,
      },
    });

    // Notify the affected user on impactful transitions
    if (
      status === "inactive" ||
      status === "impedimento_administrativo"
    ) {
      const title =
        status === "impedimento_administrativo"
          ? "Impedimento Administrativo Aplicado"
          : "Conta Desativada";
      const body =
        status === "impedimento_administrativo"
          ? "Seu acesso ao armamento foi suspenso por impedimento administrativo. Em caso de dúvidas, procure o Departamento de Pessoas de sua unidade."
          : "Sua conta foi desativada. Entre em contato com o administrador.";

      await supabase
        .from("notifications")
        .insert({
          user_id: targetId,
          type: status === "impedimento_administrativo" ? "account_blocked" : "account_deactivated",
          title,
          body,
        });
    }

    return c.json({ ok: true, status });
  }
);
