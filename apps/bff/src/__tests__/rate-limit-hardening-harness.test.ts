import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import {
  RATE_LIMIT_PROFILES,
  clearRateLimitForIp,
  getClientIp,
  routeRateLimiter,
  trustsProxyHeaders,
} from "../middleware/rate-limit.ts";

const repoRoot = resolve(process.cwd(), "..", "..");

function read(relPath: string) {
  return readFileSync(resolve(repoRoot, relPath), "utf8");
}

function stripLineComments(text: string) {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const previous = Object.fromEntries(Object.keys(patch).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function makeApp() {
  const app = new Hono();
  app.use("/api/*", routeRateLimiter);
  app.all("/api/ip", (c) => c.json({ ip: getClientIp(c) }));
  app.all("/api/*", (c) => c.json({ ok: true, path: c.req.path }));
  app.get("/health", (c) => c.json({ ok: true }));
  return app;
}

function ip(octet: number) {
  return `203.0.113.${octet}`;
}

async function request(
  app: Hono,
  path: string,
  clientIp: string,
  init: RequestInit = {},
) {
  return app.request(`http://localhost${path}`, {
    method: "POST",
    ...init,
    headers: {
      "cf-connecting-ip": clientIp,
      ...(init.headers ?? {}),
    },
  });
}

async function exhaust(app: Hono, path: string, clientIp: string, attempts: number) {
  let last: Response | undefined;
  for (let i = 0; i < attempts; i++) {
    last = await request(app, path, clientIp);
  }
  return last!;
}

describe("rate limit hardening harness", () => {
  it("keeps enterprise route profiles explicit and reviewable", () => {
    assert.deepEqual(RATE_LIMIT_PROFILES.login, { max: 5, windowMs: 15 * 60_000 });
    assert.deepEqual(RATE_LIMIT_PROFILES.exchange, { max: 120, windowMs: 60_000 });
    assert.deepEqual(RATE_LIMIT_PROFILES.sensitive, { max: 100, windowMs: 60_000 });
    assert.deepEqual(RATE_LIMIT_PROFILES.general, { max: 120, windowMs: 60_000 });
    assert.deepEqual(RATE_LIMIT_PROFILES.authMe, { max: 600, windowMs: 60_000 });
    assert.deepEqual(RATE_LIMIT_PROFILES.publicVerify, { max: 30, windowMs: 60_000 });
    assert.deepEqual(RATE_LIMIT_PROFILES.biometric, { max: 30, windowMs: 60_000 });
  });

  it("registers the API rate limiter before auth routes and authenticated routes", () => {
    const index = read("apps/bff/src/index.ts");
    const withoutComments = stripLineComments(index);
    const limiterIndex = withoutComments.indexOf('app.use("/api/*", routeRateLimiter);');
    const authRoutesIndex = withoutComments.indexOf('app.route("/api/auth", authRoutes);');

    assert.ok(limiterIndex >= 0, "BFF must register routeRateLimiter on /api/*");
    assert.ok(authRoutesIndex >= 0, "BFF must route /api/auth explicitly");
    assert.ok(limiterIndex < authRoutesIndex, "Rate limiter must run before /api/auth routes");

    const beforeLimiter = withoutComments.slice(0, limiterIndex);
    assert.equal(
      /app\.(?:route|get|post|put|patch|delete|all)\("\/api/.test(beforeLimiter),
      false,
      "No API endpoint route may be registered before routeRateLimiter",
    );

    const authenticatedRoutes = Array.from(withoutComments.matchAll(/app\.use\("([^"]+)",\s*authMiddleware\)/g));
    assert.ok(authenticatedRoutes.length >= 10, "Harness must locate authenticated route registrations");
    for (const route of authenticatedRoutes) {
      assert.ok(
        limiterIndex < route.index!,
        `Rate limiter must run before authenticated API route ${route[1]}`,
      );
    }
  });

  it("fails closed on proxy headers in production until explicitly trusted", async () => {
    await withEnv({ NODE_ENV: "production", RATE_LIMIT_TRUST_PROXY_HEADERS: undefined }, async () => {
      const app = makeApp();
      const res = await request(app, "/api/ip", ip(1), {
        headers: {
          "cf-connecting-ip": ip(1),
          "x-forwarded-for": "198.51.100.77, 198.51.100.78",
        },
      });

      assert.equal(trustsProxyHeaders(), false);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ip: "proxy-headers-untrusted" });
    });
  });

  it("prefers Cloudflare client IP over forwarded headers only when proxy trust is enabled", async () => {
    await withEnv({ NODE_ENV: "production", RATE_LIMIT_TRUST_PROXY_HEADERS: "true" }, async () => {
      const app = makeApp();
      const res = await request(app, "/api/ip", ip(1), {
        headers: {
          "cf-connecting-ip": ip(1),
          "x-forwarded-for": "198.51.100.77, 198.51.100.78",
        },
      });

      assert.equal(trustsProxyHeaders(), true);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { ip: ip(1) });
    });
  });

  it("blocks /api/auth/login on the sixth request per IP and emits 429 headers", async () => {
    await withEnv({ NODE_ENV: "test", RATE_LIMIT_TRUST_PROXY_HEADERS: undefined }, async () => {
    const app = makeApp();
    const clientIp = ip(2);
    clearRateLimitForIp(clientIp);

    for (let i = 0; i < RATE_LIMIT_PROFILES.login.max; i++) {
      const res = await request(app, "/api/auth/login", clientIp);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("X-RateLimit-Limit"), "5");
    }

    const blocked = await request(app, "/api/auth/login", clientIp);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get("X-RateLimit-Limit"), "5");
    assert.equal(blocked.headers.get("X-RateLimit-Remaining"), "0");

    const retryAfter = Number(blocked.headers.get("Retry-After"));
    const reset = Number(blocked.headers.get("X-RateLimit-Reset"));
    const nowSec = Math.floor(Date.now() / 1000);
    assert.ok(retryAfter > 0 && retryAfter <= 900);
    assert.ok(reset > nowSec && reset <= nowSec + 901);

    const body = await blocked.json();
    assert.equal(typeof body.error, "string");
    assert.equal(body.retry_after_seconds, retryAfter);
    });
  });

  it("keeps login lockout isolated from exchange and general API buckets", async () => {
    await withEnv({ NODE_ENV: "test", RATE_LIMIT_TRUST_PROXY_HEADERS: undefined }, async () => {
    const app = makeApp();
    const clientIp = ip(3);
    clearRateLimitForIp(clientIp);

    await exhaust(app, "/api/auth/login", clientIp, RATE_LIMIT_PROFILES.login.max + 1);

    const loginStillBlocked = await request(app, "/api/auth/login", clientIp);
    assert.equal(loginStillBlocked.status, 429);

    const exchange = await request(app, "/api/auth/exchange", clientIp);
    assert.equal(exchange.status, 200);
    assert.equal(exchange.headers.get("X-RateLimit-Limit"), "120");

    const general = await request(app, "/api/dashboard/summary", clientIp);
    assert.equal(general.status, 200);
    assert.equal(general.headers.get("X-RateLimit-Limit"), "120");
    });
  });

  it("applies dedicated buckets for sensitive, biometric, auth heartbeat, and public verification routes", async () => {
    await withEnv({ NODE_ENV: "test", RATE_LIMIT_TRUST_PROXY_HEADERS: undefined }, async () => {
    const app = makeApp();
    const clientIp = ip(4);
    clearRateLimitForIp(clientIp);

    const sensitive = await request(app, "/api/totp/validate", clientIp);
    assert.equal(sensitive.status, 200);
    assert.equal(sensitive.headers.get("X-RateLimit-Limit"), "100");

    const biometric = await request(app, "/api/biometric/challenges", clientIp);
    assert.equal(biometric.status, 200);
    assert.equal(biometric.headers.get("X-RateLimit-Limit"), "30");

    const authMe = await request(app, "/api/auth/me", clientIp);
    assert.equal(authMe.status, 200);
    assert.equal(authMe.headers.get("X-RateLimit-Limit"), "600");

    const verify = await request(app, "/api/public/document/verify", clientIp);
    assert.equal(verify.status, 200);
    assert.equal(verify.headers.get("X-RateLimit-Limit"), "30");

    const branding = await request(app, "/api/public/branding", clientIp);
    assert.equal(branding.status, 200);
    assert.equal(branding.headers.get("X-RateLimit-Limit"), "120");
    });
  });

  it("keeps /health outside API rate limiting", async () => {
    const app = makeApp();
    const res = await app.request("http://localhost/health", { method: "GET" });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("X-RateLimit-Limit"), null);
    assert.equal(res.headers.get("X-RateLimit-Remaining"), null);
  });
});
