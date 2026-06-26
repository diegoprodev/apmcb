import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { setCookie } from "hono/cookie";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import { auditLogDirect } from "../middleware/audit";

export const authRoutes = new Hono();

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
    } catch {}
    return c.json({ error: "Credenciais inválidas" }, 401);
  }
  const authUser = loginData.user;
  const accessToken = loginData.access_token;

  // Get role from profiles + resolve tenant/reserve memberships
  const [profileRes, tenantRes, reserveRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("role, registration_status")
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
  session.tenantId = tenantRes.data?.tenant_id ?? null;
  session.reserveId = reserveRes.data?.reserve_id ?? null;
  session.supabaseAccessToken = accessToken;
  await session.save();

  // Emit CSRF token as a readable (non-HttpOnly) cookie so the frontend can read and send it
  const csrfToken = crypto.randomUUID();
  setCookie(c, "csrf-token", csrfToken, {
    path: "/",
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false, // must be readable by JS to set X-CSRF-Token header
    maxAge: 60 * 60 * 24, // 24h
  });

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

  // Return user info (no JWT in response body)
  return c.json({
    user: {
      id: authUser.id,
      email: authUser.email,
      role: profile.role,
      registration_status: profile.registration_status,
      tenantId: session.tenantId,
      reserveId: session.reserveId,
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
    return c.json({ error: "Token inválido ou expirado" }, 401);
  }
  const user = await userRes.json() as { id: string; email?: string } | null;
  if (!user?.id) {
    return c.json({ error: "Token inválido ou expirado" }, 401);
  }

  const [profileRes, tenantRes, reserveRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("role, registration_status")
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
    return c.json({ error: "Perfil não encontrado" }, 403);
  }

  const profile = profileRes.data;
  const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
  session.userId = user.id;
  session.role = profile.role as SessionData["role"];
  session.tenantId = tenantRes.data?.tenant_id ?? null;
  session.reserveId = reserveRes.data?.reserve_id ?? null;
  session.supabaseAccessToken = access_token;
  await session.save();

  const csrfToken = crypto.randomUUID();
  setCookie(c, "csrf-token", csrfToken, {
    path: "/",
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: false,
    maxAge: 60 * 60 * 24,
  });

  // Usuário invited/pending ainda não confirmou conta — vai definir senha primeiro.
  const landAt =
    profile.registration_status === "pending"
      ? "/auth/confirmar-conta"
      : profile.role === "admin_global" || profile.role === "superadmin"
      ? "/admin"
      : profile.role === "armeiro" || profile.role === "admin_reserva"
      ? "/reserva"
      : "/cadete";

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

  return c.json({ landAt });
});

// POST /api/auth/logout
authRoutes.post("/logout", async (c) => {
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    sessionOptions
  );
  session.destroy();
  return c.json({ ok: true });
});

// GET /api/auth/me — check current session
authRoutes.get("/me", async (c) => {
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    sessionOptions
  );
  if (!session.userId) {
    return c.json({ user: null }, 401);
  }
  return c.json({ user: { id: session.userId, role: session.role } });
});
