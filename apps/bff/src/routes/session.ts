import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getIronSession } from "iron-session";
import { setCookie, deleteCookie } from "hono/cookie";
import { sessionOptions, type SessionData } from "../lib/session";
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
    // userId: permite ao Next.js conferir que a sessão do BFF é da mesma
    // identidade do JWT antes de agir (R-28 — sem mistura de identidades).
    userId: c.get("userId"),
    role,
    originalRole: originalRole ?? null,
    activeMode:   activeMode   ?? null,
    roleLabel:    ROLE_LABELS[originalRole ?? role] ?? role,
  });
});

// POST /api/session/mode — troca entre modo staff e modo usuário
// Exige a iron-session (o toggle do navegador chama o BFF direto, com cookie).
// R-28 / D-02: o modo é da SESSÃO. O antigo fallback de Bearer criava aqui uma
// iron-session nova de staff (sem sessionId → não revogável; sem tenant/CSRF)
// — um Bearer sem sessão restaurava staff por esta rota. Seu único chamador
// era o proxy morto app/api/mode (removido).
sessionRoutes.post("/mode", async (c) => {
  const body = await c.req.json<{ mode: "usuario" | "staff" }>();
  if (body.mode !== "usuario" && body.mode !== "staff") {
    throw new HTTPException(400, { message: "mode deve ser 'usuario' ou 'staff'" });
  }

  // Sessão web obrigatória (ver cabeçalho).
  const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);

  if (!session.userId || !session.role) {
    c.get("log").warn(
      { hasBearer: Boolean(c.req.header("Authorization")), path: c.req.path },
      "session.mode.denied_without_session",
    );
    throw new HTTPException(401, { message: "Não autenticado" });
  }
  const realRole = (session.originalRole ?? session.role) as Role;

  const DEL_OPTS = { path: "/", ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) };

  if (body.mode === "usuario") {
    if (!STAFF_ROLES.includes(realRole)) {
      throw new HTTPException(403, { message: "Sem permissão para acessar modo usuário" });
    }
    if (session.activeMode !== "usuario") {
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
  if (session.activeMode) {
    delete session.activeMode;
    delete session.originalRole;
    await session.save();
  }
  deleteCookie(c, "apmcb_mode",      DEL_OPTS);
  deleteCookie(c, "apmcb_role_info", DEL_OPTS);
  return c.json({ ok: true, activeMode: null, role: realRole, roleLabel: ROLE_LABELS[realRole] ?? realRole });
});
