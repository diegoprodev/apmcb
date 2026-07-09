import type { MiddlewareHandler } from "hono";
import { baseLogger } from "../lib/logger.ts";
import type { HonoVariables } from "../types/hono.ts";

// Aceitar APENAS UUID do cliente — qualquer outro formato é descartado
// (anti log-injection: impede requestId forjado com \n, JSON ou 2KB de lixo).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const requestIdMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> =
  async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && UUID_RE.test(incoming) ? incoming : crypto.randomUUID();
    c.set("requestId", requestId);
    c.set("log", baseLogger.child({
      requestId,
      ...(c.req.header("cf-ray") ? { cf_ray: c.req.header("cf-ray") } : {}),
    }));
    c.header("X-Request-Id", requestId);
    await next();
  };
