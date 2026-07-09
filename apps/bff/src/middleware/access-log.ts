import type { MiddlewareHandler } from "hono";
import type { HonoVariables } from "../types/hono";

// Substitui hono/logger() (texto puro, sem requestId) por NDJSON estruturado.
// Health checks (~2880 linhas/dia de puro ruído) são omitidos.
export const accessLogMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> =
  async (c, next) => {
    if (c.req.path === "/health") {
      await next();
      return;
    }
    const start = performance.now();
    await next();
    c.get("log").info({
      method: c.req.method,
      path: c.req.path, // path, nunca a URL completa (evita logar query string sensível)
      status: c.res.status,
      duration_ms: Math.round(performance.now() - start),
      userId: c.get("userId") ?? null,
      tenantId: c.get("tenantId") ?? null,
    }, "http.request.completed");
  };
