import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getIronSession } from "iron-session";
import { setCookie, deleteCookie } from "hono/cookie";
import { sessionOptions, type SessionData } from "../lib/session";
import { supabase } from "../services/supabase";
import { createAuthProvider } from "../lib/auth-provider-factory";
import { loadInfraEnv } from "../lib/infra-env";
import { AuthError } from "../lib/auth-provider";
import type { HonoVariables, Role } from "../types/hono";

const COOKIE_DOMAIN = process.env.NODE_ENV === "production" ? ".pmpb.online" : undefined;
const MODE_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // "Lax", não "Strict" — mesma causa raiz do fix em apmcb_session
  // (lib/session.ts, 2026-07-16): WebKit em modo PWA standalone no iOS não
  // persiste de forma confiável cookies Strict cross-subdomain setados via
  // fetch(). Ver comentário completo em lib/session.ts.
  sameSite: "Lax" as const,
  path: "/",
  maxAge: 60 * 60 * 8,
  ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
};

// Instância única reaproveitada entre requests — mesmo padrão do singleton
// `supabase` em services/supabase.ts (e de routes/auth.ts, middleware/auth.ts).
const authProvider = createAuthProvider(loadInfraEnv(process.env));

export const sessionRoutes = new Hono<{ Variables: HonoVariables }>();

const STAFF_ROLES: Role[] = ["superadmin", "admin_global", "admin_reserva", "armeiro", "auditor"];

const ROLE_LABELS: Record<string, string> = {
  superadmin:    "Super Admin",
  admin_global:  "Admin",
  admin_reserva: "Admin de Reserva",
  armeiro:       "Armeiro",
  auditor:       "Auditor",
};

// GET /api/session/csrf — retorna o csrfToken da sessão ativa (para setup E2E via storageState)
// Safe: GET não tem CSRF surface; só expõe o token ao próprio browser que já tem o cookie.
sessionRoutes.get("/csrf", async (c) => {
  const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
  if (!session.userId || !session.csrfToken) {
    return c.json({ csrfToken: null }, 401);
  }
  return c.json({ csrfToken: session.csrfToken });
});

// GET /api/session/info — retorna role original + activeMode para o layout
sessionRoutes.get("/info", async (c) => {
  const role         = c.get("role");
  const originalRole = c.get("originalRole");
  const activeMode   = c.get("activeMode");

  return c.json({
    role,
    originalRole: originalRole ?? null,
    activeMode:   activeMode   ?? null,
    roleLabel:    ROLE_LABELS[originalRole ?? role] ?? role,
  });
});

// POST /api/session/mode — troca entre modo staff e modo usuário
// Suporta iron-session (browser direto) e Bearer token (proxy Next.js server-side).
sessionRoutes.post("/mode", async (c) => {
  const body = await c.req.json<{ mode: "usuario" | "staff" }>();
  if (body.mode !== "usuario" && body.mode !== "staff") {
    throw new HTTPException(400, { message: "mode deve ser 'usuario' ou 'staff'" });
  }

  // 1. Tenta iron-session (chamada direta do browser)
  const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);

  let realRole: Role;
  let hasIronSession = false;

  if (session.userId && session.role) {
    realRole = (session.originalRole ?? session.role) as Role;
    hasIronSession = true;
  } else {
    // 2. Fallback: Bearer token (Next.js route handler → BFF server-to-server)
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HTTPException(401, { message: "Não autenticado" });
    }
    const token = authHeader.slice(7);

    // Valida o token via AuthProvider em vez do fetch REST inline direto à
    // Supabase (mesmo padrão de routes/auth.ts e middleware/auth.ts).
    let user: { id: string; email: string | null };
    try {
      const identity = await authProvider.verifyAccessToken(token);
      user = { id: identity.userId, email: identity.email };
    } catch (err) {
      // Ver comentário equivalente nos catches de /login e /exchange em
      // routes/auth.ts (achado C2) — só AuthError vira resposta HTTP
      // controlada (501/401); qualquer outro throw (rede/parse) precisa
      // escapar pro error handler top-level de index.ts (500 + log).
      if (!(err instanceof AuthError)) throw err;

      if (err.code === "not_supported") {
        // Modo ON_PREMISE nesta fase: sem equivalente a bearer token da
        // Supabase Auth. 501, não 401 — mesmo tratamento do fallback
        // Bearer em middleware/auth.ts.
        throw new HTTPException(501, {
          message: "Autenticação via Bearer token não suportada em modo ON_PREMISE",
        });
      }
      throw new HTTPException(401, { message: "Token inválido" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile) throw new HTTPException(403, { message: "Perfil não encontrado" });

    // Popula a sessão para persistência (iron-session vai gerar novo cookie na resposta)
    session.userId = user.id;
    session.role   = profile.role as SessionData["role"];
    realRole       = profile.role as Role;
  }

  const DEL_OPTS = { path: "/", ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) };

  if (body.mode === "usuario") {
    if (!STAFF_ROLES.includes(realRole)) {
      throw new HTTPException(403, { message: "Sem permissão para acessar modo usuário" });
    }
    if (!hasIronSession || session.activeMode !== "usuario") {
      session.originalRole = session.role as SessionData["originalRole"];
      session.activeMode   = "usuario";
      await session.save();
    }
    const label = ROLE_LABELS[realRole] ?? realRole;
    setCookie(c, "apmcb_mode",      "usuario",             MODE_COOKIE_OPTS);
    setCookie(c, "apmcb_role_info", `${realRole}:${label}`, MODE_COOKIE_OPTS);
    return c.json({ ok: true, activeMode: "usuario", originalRole: realRole, roleLabel: label });
  }

  // mode === "staff" — restaura o role original
  if (hasIronSession && session.activeMode) {
    delete session.activeMode;
    delete session.originalRole;
    await session.save();
  } else if (!hasIronSession) {
    // Bearer path: limpa activeMode se havia sido salvo antes
    session.activeMode   = undefined;
    session.originalRole = undefined;
    await session.save();
  }
  deleteCookie(c, "apmcb_mode",      DEL_OPTS);
  deleteCookie(c, "apmcb_role_info", DEL_OPTS);
  return c.json({ ok: true, activeMode: null, role: realRole, roleLabel: ROLE_LABELS[realRole] ?? realRole });
});
