import type { Context, MiddlewareHandler, Next } from "hono";

// ---------------------------------------------------------------------------
// Sliding-window rate limiter with per-IP isolated stores.
// Each call to createRateLimiter() returns an independent middleware with its
// own Map — so /api/auth/* and /api/* never share counters.
// ---------------------------------------------------------------------------

interface Entry {
  timestamps: number[]; // epoch ms of each request inside the window
}

function getClientIp(c: Context): string {
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
 * Auth endpoints (/api/auth/login).
 * Very strict: 5 attempts per 15 minutes per IP.
 * Blocks brute-force credential stuffing cold.
 */
export const rateLimitAuth = createRateLimiter(5, 15 * 60_000);

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
 * Single-entry-point middleware that picks the right limiter based on the
 * request path. Apply this to app.use("/api/*") and remove the old flat limiter.
 */
export const routeRateLimiter: MiddlewareHandler = async (c, next) => {
  const path = c.req.path;

  if (path.startsWith("/api/auth/")) {
    return rateLimitAuth(c, next);
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
