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

// POST /api/reserves/switch/matriz — admin_global/auditor voltam à visão de tenant.
// REGISTRADA ANTES de /switch/:id (senão :id captura "matriz").
reservesRoutes.post(
  "/switch/matriz",
  roleGuard("admin_global", "auditor"),
  async (c) => {
    const userId = c.get("userId");
    const log = c.get("log");
    if (!userId) return c.json({ error: "não autenticado" }, 401);

    const { error } = await supabase.from("profiles").update({ active_reserve_id: null }).eq("id", userId);
    if (error) {
      log.error({ userId, err: error.message }, "reserve.matriz.failed");
      return c.json({ error: "Não foi possível voltar à matriz" }, 500);
    }

    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    session.reserveId = null;
    await session.save();

    log.info({ userId }, "reserve.matriz.entered");
    return c.json({ ok: true });
  }
);

// POST /api/reserves/switch/:id — troca a reserva ativa.
// admin_global/auditor: qualquer reserva ativa do tenant (matriz → filial)
// armeiro/admin_reserva/usuario: apenas reservas com membership próprio
// (superadmin não participa: é Nexus/SaaS-only, sem reserva de tenant)
//
// Fonte de verdade do RLS (a partir de SP5): profiles.active_reserve_id. O
// switch grava a COLUNA (via service_role → passa pelo trigger
// profiles_validate_active_reserve como belt) e espelha em session.reserveId.
reservesRoutes.post(
  "/switch/:id",
  roleGuard("admin_global", "armeiro", "admin_reserva", "auditor", "usuario"),
  async (c) => {
    const targetId = c.req.param("id");
    const tenantId = c.get("tenantId");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const log      = c.get("log");
    if (!tenantId || !userId) return c.json({ error: "tenant não identificado" }, 403);

    const { data: reserve } = await supabase
      .from("reserves")
      .select("id, nome, acronym")
      .eq("id", targetId)
      .eq("tenant_id", tenantId)
      .eq("status", "ativa")
      .single();

    if (!reserve) {
      log.warn({ userId, targetId, reason: "not_found" }, "reserve.switch.denied");
      return c.json({ error: "Reserva não encontrada" }, 404);
    }

    if (role !== "admin_global" && role !== "auditor") {
      const { data: membership } = await supabase
        .from("reserve_memberships")
        .select("id")
        .eq("user_id", userId)
        .eq("reserve_id", targetId)
        .maybeSingle();

      if (!membership) {
        log.warn({ userId, targetId, reason: "not_member" }, "reserve.switch.denied");
        return c.json({ error: "Sem permissão para esta reserva" }, 403);
      }
    }

    const { error: updErr } = await supabase
      .from("profiles")
      .update({ active_reserve_id: reserve.id })
      .eq("id", userId);
    if (updErr) {
      log.error({ userId, targetId, err: updErr.message }, "reserve.switch.failed");
      return c.json({ error: "Não foi possível trocar de reserva" }, 500);
    }

    // bump de preferência — best-effort, não bloqueia. SP2: RPC
    // bump_reserve_preference incrementa selection_count de verdade (o upsert
    // antigo gravava 1 fixo — o ranking do resolvedor degradava pra MRU puro).
    void supabase
      .rpc("bump_reserve_preference", { p_user_id: userId, p_reserve_id: reserve.id })
      .then(
        ({ error }) => { if (error) log.warn({ userId, targetId, err: error.message }, "reserve.preference.bump_failed"); },
        (e) => log.warn({ userId, targetId, err: String(e) }, "reserve.preference.bump_failed"),
      );

    const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
    session.reserveId = reserve.id;
    await session.save();

    log.info({ userId, targetId }, "reserve.switch.ok");
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
