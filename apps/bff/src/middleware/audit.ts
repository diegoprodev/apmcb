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
 * Fire-and-forget audit logging with SHA-256 hash chain.
 *
 * Call AFTER the main action succeeds. Does not block the response.
 * hash chain: each event's event_hash is computed from its own fields
 * + the previous event's hash → tamper-evident chain.
 */
export function auditLog(
  c: Context<{ Variables: HonoVariables }>,
  payload: AuditPayload
): void {
  const actorId   = c.get("userId");
  const actorRole = c.get("role");
  const tenantId  = c.get("tenantId") ?? null;

  if (!actorId || !actorRole) return;

  // Fire-and-forget — never awaited, never blocks response
  (async () => {
    try {
      const previousHash = await getLastEventHash(supabase, tenantId);
      const createdAt    = new Date().toISOString();

      const hashInput = {
        seq:             0,                            // placeholder — real seq from DB
        actor_id:        actorId,
        action:          payload.action,
        resource_type:   payload.resource_type,
        resource_id:     payload.resource_id ?? null,
        before_snapshot: payload.before_snapshot ?? null,
        after_snapshot:  payload.after_snapshot  ?? null,
        created_at:      createdAt,
        previous_hash:   previousHash,
      };

      // seq is auto-assigned by BIGSERIAL — we use 0 as placeholder in hash input.
      // This means seq is NOT part of the verified chain (prevents chicken-and-egg),
      // but all other fields are tamper-evident.
      const event_hash = computeEventHash(hashInput);

      const ip = c.req.header("x-forwarded-for")
        ?? c.req.header("x-real-ip")
        ?? null;
      const userAgent = c.req.header("user-agent") ?? null;

      await supabase.from("audit_events").insert({
        tenant_id:       tenantId,
        actor_id:        actorId,
        actor_role:      actorRole,
        action:          payload.action,
        resource_type:   payload.resource_type,
        resource_id:     payload.resource_id ?? null,
        before_snapshot: payload.before_snapshot ?? null,
        after_snapshot:  payload.after_snapshot  ?? null,
        metadata:        payload.metadata ?? {},
        ip,
        user_agent:      userAgent,
        event_hash,
        previous_hash:   previousHash,
      });
    } catch {
      // Audit failure never crashes the main flow
    }
  })();
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
): void {
  if (!params.actorId || !params.actorRole) return;
  const { actorId, actorRole, tenantId, ip, userAgent } = params;

  (async () => {
    try {
      const previousHash = await getLastEventHash(supabase, tenantId);
      const createdAt    = new Date().toISOString();

      const hashInput = {
        seq: 0, actor_id: actorId, action: payload.action,
        resource_type: payload.resource_type,
        resource_id: payload.resource_id ?? null,
        before_snapshot: payload.before_snapshot ?? null,
        after_snapshot:  payload.after_snapshot  ?? null,
        created_at: createdAt, previous_hash: previousHash,
      };
      const event_hash = computeEventHash(hashInput);

      await supabase.from("audit_events").insert({
        tenant_id: tenantId, actor_id: actorId, actor_role: actorRole,
        action: payload.action, resource_type: payload.resource_type,
        resource_id: payload.resource_id ?? null,
        before_snapshot: payload.before_snapshot ?? null,
        after_snapshot:  payload.after_snapshot  ?? null,
        metadata: payload.metadata ?? {},
        ip, user_agent: userAgent, event_hash, previous_hash: previousHash,
      });
    } catch { /* never crashes main flow */ }
  })();
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
      auditLog(c, { action, resource_type: resourceType });
    }
  };
}
