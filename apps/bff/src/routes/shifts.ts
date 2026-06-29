import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createHash } from "node:crypto";
import { supabase } from "../services/supabase";
import { roleGuard } from "../middleware/role-guard";
import { logShiftEvent } from "../lib/shift-events";
import type { HonoVariables } from "../types/hono";

export const shiftsRoutes = new Hono<{ Variables: HonoVariables }>();

// ── Schemas Zod ──────────────────────────────────────────────────────────────

const OpenShiftSchema = z.object({
  reserve_id: z.string().uuid(),
  observacao_abertura: z.string().max(500).optional(),
});

const LogEventSchema = z.object({
  description: z.string().min(1).max(1000),
  event_type: z.enum(["ocorrencia_registrada", "evento_manual"]),
  is_pending: z.boolean().default(false),
  metadata: z.record(z.unknown()).default({}),
});

const CloseShiftSchema = z.object({
  observacao_encerramento: z.string().max(500).optional(),
  handover_id: z.string().uuid().optional(),
});

// ── POST /api/shifts/open — Abrir turno ──────────────────────────────────────

shiftsRoutes.post(
  "/open",
  roleGuard("armeiro"),
  zValidator("json", OpenShiftSchema),
  async (c) => {
    const userId   = c.get("userId");
    let tenantId   = c.get("tenantId");
    const { reserve_id, observacao_abertura } = c.req.valid("json");

    // Se tenantId não está na sessão, resolve via reserve (fallback)
    if (!tenantId) {
      const { data: reserve } = await supabase
        .from("reserves")
        .select("tenant_id")
        .eq("id", reserve_id)
        .maybeSingle();
      tenantId = reserve?.tenant_id ?? null;
    }
    if (!tenantId) {
      return c.json({ error: "Tenant não encontrado para esta reserva" }, 400);
    }

    // Verificar se já existe turno ativo
    const { data: existing } = await supabase
      .from("service_shifts")
      .select("id")
      .eq("armeiro_id", userId)
      .eq("status", "ativo")
      .maybeSingle();

    if (existing) {
      return c.json({ error: "Já existe um turno ativo. Encerre-o antes de abrir outro." }, 409);
    }

    // Gerar snapshot de abertura
    const snapshot = await generateOpeningSnapshot(tenantId, reserve_id);

    const { data: shift, error } = await supabase
      .from("service_shifts")
      .insert({
        tenant_id: tenantId,
        reserve_id,
        armeiro_id: userId,
        opening_snapshot: snapshot,
        status: "ativo",
      })
      .select("*")
      .single();

    if (error || !shift) {
      return c.json({ error: error?.message ?? "Erro ao abrir turno" }, 500);
    }

    // Registrar evento de abertura
    await logShiftEvent({
      actorId:     userId,
      tenantId:    tenantId!,
      eventType:   "turno_assumido",
      description: observacao_abertura
        ? `Turno assumido. ${observacao_abertura}`
        : "Turno assumido.",
    });

    return c.json({ ok: true, shift }, 201);
  }
);

// ── GET /api/shifts/active — Turno ativo do usuário logado ──────────────────

shiftsRoutes.get(
  "/active",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  async (c) => {
    const userId = c.get("userId");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select(`
        *,
        reserve:reserves(id, nome),
        armeiro:profiles!service_shifts_armeiro_id_fkey(id, nome_completo, matricula, posto)
      `)
      .eq("armeiro_id", userId)
      .eq("status", "ativo")
      .maybeSingle();

    return c.json({ shift: shift ?? null });
  }
);

// ── GET /api/shifts/:id/events — Eventos do turno ───────────────────────────

shiftsRoutes.get(
  "/:id/events",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const tenantId = c.get("tenantId");
    const { type, pending_only } = c.req.query();

    // Verificar acesso ao turno
    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id, armeiro_id, tenant_id")
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.tenant_id !== tenantId) return c.json({ error: "Acesso negado" }, 403);
    if (role === "armeiro" && shift.armeiro_id !== userId) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    let query = supabase
      .from("service_log_events")
      .select(`
        id, happened_at, event_type, description, metadata,
        is_pending, resolved_at, prev_hash, event_hash,
        actor:profiles!service_log_events_actor_id_fkey(id, nome_completo, matricula, posto)
      `)
      .eq("shift_id", shiftId)
      .order("happened_at", { ascending: true });

    if (type) query = query.eq("event_type", type);
    if (pending_only === "true") {
      query = query.eq("is_pending", true).is("resolved_at", null);
    }

    const { data: events, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    return c.json({ events: events ?? [] });
  }
);

// ── GET /api/shifts/:id/pending — Pendências abertas ────────────────────────

shiftsRoutes.get(
  "/:id/pending",
  roleGuard("armeiro", "admin_reserva", "admin_global"),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const tenantId = c.get("tenantId");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id, armeiro_id, tenant_id")
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.tenant_id !== tenantId) return c.json({ error: "Acesso negado" }, 403);
    if (role === "armeiro" && shift.armeiro_id !== userId) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    const { data: pending } = await supabase
      .from("service_log_events")
      .select("id, happened_at, event_type, description, metadata")
      .eq("shift_id", shiftId)
      .eq("is_pending", true)
      .is("resolved_at", null)
      .order("happened_at", { ascending: true });

    return c.json({ pending: pending ?? [], count: (pending ?? []).length });
  }
);

