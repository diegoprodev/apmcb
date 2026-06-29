import type { Context } from "hono";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";
import { computeEventHash, getLastEventHash } from "../lib/audit-hash";

interface AuditPayload {
  action: string;
  resource_type: string;
  resource_id?: string | null;
  before_snapshot?: unknown;
  after_snapshot?: unknown;
  metadata?: Record<string, unknown>;
}

/**
 * Audit logging with SHA-256 hash chain.
 * Returns a Promise — can be awaited for guaranteed delivery or called
 * fire-and-forget. On Supabase failure, always emits a structured log line
 * to stdout so events are never silently lost.
 */
export function auditLog(
  c: Context<{ Variables: HonoVariables }>,
  payload: AuditPayload
): Promise<void> {
  const actorId   = c.get("userId");
  const actorRole = c.get("role");
  const tenantId  = c.get("tenantId") ?? null;

  if (!actorId || !actorRole) return Promise.resolve();

  const ip        = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null;
  const userAgent = c.req.header("user-agent") ?? null;

  return _persistAuditEvent({ actorId, actorRole, tenantId, ip, userAgent }, payload);
}

/**
 * Direct audit call for routes where context variables are not yet populated
 * (e.g., auth.ts during login, before session is stored in context).
 */
export function auditLogDirect(
  params: {
    actorId: string | null;
    actorRole: string | null;
    tenantId: string | null;
    ip: string | null;
    userAgent: string | null;
  },
  payload: AuditPayload
): Promise<void> {
  if (!params.actorId || !params.actorRole) return Promise.resolve();
  return _persistAuditEvent({
    actorId: params.actorId,
    actorRole: params.actorRole,
    tenantId: params.tenantId,
    ip: params.ip,
    userAgent: params.userAgent,
  }, payload);
}

async function _persistAuditEvent(
  actor: { actorId: string; actorRole: string; tenantId: string | null; ip: string | null; userAgent: string | null },
  payload: AuditPayload
): Promise<void> {
  try {
    const previousHash = await getLastEventHash(supabase, actor.tenantId);
    const createdAt    = new Date().toISOString();

    const hashInput = {
      seq: 0,
      actor_id:        actor.actorId,
      action:          payload.action,
      resource_type:   payload.resource_type,
      resource_id:     payload.resource_id ?? null,
      before_snapshot: payload.before_snapshot ?? null,
      after_snapshot:  payload.after_snapshot  ?? null,
      created_at:      createdAt,
      previous_hash:   previousHash,
    };
    const event_hash = computeEventHash(hashInput);

    const { error } = await supabase.from("audit_events").insert({
      tenant_id:       actor.tenantId,
      actor_id:        actor.actorId,
      actor_role:      actor.actorRole,
      action:          payload.action,
      resource_type:   payload.resource_type,
      resource_id:     payload.resource_id ?? null,
      before_snapshot: payload.before_snapshot ?? null,
      after_snapshot:  payload.after_snapshot  ?? null,
      metadata:        payload.metadata ?? {},
      ip:              actor.ip,
      user_agent:      actor.userAgent,
      event_hash,
      previous_hash:   previousHash,
    });

    if (error) {
      // Supabase unavailable — emit structured fallback log so event is traceable
      console.error(JSON.stringify({
        level: "error", source: "audit", msg: "audit_insert_failed",
        actor_id: actor.actorId, action: payload.action,
        resource_type: payload.resource_type, error: error.message,
        ts: createdAt,
      }));
    }
  } catch (err) {
    console.error(JSON.stringify({
      level: "error", source: "audit", msg: "audit_exception",
      actor_id: actor.actorId, action: payload.action,
      error: String(err), ts: new Date().toISOString(),
    }));
  }
}

/**
 * Legacy compatibility wrapper — keeps old auditAction() callers working
 * without breaking existing routes. Converts middleware pattern to auditLog().
 *
 * Deprecated: prefer auditLog() directly in route handlers.
 */
export function auditAction(
  action: string,
  resourceType: string
) {
  return async (c: Context<{ Variables: HonoVariables }>, next: () => Promise<void>) => {
    await next();
    if (c.res.status >= 200 && c.res.status < 300) {
      await auditLog(c, { action, resource_type: resourceType });
    }
  };
}
