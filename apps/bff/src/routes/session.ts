import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "../lib/session";
import type { HonoVariables, Role } from "../types/hono";

export const sessionRoutes = new Hono<{ Variables: HonoVariables }>();

const STAFF_ROLES: Role[] = ["superadmin", "admin_global", "admin_reserva", "armeiro", "auditor"];

const ROLE_LABELS: Record<string, string> = {
  superadmin:    "Super Admin",
  admin_global:  "Admin",
  admin_reserva: "Admin de Reserva",
  armeiro:       "Armeiro",
  auditor:       "Auditor",
};

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
// Lê a sessão diretamente para acessar o role real (não o efetivo)
sessionRoutes.post("/mode", async (c) => {
  const body = await c.req.json<{ mode: "usuario" | "staff" }>();
  if (body.mode !== "usuario" && body.mode !== "staff") {
    throw new HTTPException(400, { message: "mode deve ser 'usuario' ou 'staff'" });
  }

  const session = await getIronSession<SessionData>(c.req.raw, c.res, sessionOptions);
  if (!session.userId || !session.role) {
    throw new HTTPException(401, { message: "Não autenticado" });
  }

  // Determinar o role real (pode estar mascarado por activeMode)
  const realRole = (session.originalRole ?? session.role) as Role;

  if (body.mode === "usuario") {
    // Apenas roles de staff podem entrar em modo usuário
    if (!STAFF_ROLES.includes(realRole)) {
      throw new HTTPException(403, { message: "Sem permissão para acessar modo usuário" });
    }
    // Já em modo usuário — idempotente
    if (session.activeMode === "usuario") {
      return c.json({ ok: true, activeMode: "usuario", originalRole: session.originalRole, roleLabel: ROLE_LABELS[realRole] ?? realRole });
    }
    session.originalRole = session.role as SessionData["originalRole"];
    session.activeMode   = "usuario";
    await session.save();
    return c.json({ ok: true, activeMode: "usuario", originalRole: realRole, roleLabel: ROLE_LABELS[realRole] ?? realRole });
  }

  // mode === "staff" — restaura o role original
  if (!session.activeMode) {
    // Já em modo staff — idempotente
    return c.json({ ok: true, activeMode: null, role: realRole, roleLabel: ROLE_LABELS[realRole] ?? realRole });
  }
  delete session.activeMode;
  delete session.originalRole;
  await session.save();
  return c.json({ ok: true, activeMode: null, role: realRole, roleLabel: ROLE_LABELS[realRole] ?? realRole });
});
