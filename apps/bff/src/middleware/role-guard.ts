import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { HonoVariables, Role } from "../types/hono";

export function roleGuard(
  ...allowedRoles: Role[]
): MiddlewareHandler<{ Variables: HonoVariables }> {
  return async (c, next) => {
    const role = c.get("role");
    if (!allowedRoles.includes(role)) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }
    await next();
  };
}
