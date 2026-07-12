import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { deleteCookie } from "hono/cookie";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import { auditLogDirect } from "../middleware/audit";
import { logger } from "../lib/logger";
import type { HonoVariables } from "../types/hono";

const COOKIE_DOMAIN = process.env.NODE_ENV === "production" ? ".pmpb.online" : undefined;
const DEL_COOKIE_OPTS = { path: "/", ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) };

export const authRoutes = new Hono<{ Variables: HonoVariables }>();

// POST /api/auth/login
// Body: { email?: string, matricula?: string, password: string }
authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{
    email?: string;
    matricula?: string;
    password: string;
  }>();

  let email = body.email;

  // Resolve matricula → email via RPC
  if (!email && body.matricula) {
    const { data: resolvedEmail, error } = await supabase.rpc(
      "get_email_by_matricula",
      { p_matricula: body.matricula }
    );
    if (error || !resolvedEmail) {
      return c.json({ error: "Matrícula não encontrada" }, 404);
    }
    email = resolvedEmail as string;
  }

  if (!email || !body.password) {
    return c.json({ error: "Email e senha são obrigatórios" }, 400);
  }

  // Authenticate via REST to avoid corrupting the shared supabase singleton auth state
  const supabaseUrl = process.env.SUPABASE_URL!;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const loginRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: body.password }),
  });
  const loginData = await loginRes.json() as {
    access_token?: string;
    refresh_token?: string;
    user?: { id: string; email?: string };
    error?: string;
    error_description?: string;
  };

  if (!loginRes.ok || !loginData.access_token || !loginData.user) {
    // Log failed login attempt for security monitoring
    const ip = c.req.header("x-forwarded-for") ?? "unknown";
    try {
      await supabase.from("audit_logs").insert({
        actor_id: null,
        action: "auth.login_failed",
        resource_type: "auth",
        resource_id: null,
        metadata: { email, ip, reason: loginData.error_description ?? loginData.error ?? "invalid credentials" },
      });
    } catch (err) {
      // Evento de monitoramento de segurança não pode se perder sem rastro
      logger.error("auth.login_failed.audit_insert_failure", {
        ip,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    c.get("log").warn({ ip }, "auth.login.failure");
    return c.json({ error: "Credenciais inválidas" }, 401);
  }
  const authUser = loginData.user;
  const accessToken = loginData.access_token;

  // Get role from profiles + resolve tenant/reserve memberships
  const [profileRes, tenantRes, reserveRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("role, registration_status, totp_configured, default_tenant_id")
      .eq("id", authUser.id)
      .single(),
    supabase
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("user_id", authUser.id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("reserve_memberships")
      .select("reserve_id")
      .eq("user_id", authUser.id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!profileRes.data) {
    return c.json({ error: "Perfil não encontrado" }, 403);
  }
  const profile = profileRes.data;

  // Create iron-session
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    sessionOptions
  );
  session.userId = authUser.id;
  session.role = profile.role as SessionData["role"];
  // Fallback para profiles.default_tenant_id — tenant_memberships é escrito
  // de forma fire-and-forget nas rotas de criação de usuário (admin.ts,
  // militares/users route.ts); se esse upsert falhar (erro transitório) o
  // profile fica com default_tenant_id correto mas sem linha em
  // tenant_memberships, e sem este fallback session.tenantId ficaria null
  // no primeiro login — quebrando todo write tenant-scoped subsequente.
  session.tenantId = tenantRes.data?.tenant_id ?? profile.default_tenant_id ?? null;
  session.reserveId = reserveRes.data?.reserve_id ?? null;
  session.supabaseAccessToken = accessToken;
  session.issuedAt = Date.now();
  // Limpa activeMode de sessão anterior — evita contaminação cruzada
  // quando um armeiro em modo usuário faz novo login na mesma sessão do browser.
  session.activeMode = undefined;
  session.originalRole = undefined;
  session.nexusAuthorized = undefined;
  session.nexusAuthorizedAt = undefined;
  // CSRF token armazenado na própria iron-session (criptografada).
  // O cookie duplo-submit estava sujeito a stale cookies entre deploys;
  // armazenar no session garante sempre em sincronia com a sessão ativa.
  const csrfToken = crypto.randomUUID();
  session.csrfToken = csrfToken;
  await session.save();

  // Limpa cookies de modo que podem ter ficado stale de sessão anterior
  deleteCookie(c, "apmcb_mode", DEL_COOKIE_OPTS);
  deleteCookie(c, "apmcb_role_info", DEL_COOKIE_OPTS);

  auditLogDirect(
    {
      actorId:   authUser.id,
      actorRole: profile.role,
      tenantId:  session.tenantId,
      ip:        c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    },
    { action: "auth.login", resource_type: "auth" }
  );
  c.get("log").info({ userId: authUser.id, role: profile.role }, "auth.login.success");

  return c.json({
    csrfToken,
    user: {
      id: authUser.id,
      email: authUser.email,
      role: profile.role,
      registration_status: profile.registration_status,
      tenantId: session.tenantId,
      reserveId: session.reserveId,
      totp_configured: profile.totp_configured ?? false,
    },
  });
});

// POST /api/auth/exchange
// Accepts Supabase tokens from magic link / invite flow, validates them,
// creates iron-session. Tokens are NEVER stored in browser localStorage.
authRoutes.post("/exchange", async (c) => {
  const body = await c.req.json<{ access_token?: string; refresh_token?: string }>();
  const { access_token, refresh_token } = body;

  if (!access_token || !refresh_token) {
    return c.json({ error: "access_token e refresh_token são obrigatórios" }, 400);
  }

  // Validate token via direct REST call to avoid corrupting supabase singleton auth state
  const userRes = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    },
  });
  if (!userRes.ok) {
    c.get("log").warn({ reason: "invalid_token", status: userRes.status }, "auth.exchange.failure");
    return c.json({ error: "Token inválido ou expirado" }, 401);
  }
  const user = await userRes.json() as { id: string; email?: string } | null;
  if (!user?.id) {
    c.get("log").warn({ reason: "no_user_id" }, "auth.exchange.failure");
    return c.json({ error: "Token inválido ou expirado" }, 401);
  }

  const [profileRes, tenantRes, reserveRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("role, registration_status, default_tenant_id")
      .eq("id", user.id)
      .single(),
    supabase
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("reserve_memberships")
      .select("reserve_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
  ]);

  if (!profileRes.data) {
    c.get("log").warn({ reason: "profile_not_found", userId: user.id }, "auth.exchange.failure");
    return c.json({ error: "Perfil não encontrado" }, 403);
  }

  const profile = profileRes.data;

  // Superadmin não usa este fluxo — autenticação exclusivamente via /nexus/login (TOTP 2FA).
  if (profile.role === "superadmin") {
    c.get("log").warn({ reason: "superadmin_wrong_flow", userId: user.id }, "auth.exchange.failure");
    return c.json({ error: "Credenciais inválidas" }, 401);
  }

  const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
  session.userId = user.id;
  session.role = profile.role as SessionData["role"];
  // Fallback para profiles.default_tenant_id — ver comentário equivalente em
  // POST /login logo acima; tenant_memberships pode ficar sem linha se o
  // upsert fire-and-forget nas rotas de criação de usuário falhar.
  session.tenantId = tenantRes.data?.tenant_id ?? profile.default_tenant_id ?? null;
  session.reserveId = reserveRes.data?.reserve_id ?? null;
  session.supabaseAccessToken = access_token;
  session.issuedAt = Date.now();
  // Limpa estado de sessão anterior — impede que activeMode/nexusAuthorized
  // de uma sessão anterior contaminem o novo login.
  session.activeMode = undefined;
  session.originalRole = undefined;
  session.nexusAuthorized = undefined;
  session.nexusAuthorizedAt = undefined;
  const csrfToken = crypto.randomUUID();
  session.csrfToken = csrfToken;
  await session.save();

  deleteCookie(c, "apmcb_mode", DEL_COOKIE_OPTS);
  deleteCookie(c, "apmcb_role_info", DEL_COOKIE_OPTS);

  // Usuário invited/pending ainda não confirmou conta — vai definir senha primeiro.
  const landAt =
    profile.registration_status === "pending"
      ? "/auth/confirmar-conta"
      : profile.registration_status === "pending_biometric"
      ? "/registro-pendente"
      : profile.role === "superadmin"
      ? "/nexus/login"
      : profile.role === "admin_global"
      ? "/admin"
      : profile.role === "armeiro" || profile.role === "admin_reserva"
      ? "/reserva"
      : profile.role === "auditor"
      ? "/admin"
      : "/efetivo";

  auditLogDirect(
    {
      actorId:   user.id,
      actorRole: profile.role,
      tenantId:  session.tenantId,
      ip:        c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
    },
    { action: "auth.exchange", resource_type: "auth" }
  );

  return c.json({ landAt, csrfToken });
});

