import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getIronSession } from "iron-session";
import type { MiddlewareHandler } from "hono";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import { clearRateLimitForIp } from "../middleware/rate-limit";
import type { HonoVariables } from "../types/hono";

export const nexusRoutes = new Hono<{ Variables: HonoVariables }>();

const NEXUS_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── requireNexusSession ───────────────────────────────────────
// Must be admin + have completed TOTP step-2 within the last 2h.
const requireNexusSession: MiddlewareHandler<{ Variables: HonoVariables }> = async (c, next) => {
  const userId = c.get("userId");
  const role = c.get("role");

  if (!userId || role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);

  if (!session.nexusAuthorized || !session.nexusAuthorizedAt) {
    return c.json({ error: "Nexus session required" }, 401);
  }

  if (Date.now() - session.nexusAuthorizedAt > NEXUS_TTL_MS) {
    session.nexusAuthorized = false;
    await session.save();
    return c.json({ error: "Nexus session expired" }, 401);
  }

  await next();
};

// ── GET /api/nexus/health ─────────────────────────────────────
nexusRoutes.get("/health", requireNexusSession, async (c) => {
  const startMs = Date.now();

  // Ping Supabase with a lightweight query
  let supabaseOk = false;
  try {
    const { error } = await supabase.from("profiles").select("id").limit(1);
    supabaseOk = !error;
  } catch {}

  const uptimeSec = process.uptime ? Math.floor(process.uptime()) : null;

  return c.json({
    bff: { ok: true, latency_ms: Date.now() - startMs, uptime_seconds: uptimeSec },
    supabase: { ok: supabaseOk },
    ts: new Date().toISOString(),
  });
});

// ── GET /api/nexus/metrics ────────────────────────────────────
nexusRoutes.get("/metrics", requireNexusSession, async (c) => {
  const [usersRes, totpRes, adminRes, masterRes] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("totp_configured", true),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "master"),
  ]);

  const total = usersRes.count ?? 0;
  const totpConfigured = totpRes.count ?? 0;
  const adminCount = adminRes.count ?? 0;
  const masterCount = masterRes.count ?? 0;

  // Errors in last 24h: audit_logs with HTTP status >= 500 in metadata
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: errorsCount } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since24h)
    .not("metadata->>status", "is", null)
    .gte("metadata->>status", "500");

  // Login failures last 24h
  const { count: loginFailures } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("action", "auth.login_failed")
    .gte("created_at", since24h);

  return c.json({
    users: {
      total,
      admin: adminCount,
      master: masterCount,
      usuario: total - adminCount - masterCount,
      totp_configured: totpConfigured,
      totp_pct: total > 0 ? Math.round((totpConfigured / total) * 100) : 0,
    },
    security: {
      errors_24h: errorsCount ?? 0,
      login_failures_24h: loginFailures ?? 0,
    },
    ts: new Date().toISOString(),
  });
});

// ── GET /api/nexus/events ─────────────────────────────────────
nexusRoutes.get(
  "/events",
  requireNexusSession,
  zValidator(
    "query",
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      action: z.string().optional(),
      actor_id: z.string().uuid().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
  ),
  async (c) => {
    const { page, limit, action, actor_id, from, to } = c.req.valid("query");
    const offset = (page - 1) * limit;

    let query = supabase
      .from("audit_logs")
      .select(
        "id, actor_id, action, resource_type, resource_id, metadata, created_at, profiles!audit_logs_actor_id_fkey(nome_completo, matricula, role)",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (action) query = query.ilike("action", `%${action}%`);
    if (actor_id) query = query.eq("actor_id", actor_id);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);

    const { data, error, count } = await query;

    if (error) return c.json({ error: "Failed to fetch events" }, 500);

    return c.json({
      events: data,
      total: count ?? 0,
      page,
      limit,
    });
  }
);

// ── GET /api/nexus/errors ─────────────────────────────────────
nexusRoutes.get(
  "/errors",
  requireNexusSession,
  zValidator(
    "query",
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    })
  ),
  async (c) => {
    const { page, limit } = c.req.valid("query");
    const offset = (page - 1) * limit;

    // Errors: audit_logs where metadata.status >= 500 OR action contains 'error'/'failed'
    const { data, error, count } = await supabase
      .from("audit_logs")
      .select("id, actor_id, action, resource_type, metadata, created_at", { count: "exact" })
      .or("action.ilike.*error*,action.ilike.*failed*,action.ilike.*falhou*")
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) return c.json({ error: "Failed to fetch errors" }, 500);

    return c.json({ errors: data, total: count ?? 0, page, limit });
  }
);

// ── POST /api/nexus/clear-rate-limit ─────────────────────────
nexusRoutes.post(
  "/clear-rate-limit",
  requireNexusSession,
  zValidator("json", z.object({ ip: z.string().min(1) })),
  async (c) => {
    const { ip } = c.req.valid("json");
    const actorId = c.get("userId");

    clearRateLimitForIp(ip);

    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "nexus.clear_rate_limit",
      resource_type: "rate_limit",
      resource_id: null,
      metadata: { ip },
    });

    return c.json({ ok: true, ip });
  }
);

// ── POST /api/nexus/logout ────────────────────────────────────
nexusRoutes.post("/logout", requireNexusSession, async (c) => {
  const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
  session.nexusAuthorized = false;
  session.nexusAuthorizedAt = undefined;
  await session.save();
  return c.json({ ok: true });
});
