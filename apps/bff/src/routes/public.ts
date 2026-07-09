import { Hono } from "hono";
import { supabase } from "../services/supabase";
import { logger } from "../lib/logger";
import { getClientIp } from "../middleware/rate-limit";
import type { HonoVariables } from "../types/hono";

// ── GET /api/public/shifts/:id/verify — Verificação pública do Livro Digital ──
// Sem autenticação (rota pública, alvo do QR code impresso no PDF do turno).
// Rate-limited via routeRateLimiter (30 req/min/IP — ver middleware/rate-limit.ts).
//
// PII: matrícula é o próprio username de login (ver get_email_by_matricula em
// auth.ts) — qualquer um com o PDF/QR consegue identificar um usuário válido
// sem autenticação. Por isso a resposta pública NUNCA inclui matrícula, só
// nome/posto (suficiente para conferência humana do documento).
export const publicRoutes = new Hono<{ Variables: HonoVariables }>();

publicRoutes.get("/shifts/:id/verify", async (c) => {
  const shiftId = c.req.param("id");
  const ip = getClientIp(c);

  const { data: shift } = await supabase
    .from("service_shifts")
    .select(`
      id, status, started_at, ended_at,
      reserve:reserves(nome, acronym),
      armeiro:profiles!service_shifts_armeiro_id_fkey(nome_completo, posto)
    `)
    .eq("id", shiftId)
    .maybeSingle();

  if (!shift) return c.json({ verified: false, error: "not_found" }, 404);

  const { data: events, error } = await supabase
    .from("service_log_events")
    .select("happened_at, event_type, event_hash, prev_hash")
    .eq("shift_id", shiftId)
    .order("happened_at", { ascending: true });

  if (error) {
    logger.error("public.shift_verify.events_query_failure", { shift_id: shiftId, error: error.message });
    return c.json({ verified: false, error: "internal_error" }, 500);
  }

  const rootHash = events && events.length > 0 ? events[events.length - 1].event_hash : null;

  // Log de acesso — não é auditoria de negócio (sem actor autenticado), apenas rastro operacional.
  await supabase.from("audit_logs").insert({
    actor_id: null,
    action: "shift_verified_public",
    resource_type: "service_shifts",
    resource_id: shiftId,
    metadata: { ip },
  });

  const raw = shift as unknown as Record<string, unknown>;
  const reserve = Array.isArray(raw["reserve"]) ? raw["reserve"][0] : raw["reserve"];
  const armeiro = Array.isArray(raw["armeiro"]) ? raw["armeiro"][0] : raw["armeiro"];

  return c.json({
    verified: true,
    shift_id: shift.id,
    status: shift.status,
    started_at: shift.started_at,
    ended_at: shift.ended_at,
    reserve: reserve ?? null,
    armeiro: armeiro ?? null,
    event_count: events?.length ?? 0,
    root_hash: rootHash,
    events: (events ?? []).map((e) => ({
      happened_at: e.happened_at,
      event_type: e.event_type,
      event_hash: e.event_hash,
      prev_hash: e.prev_hash,
    })),
  });
});
