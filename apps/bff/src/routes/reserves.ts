import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { roleGuard } from "../middleware/role-guard";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import type { HonoVariables } from "../types/hono";

export const reservesRoutes = new Hono<{ Variables: HonoVariables }>();

// GET /api/reserves/mine — reserves accessible to the user
// Inclui allow_remote_requests, remote_allowed_categories e is_member (RR-02)
reservesRoutes.get(
  "/mine",
  roleGuard("admin_global", "admin_reserva", "armeiro", "auditor", "usuario"),
  async (c) => {
    const tenantId = c.get("tenantId");
    const reserveId = c.get("reserveId");
    const userId    = c.get("userId");
    const role = c.get("role");
    if (!tenantId) return c.json({ error: "tenant não identificado" }, 403);

    if (role === "admin_global" || role === "auditor" || role === "usuario") {
      const { data: reserves } = await supabase
        .from("reserves")
        .select("id, nome, acronym, logo_url, status, allow_remote_requests, remote_allowed_categories")
        .eq("tenant_id", tenantId)
        .eq("status", "ativa")
        .order("nome");

      if (!reserves) return c.json({ reserves: [] });

      // Para usuarios: incluir flag is_member e filtrar por acesso (RR-02)
      if (role === "usuario" && userId) {
        const { data: memberships } = await supabase
          .from("reserve_memberships")
          .select("reserve_id")
          .eq("user_id", userId);

        const memberSet = new Set((memberships ?? []).map((m) => m.reserve_id));

        const enriched = reserves
          .map((r) => ({ ...r, is_member: memberSet.has(r.id) }))
          .filter((r) => r.allow_remote_requests || r.is_member);

        return c.json({ reserves: enriched });
      }

      return c.json({ reserves: reserves.map((r) => ({ ...r, is_member: false })) });
    }

    if (!reserveId) return c.json({ reserves: [] });
    const { data } = await supabase
      .from("reserves")
      .select("id, nome, acronym, logo_url, status, allow_remote_requests, remote_allowed_categories")
      .eq("id", reserveId)
      .eq("tenant_id", tenantId)
      .single();
    return c.json({ reserves: data ? [{ ...data, is_member: true }] : [] });
  }
);

// POST /api/reserves/switch/:id — switch active reserve in session
// admin_global: qualquer reserva ativa do tenant
// armeiro/admin_reserva: apenas reservas com membership do próprio usuário
// (superadmin não participa: é Nexus/SaaS-only, sem reserva de tenant)
reservesRoutes.post(
  "/switch/:id",
  roleGuard("admin_global", "armeiro", "admin_reserva"),
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

    const body = await c.req.json<{
      allow_remote_requests?: boolean; remote_allowed_categories?: string[];
      cautela_alert_dias_antes?: number[]; material_validity_alert_dias_padrao?: number[];
    }>();

    if (body.allow_remote_requests !== undefined && typeof body.allow_remote_requests !== "boolean") {
      return c.json({ error: "allow_remote_requests deve ser boolean" }, 400);
    }
    if (body.remote_allowed_categories !== undefined && !Array.isArray(body.remote_allowed_categories)) {
      return c.json({ error: "remote_allowed_categories deve ser array de strings" }, 400);
    }
    // AVU-01/04 (docs/enterprise/specs/alertas-vencimento-unificado-enterprise.md):
    // janela de alerta configurável por reserva, unificada entre cautela e
    // validade de material.
    if (body.cautela_alert_dias_antes !== undefined) {
      const arr = body.cautela_alert_dias_antes;
      const valido = Array.isArray(arr) && arr.length > 0 &&
        arr.every((n) => Number.isInteger(n) && n >= 1 && n <= 365);
      if (!valido) return c.json({ error: "cautela_alert_dias_antes deve ser array não-vazio de inteiros entre 1 e 365" }, 400);
    }
    if (body.material_validity_alert_dias_padrao !== undefined) {
      // Achado CRÍTICO de code review (spec, 1ª rodada de revisão adversarial):
      // material_validity_alert_events tem CHECK (alert_days = ANY(ARRAY[90,180,365]))
      // no banco — um valor fora desse conjunto aqui abortaria
      // check_material_validade_vencimento() inteira, todo dia, silenciosamente,
      // no primeiro material que batesse nesse dia. Restrito ao MESMO conjunto
      // fechado que material_types.validity_alert_days já usa hoje.
      const arr = body.material_validity_alert_dias_padrao;
      const permitidos = new Set([90, 180, 365]);
      const valido = Array.isArray(arr) && arr.length > 0 && arr.every((n) => permitidos.has(n));
      if (!valido) return c.json({ error: "material_validity_alert_dias_padrao só aceita os valores 90, 180 e 365" }, 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.allow_remote_requests !== undefined) updates.allow_remote_requests = body.allow_remote_requests;
    if (body.remote_allowed_categories !== undefined) updates.remote_allowed_categories = body.remote_allowed_categories;
    if (body.cautela_alert_dias_antes !== undefined) updates.cautela_alert_dias_antes = body.cautela_alert_dias_antes;
    if (body.material_validity_alert_dias_padrao !== undefined) updates.material_validity_alert_dias_padrao = body.material_validity_alert_dias_padrao;

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "Nenhum campo válido para atualizar" }, 400);
    }

    const { data: updated, error } = await supabase
      .from("reserves")
      .update(updates)
      .eq("id", targetId)
      .select("id, nome, allow_remote_requests, remote_allowed_categories, cautela_alert_dias_antes, material_validity_alert_dias_padrao")
      .single();

    if (error) return c.json({ error: error.message }, 500);
    return c.json({ ok: true, reserve: updated });
  }
);
