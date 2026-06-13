import type { MiddlewareHandler } from "hono";
import { supabase } from "../services/supabase";
import type { HonoVariables } from "../types/hono";

export function auditAction(
  action: string,
  resourceType: string
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    await next();
    const actorId = c.get("userId");
    if (actorId) {
      supabase
        .from("audit_logs")
        .insert({
          actor_id: actorId,
          action,
          resource_type: resourceType,
          metadata: {
            method: c.req.method,
            path: c.req.path,
            status: c.res.status,
          },
        })
        .then(() => {});
    }
  };
}
