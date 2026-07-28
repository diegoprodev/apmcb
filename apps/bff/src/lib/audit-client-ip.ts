import { isIP } from "node:net";

export type AuditIpLogger = {
  warn(bindings: Record<string, unknown>, message: string): void;
};

/**
 * Returns the single client address normalized by the trusted reverse proxy.
 *
 * Trust boundary:
 * Cloudflare -> Nginx realip -> X-Real-IP -> BFF.
 *
 * X-Forwarded-For and CF-Connecting-IP are intentionally ignored here. They
 * are proxy input, not application-level sources of truth.
 */
export function getAuditClientIp(request: Request, log?: AuditIpLogger): string | null {
  const value = request.headers.get("x-real-ip")?.trim();

  if (!value) {
    return null;
  }

  if (isIP(value) === 0) {
    log?.warn({ category: "invalid_x_real_ip" }, "audit.client_ip.invalid");
    return null;
  }

  return value;
}
