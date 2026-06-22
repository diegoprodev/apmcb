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

  if (!userId || (role !== "admin_global" && role !== "superadmin")) {
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
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin_global"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "armeiro"),
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

// ═══════════════════════════════════════════════════════════════
// MULTI-TENANT MANAGEMENT (Slice 1A)
// Nota: Fase 2 (RBAC) atualizará requireNexusSession para verificar
// role='superadmin'. Por ora usa role='admin' + nexus session.
// ═══════════════════════════════════════════════════════════════

// ── GET /api/nexus/tenants ────────────────────────────────────
nexusRoutes.get("/tenants", requireNexusSession, async (c) => {
  const { data, error } = await supabase
    .from("tenants")
    .select(`
      id, nome, slug, tipo_orgao, estado, structure_mode, status, created_at,
      org_units:org_units(count),
      reserves:reserves(count),
      tenant_memberships:tenant_memberships(count)
    `)
    .order("nome");

  if (error) return c.json({ error: "Falha ao listar tenants" }, 500);
  return c.json({ tenants: data });
});

// ── POST /api/nexus/tenants ───────────────────────────────────
nexusRoutes.post(
  "/tenants",
  requireNexusSession,
  zValidator(
    "json",
    z.object({
      nome:           z.string().min(2).max(200),
      slug:           z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
      tipo_orgao:     z.enum(["pm", "gc", "bombeiro", "federal", "outro"]).default("pm"),
      estado:         z.string().length(2).optional(),
      structure_mode: z.enum(["simple", "structured"]).default("simple"),
    })
  ),
  async (c) => {
    const actorId = c.get("userId");
    const body = c.req.valid("json");

    const { data, error } = await supabase
      .from("tenants")
      .insert({ ...body, status: "ativo" })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return c.json({ error: "Slug já existe" }, 409);
      return c.json({ error: "Falha ao criar tenant" }, 500);
    }

    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "nexus.tenant.created",
      resource_type: "tenant",
      resource_id: data.id,
      metadata: { slug: data.slug, nome: data.nome },
    });

    return c.json({ tenant: data }, 201);
  }
);

// ── GET /api/nexus/tenants/:id ────────────────────────────────
nexusRoutes.get("/tenants/:id", requireNexusSession, async (c) => {
  const id = c.req.param("id");
  const { data, error } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return c.json({ error: "Tenant não encontrado" }, 404);
  return c.json({ tenant: data });
});

// ── GET /api/nexus/tenants/:id/org-units ─────────────────────
nexusRoutes.get("/tenants/:id/org-units", requireNexusSession, async (c) => {
  const tenantId = c.req.param("id");
  const { data, error } = await supabase
    .from("org_units")
    .select("*, reserves:reserves(count)")
    .eq("tenant_id", tenantId)
    .order("nome");

  if (error) return c.json({ error: "Falha ao listar unidades" }, 500);
  return c.json({ org_units: data });
});

// ── POST /api/nexus/tenants/:id/org-units ────────────────────
nexusRoutes.post(
  "/tenants/:id/org-units",
  requireNexusSession,
  zValidator(
    "json",
    z.object({
      nome:               z.string().min(2).max(200),
      acronym:            z.string().min(1).max(20),
      type:               z.enum(["diretoria","batalhao","companhia","centro","guarda","secretaria","unidade","outro"]).default("diretoria"),
      parent_org_unit_id: z.string().uuid().optional(),
    })
  ),
  async (c) => {
    const tenantId = c.req.param("id");
    const actorId = c.get("userId");
    const body = c.req.valid("json");

    const { data, error } = await supabase
      .from("org_units")
      .insert({ ...body, tenant_id: tenantId, status: "ativa" })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return c.json({ error: "Acronym já existe neste tenant" }, 409);
      return c.json({ error: "Falha ao criar unidade" }, 500);
    }

    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "nexus.org_unit.created",
      resource_type: "org_unit",
      resource_id: data.id,
      metadata: { tenant_id: tenantId, acronym: data.acronym },
    });

    return c.json({ org_unit: data }, 201);
  }
);

// ── GET /api/nexus/tenants/:id/reserves ──────────────────────
nexusRoutes.get("/tenants/:id/reserves", requireNexusSession, async (c) => {
  const tenantId = c.req.param("id");
  const { data, error } = await supabase
    .from("reserves")
    .select("*, org_unit:org_units(acronym, nome), reserve_memberships:reserve_memberships(count)")
    .eq("tenant_id", tenantId)
    .order("nome");

  if (error) return c.json({ error: "Falha ao listar reservas" }, 500);
  return c.json({ reserves: data });
});

// ── POST /api/nexus/tenants/:id/reserves ─────────────────────
nexusRoutes.post(
  "/tenants/:id/reserves",
  requireNexusSession,
  zValidator(
    "json",
    z.object({
      nome:        z.string().min(2).max(200),
      acronym:     z.string().min(1).max(20),
      org_unit_id: z.string().uuid().optional(),
    })
  ),
  async (c) => {
    const tenantId = c.req.param("id");
    const actorId = c.get("userId");
    const body = c.req.valid("json");

    const { data, error } = await supabase
      .from("reserves")
      .insert({ ...body, tenant_id: tenantId, status: "ativa" })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return c.json({ error: "Acronym de reserva já existe" }, 409);
      if (error.code === "P0003") return c.json({ error: "org_unit_id não pertence a este tenant" }, 422);
      return c.json({ error: "Falha ao criar reserva" }, 500);
    }

    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "nexus.reserve.created",
      resource_type: "reserve",
      resource_id: data.id,
      metadata: { tenant_id: tenantId, acronym: data.acronym, org_unit_id: body.org_unit_id ?? null },
    });

    return c.json({ reserve: data }, 201);
  }
);

