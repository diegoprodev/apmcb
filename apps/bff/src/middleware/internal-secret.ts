import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { baseLogger, type Logger } from "../lib/logger.ts";
import { getAuditClientIp } from "../lib/audit-client-ip.ts";

// Guard parametrizado para tráfego interno servidor→servidor autenticado por
// segredo compartilhado em header (plano §3.7). Substitui o check inline de
// /api/push/broadcast em index.ts, que retornava 403 SEM logar — viola
// "todo evento de negação deixa rastro no log" (CLAUDE.md).

function safeEqual(a: string, b: string): boolean {
  // Compara SHA-256 dos dois lados: digests têm sempre 32 bytes, então
  // timingSafeEqual nunca lança por tamanho divergente (o valor do header
  // pode ter qualquer comprimento / caracteres multibyte). Comparação em
  // tempo constante sobre os digests.
  const da = createHash("sha256").update(a, "utf8").digest();
  const db = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(da, db);
}

export function internalSecretGuard(envName: string, headerName: string): MiddlewareHandler {
  return async (c, next) => {
    const provided = c.req.header(headerName);
    const expected = process.env[envName];
    const ok = !!expected && !!provided && safeEqual(provided, expected);

    if (!ok) {
      const log = ((c.get as (k: string) => unknown)("log") as Logger | undefined) ?? baseLogger;
      log.warn(
        {
          path: c.req.path,
          method: c.req.method,
          reason: !expected ? "server_misconfigured" : "bad_secret",
          ip: getAuditClientIp(c.req.raw, log),
        },
        "internal.auth.denied",
      );
      return c.json({ error: "Forbidden" }, 403);
    }

    await next();
  };
}
