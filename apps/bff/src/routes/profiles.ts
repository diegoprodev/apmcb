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

// PATCH /api/profiles/:id — full profile update (name, posto, etc.)
profileRoutes.patch(
  "/:id",
  roleGuard("admin_global", "superadmin", "armeiro", "admin_reserva"),
  zValidator("json", z.object({
    nome_completo:    z.string().min(1).optional(),
    posto:            z.string().nullable().optional(),
    nome_de_guerra:   z.string().nullable().optional(),
    unidade:          z.string().nullable().optional(),
    telefone:         z.string().nullable().optional(),
    registration_status: ALL_STATUSES.optional(),
  })),
  async (c) => {
    const targetId   = c.req.param("id");
    const callerId   = c.get("userId");
    const callerRole = c.get("role");
    const tenantId   = c.get("tenantId");
    const body       = c.req.valid("json");

    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 400);

    // Only admin_global/superadmin can change registration_status
    if (body.registration_status && callerRole === "armeiro" && body.registration_status === "impedimento_administrativo") {
      return c.json({ error: "Apenas administradores podem aplicar impedimento administrativo." }, 403);
    }

    const updatePayload: Record<string, unknown> = {};
    if (body.nome_completo    !== undefined) updatePayload.nome_completo    = body.nome_completo;
    if (body.posto            !== undefined) updatePayload.posto            = body.posto;
    if (body.nome_de_guerra   !== undefined) updatePayload.nome_de_guerra   = body.nome_de_guerra;
    if (body.unidade          !== undefined) updatePayload.unidade          = body.unidade;
    if (body.telefone         !== undefined) updatePayload.telefone         = body.telefone;
    if (body.registration_status !== undefined) updatePayload.registration_status = body.registration_status;

    if (Object.keys(updatePayload).length === 0) {
      return c.json({ error: "Nenhum campo para atualizar." }, 400);
    }

    const { error } = await supabase
      .from("profiles")
      .update(updatePayload)
      .eq("id", targetId)
      .eq("tenant_id", tenantId);

    if (error) return c.json({ error: error.message }, 500);

    // Audit only if status changed
    if (body.registration_status) {
      await supabase.from("audit_logs").insert({
        actor_id: callerId,
        action: "profile.updated",
        resource_type: "profiles",
        resource_id: targetId,
        metadata: { fields: Object.keys(updatePayload) },
      });
    }

    return c.json({ ok: true });
  }
);

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

    const callerTenantId = c.get("tenantId");
    const { error } = await supabase
      .from("profiles")
      .update({ registration_status: status })
      .eq("id", targetId)
      .eq("tenant_id", callerTenantId!);

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
