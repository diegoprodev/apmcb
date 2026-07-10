import type { Context, MiddlewareHandler, Next } from "hono";

// ---------------------------------------------------------------------------
// Sliding-window rate limiter with per-IP isolated stores.
// Each call to createRateLimiter() returns an independent middleware with its
// own Map — so /api/auth/* and /api/* never share counters.
// ---------------------------------------------------------------------------

interface Entry {
  timestamps: number[]; // epoch ms of each request inside the window
}

const allStores: Map<string, Entry>[] = [];

export function clearRateLimitForIp(ip: string): void {
  for (const store of allStores) {
    store.delete(ip);
  }
}

export function getClientIp(c: Context): string {
  // CF-Connecting-IP is set by Cloudflare itself and cannot be spoofed.
  // Fall back to x-forwarded-for only when not behind CF.
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

function createRateLimiter(max: number, windowMs: number): MiddlewareHandler {
  const store = new Map<string, Entry>();
  allStores.push(store);

  // Prune stale entries every 5 minutes to prevent unbounded Map growth.
  const timer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, entry] of store) {
      const pruned = entry.timestamps.filter((t) => t > cutoff);
      if (pruned.length === 0) {
        store.delete(ip);
      } else {
        entry.timestamps = pruned;
      }
    }
  }, 5 * 60_000);
  // Prevent the interval from keeping the Bun process alive on shutdown.
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }

  return async (c: Context, next: Next) => {
    const ip = getClientIp(c);
    const now = Date.now();
    const windowStart = now - windowMs;

    // Sliding window: discard timestamps older than the window.
    const entry = store.get(ip) ?? { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);
    store.set(ip, entry);

    const count = entry.timestamps.length;
    const resetEpochSec =
      count > 0
        ? Math.ceil((entry.timestamps[0] + windowMs) / 1000)
        : Math.ceil((now + windowMs) / 1000);

    if (count >= max) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((entry.timestamps[0] + windowMs - now) / 1000)
      );
      return c.json(
        { error: "Muitas tentativas. Tente novamente mais tarde.", retry_after_seconds: retryAfterSec },
        429,
        {
          "Retry-After": String(retryAfterSec),
          "X-RateLimit-Limit": String(max),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(resetEpochSec),
        }
      );
    }

    entry.timestamps.push(now);

    await next();

    // Attach informational headers to the actual response.
    c.res.headers.set("X-RateLimit-Limit", String(max));
    c.res.headers.set(
      "X-RateLimit-Remaining",
      String(Math.max(0, max - entry.timestamps.length))
    );
    c.res.headers.set("X-RateLimit-Reset", String(resetEpochSec));
  };
}

// ---------------------------------------------------------------------------
// Pre-built limiters — tuned for each surface's risk profile.
// ---------------------------------------------------------------------------

/**
 * Credential check only (/api/auth/login).
 * Very strict: 5 attempts per 15 minutes per IP.
 * Blocks brute-force credential stuffing cold.
 */
export const rateLimitLogin = createRateLimiter(5, 15 * 60_000);

/**
 * Token exchange (/api/auth/exchange) — magic link / invite flow.
 * 120/min — not a credential check (validates Supabase JWT, not username/password),
 * so brute-force is not a concern. Test suites call this once per test.
 */
export const rateLimitExchange = createRateLimiter(120, 60_000);

/**
 * Sensitive mutations: TOTP validate, SSA requests, biometric ops.
 * 100 per minute — prevents scripted brute-force while allowing test suites.
 * TOTP already has a secondary DB-level lock (5 fails / 15 min / military).
 */
export const rateLimitSensitive = createRateLimiter(100, 60_000);

/**
 * General authenticated API (lendings, dashboard, notifications, arsenal…).
 * 120 per minute = 2 req/s — comfortable for any human workflow.
 */
export const rateLimitGeneral = createRateLimiter(120, 60_000);

/**
 * GET /api/auth/me — leitura pura de sessão (sem mutação, sem dado sensível
 * além da identidade). Chamado agora pelo middleware do frontend em toda
 * navegação do dashboard (mitigação de session-bleed) além do uso normal —
 * bucket dedicado e mais generoso para não competir com o tráfego geral
 * (120/min compartilhado por IP, viável de esgotar com várias praças atrás
 * do mesmo NAT do quartel navegando ao mesmo tempo).
 */
export const rateLimitAuthMe = createRateLimiter(600, 60_000);

/**
 * Public unauthenticated verification endpoints (QR-code scan targets).
 * 30/min — tighter than authenticated traffic since there's no session to
 * hold accountable; still comfortable for a human scanning a printed PDF.
 */
export const rateLimitPublicVerify = createRateLimiter(30, 60_000);

/**
 * Single-entry-point middleware that picks the right limiter based on the
 * request path. Apply this to app.use("/api/*") and remove the old flat limiter.
 */
export const routeRateLimiter: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;

  // /api/public/branding é chamado sem sessão a cada carregamento da tela de
  // login — fica no limite geral (120/min), não no de verify (pensado para
  // scans esporádicos de QR code, não para todo carregamento de página).
  if (path.startsWith("/api/public/") && path !== "/api/public/branding") {
    return rateLimitPublicVerify(c, next);
  }

  if (path === "/api/auth/login") {
    return rateLimitLogin(c, next);
  }

  if (path === "/api/auth/exchange") {
    return rateLimitExchange(c, next);
  }

  if (path === "/api/auth/me") {
    return rateLimitAuthMe(c, next);
  }

  if (path.startsWith("/api/auth/")) {
    // /api/auth/logout, etc. — session management, not credential checks
    return rateLimitGeneral(c, next);
  }

  if (
    path.startsWith("/api/totp/") ||
    path.startsWith("/api/ssa/") ||
    path.startsWith("/api/biometric/")
  ) {
    return rateLimitSensitive(c, next);
  }

  return rateLimitGeneral(c, next);
};
