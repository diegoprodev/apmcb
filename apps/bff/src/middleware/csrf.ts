import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie } from "hono/cookie";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";

export const csrfMiddleware: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) {
    await next();
    return;
  }

  // Skip CSRF for auth routes and TOTP first-setup confirm.
  // setup-2fa/confirm is part of the login flow — protected by iron-session
  // userId + pendingTotpSecret/expiresAt, so no CSRF surface exists.
  const path = new URL(c.req.url).pathname;
  if (
    path === "/api/auth/login" ||
    path === "/api/auth/exchange" ||
    path === "/api/nexus/setup-2fa/confirm" ||
    path === "/api/totp/self-validate" ||
    path === "/api/push/broadcast"
  ) {
    await next();
    return;
  }

  // Bearer token requests have no cookie-based session → no CSRF surface
  if (c.req.header("Authorization")?.startsWith("Bearer ")) {
    await next();
    return;
  }

  // No iron-session cookie → not an authenticated browser session
  // No CSRF attack surface; let auth middleware return 401
  if (!getCookie(c, "apmcb_session")) {
    await next();
    return;
  }

  const cookieToken = getCookie(c, CSRF_COOKIE);
  const headerToken = c.req.header(CSRF_HEADER);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    console.warn("[csrf] mismatch", { path, hasCookie: !!cookieToken, hasHeader: !!headerToken, match: cookieToken === headerToken });
    throw new HTTPException(403, { message: "CSRF token inválido" });
  }

  await next();
};