// POST /api/auth/logout
authRoutes.post("/logout", async (c) => {
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    sessionOptions
  );
  const userId = session.userId;
  session.destroy();
  c.get("log").info({ userId }, "auth.logout");
  return c.json({ ok: true });
});

// GET /api/auth/me — verifica sessão + valida role atual no DB
// Se role mudou ou sessão foi invalidada, destrói cookie e retorna 401.
authRoutes.get("/me", async (c) => {
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    sessionOptions
  );
  if (!session.userId) {
    return c.json({ user: null }, 401);
  }

  // Verificar se sessão foi invalidada ou role mudou no DB
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, sessions_invalidated_at")
    .eq("id", session.userId)
    .single();

  if (profile) {
    const sessionIssuedAt = (session as SessionData & { issuedAt?: number }).issuedAt;
    const invalidatedAt = profile.sessions_invalidated_at
      ? new Date(profile.sessions_invalidated_at).getTime()
      : null;

    // Sessão foi invalidada após login
    if (invalidatedAt && sessionIssuedAt && sessionIssuedAt < invalidatedAt) {
      session.destroy();
      return c.json({ user: null, reason: "session_invalidated" }, 401);
    }

    // Role mudou no DB desde o login — força re-login
    if (profile.role !== session.role) {
      session.destroy();
      return c.json({ user: null, reason: "role_changed" }, 401);
    }
  }

  // Renovação deslizante: /me é o heartbeat de sessão do frontend
  // (useRoleGuard, polling a cada 5min) — sem renovar aqui, o cookie
  // apmcb_session expira aos 8h fixas mesmo com o usuário ativo, já que
  // authMiddleware não é usado por /api/auth/* (ver index.ts).
  try {
    await session.save();
  } catch (err) {
    // Fail-open: não bloqueia o heartbeat se a renovação falhar (ex:
    // payload de sessão perto do limite de 4KB do iron-session).
    logger.warn("auth.me.session_renewal_failed", {
      user_id: session.userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return c.json({ user: { id: session.userId, role: session.role } });
});
