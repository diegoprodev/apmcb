import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { setCookie } from "hono/cookie";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";

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

  // Authenticate via Supabase
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: body.password,
  });

  if (error || !data.user) {
    // Log failed login attempt for security monitoring
    const ip = c.req.header("x-forwarded-for") ?? "unknown";
    try {
      await supabase.from("audit_logs").insert({
        actor_id: null,
        action: "auth.login_failed",
        resource_type: "auth",
        resource_id: null,
        metadata: { email, ip, reason: error?.message ?? "invalid credentials" },
      });
    } catch {}
    return c.json({ error: "Credenciais inválidas" }, 401);
  }

  // Get role from profiles
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, registration_status")
    .eq("id", data.user.id)
    .single();

  if (!profile) {
    return c.json({ error: "Perfil não encontrado" }, 403);
  }

  // Create iron-session
  const session = await getIronSession<SessionData>(
    c.req.raw,
    c.res,
    sessionOptions
  );
  session.userId = data.user.id;
  session.role = profile.role as SessionData["role"];
  session.supabaseAccessToken = data.session!.access_token;
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

  // Return user info (no JWT in response body)
  return c.json({
    user: {
      id: data.user.id,
      email: data.user.email,
      role: profile.role,
      registration_status: profile.registration_status,
    },
  });
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