// ── POST /api/shifts/:id/log — Registrar evento manual ──────────────────────

shiftsRoutes.post(
  "/:id/log",
  roleGuard("armeiro"),
  zValidator("json", LogEventSchema),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const tenantId = c.get("tenantId");
    const body     = c.req.valid("json");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id, armeiro_id, status")
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.armeiro_id !== userId) return c.json({ error: "Acesso negado" }, 403);
    if (shift.status !== "ativo") return c.json({ error: "Turno não está ativo" }, 422);

    await logShiftEvent({
      actorId:     userId,
      tenantId:    tenantId!,
      eventType:   body.event_type,
      description: body.description,
      isPending:   body.is_pending,
      metadata:    body.metadata,
    });

    return c.json({ ok: true });
  }
);

// ── POST /api/shifts/:id/close — Encerrar turno ─────────────────────────────

shiftsRoutes.post(
  "/:id/close",
  roleGuard("armeiro"),
  zValidator("json", CloseShiftSchema),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const tenantId = c.get("tenantId");
    const { observacao_encerramento, handover_id } = c.req.valid("json");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select("id, armeiro_id, status, reserve_id")
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.armeiro_id !== userId) return c.json({ error: "Acesso negado" }, 403);
    if (shift.status !== "ativo") return c.json({ error: "Turno já encerrado" }, 422);

    const closingSnapshot = await generateOpeningSnapshot(tenantId, shift.reserve_id as string);

    await supabase.from("service_shifts").update({
      status:           "encerrado",
      ended_at:         new Date().toISOString(),
      closing_snapshot: closingSnapshot,
      handover_id:      handover_id ?? null,
    }).eq("id", shiftId);

    await logShiftEvent({
      actorId:     userId,
      tenantId:    tenantId!,
      eventType:   "turno_encerrado",
      description: observacao_encerramento
        ? `Turno encerrado. ${observacao_encerramento}`
        : "Turno encerrado.",
    });

    return c.json({ ok: true });
  }
);

// ── GET /api/shifts — Listar turnos (admin) ──────────────────────────────────

shiftsRoutes.get(
  "/",
  roleGuard("admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const tenantId = c.get("tenantId");
    if (!tenantId) return c.json({ error: "Tenant não identificado na sessão" }, 403);

    const { status, armeiro_id, from, to } = c.req.query();

    let query = supabase
      .from("service_shifts")
      .select(`
        id, status, started_at, ended_at, pending_count,
        reserve:reserves(id, nome),
        armeiro:profiles!service_shifts_armeiro_id_fkey(id, nome_completo, matricula, posto)
      `)
      .eq("tenant_id", tenantId)
      .order("started_at", { ascending: false })
      .limit(50);
    if (status)     query = query.eq("status", status);
    if (armeiro_id) query = query.eq("armeiro_id", armeiro_id);
    if (from)       query = query.gte("started_at", from);
    if (to)         query = query.lte("started_at", to);

    const { data: shifts, error } = await query;
    if (error) return c.json({ error: error.message }, 500);

    return c.json({ shifts: shifts ?? [] });
  }
);

// ── GET /api/shifts/:id — Detalhe de turno ──────────────────────────────────

shiftsRoutes.get(
  "/:id",
  roleGuard("armeiro", "admin_reserva", "admin_global", "auditor"),
  async (c) => {
    const shiftId  = c.req.param("id");
    const userId   = c.get("userId");
    const role     = c.get("role");
    const tenantId = c.get("tenantId");

    const { data: shift } = await supabase
      .from("service_shifts")
      .select(`
        *,
        reserve:reserves(id, nome),
        armeiro:profiles!service_shifts_armeiro_id_fkey(id, nome_completo, matricula, posto)
      `)
      .eq("id", shiftId)
      .maybeSingle();

    if (!shift) return c.json({ error: "Turno não encontrado" }, 404);
    if (shift.tenant_id !== tenantId) return c.json({ error: "Acesso negado" }, 403);
    if (role === "armeiro" && shift.armeiro_id !== userId) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    return c.json({ shift });
  }
);

// ── Helper: snapshot de abertura/encerramento ────────────────────────────────

async function generateOpeningSnapshot(
  tenantId: string | null,
  reserveId: string
): Promise<Record<string, unknown>> {
  const [itemsRes, cautelasRes, saidasRes] = await Promise.all([
    supabase
      .from("material_items")
      .select("status_operacional, material_type:material_types(nome, categoria)")
      .eq("reserve_id", reserveId),
    supabase
      .from("cautelamentos")
      .select("id")
      .eq("reserve_id", reserveId)
      .eq("status", "ativa"),
    supabase
      .from("lendings")
      .select("id")
      .eq("reserve_id", reserveId)
      .eq("status", "aberta"),
  ]);

  const items = itemsRes.data ?? [];
  const byStatus: Record<string, number> = {};
  for (const item of items) {
    byStatus[item.status_operacional] = (byStatus[item.status_operacional] ?? 0) + 1;
  }

  return {
    generated_at:       new Date().toISOString(),
    total_itens:        items.length,
    por_status:         byStatus,
    cautelas_ativas:    (cautelasRes.data ?? []).length,
    saidas_abertas:     (saidasRes.data ?? []).length,
  };
}