// ── POST /api/nexus/reserves/:id/logo ────────────────────────
// Upload de logo da reserva → Supabase Storage
// Path: tenants/{slug}/reserves/{acronym}/logo.{ext}
nexusRoutes.post("/reserves/:reserveId/logo", requireNexusSession, async (c) => {
  const reserveId = c.req.param("reserveId");
  const actorId = c.get("userId");

  // Buscar reserva + tenant para montar path
  const { data: reserve, error: rErr } = await supabase
    .from("reserves")
    .select("acronym, tenant:tenants(slug)")
    .eq("id", reserveId)
    .single();

  if (rErr || !reserve) return c.json({ error: "Reserva não encontrada" }, 404);

  const formData = await c.req.formData();
  const file = formData.get("logo");
  if (!file || !(file instanceof File)) {
    return c.json({ error: "Campo 'logo' obrigatório (multipart/form-data)" }, 400);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "png";
  const allowedExts = ["png", "jpg", "jpeg", "webp", "svg"];
  if (!allowedExts.includes(ext)) {
    return c.json({ error: "Formato não permitido. Use png, jpg, jpeg, webp ou svg" }, 422);
  }

  const tenantRaw = reserve.tenant as unknown as { slug: string } | { slug: string }[] | null;
  const tenantSlug = (Array.isArray(tenantRaw) ? tenantRaw[0]?.slug : tenantRaw?.slug) ?? "unknown";
  const storagePath = `tenants/${tenantSlug}/reserves/${reserve.acronym.toLowerCase()}/logo.${ext}`;

  const arrayBuffer = await file.arrayBuffer();
  const { error: uploadErr } = await supabase.storage
    .from("reserve-logos")
    .upload(storagePath, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    });

  if (uploadErr) return c.json({ error: "Falha no upload do logo" }, 500);

  const { data: urlData } = supabase.storage
    .from("reserve-logos")
    .getPublicUrl(storagePath);

  await supabase
    .from("reserves")
    .update({ logo_url: urlData.publicUrl })
    .eq("id", reserveId);

  await supabase.from("audit_logs").insert({
    actor_id: actorId,
    action: "nexus.reserve.logo_updated",
    resource_type: "reserve",
    resource_id: reserveId,
    metadata: { path: storagePath },
  });

  return c.json({ logo_url: urlData.publicUrl });
});

// ── GET /api/nexus/reserves/:id/members ──────────────────────
nexusRoutes.get("/reserves/:reserveId/members", requireNexusSession, async (c) => {
  const reserveId = c.req.param("reserveId");
  const { data, error } = await supabase
    .from("reserve_memberships")
    .select("*, profile:profiles(nome_completo, matricula, posto, foto_url)")
    .eq("reserve_id", reserveId)
    .order("created_at");

  if (error) return c.json({ error: "Falha ao listar membros" }, 500);
  return c.json({ members: data });
});

// ── POST /api/nexus/reserves/:id/members ─────────────────────
nexusRoutes.post(
  "/reserves/:reserveId/members",
  requireNexusSession,
  zValidator(
    "json",
    z.object({
      user_id: z.string().uuid(),
      role:    z.enum(["admin_reserva", "armeiro", "auditor_reserva"]),
    })
  ),
  async (c) => {
    const reserveId = c.req.param("reserveId");
    const actorId = c.get("userId");
    const { user_id, role } = c.req.valid("json");

    const { data, error } = await supabase
      .from("reserve_memberships")
      .insert({ reserve_id: reserveId, user_id, role })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") return c.json({ error: "Usuário já é membro desta reserva" }, 409);
      return c.json({ error: "Falha ao adicionar membro" }, 500);
    }

    await supabase.from("audit_logs").insert({
      actor_id: actorId,
      action: "nexus.reserve.member_added",
      resource_type: "reserve_membership",
      resource_id: data.id,
      metadata: { reserve_id: reserveId, user_id, role },
    });

    return c.json({ member: data }, 201);
  }
);

// ── DELETE /api/nexus/reserves/:id/members/:userId ───────────
nexusRoutes.delete("/reserves/:reserveId/members/:userId", requireNexusSession, async (c) => {
  const reserveId = c.req.param("reserveId");
  const userId = c.req.param("userId");
  const actorId = c.get("userId");

  const { error } = await supabase
    .from("reserve_memberships")
    .delete()
    .eq("reserve_id", reserveId)
    .eq("user_id", userId);

  if (error) return c.json({ error: "Falha ao remover membro" }, 500);

  await supabase.from("audit_logs").insert({
    actor_id: actorId,
    action: "nexus.reserve.member_removed",
    resource_type: "reserve_membership",
    resource_id: null,
    metadata: { reserve_id: reserveId, user_id: userId },
  });

  return c.json({ ok: true });
});
