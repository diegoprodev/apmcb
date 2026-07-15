import type { SessionOptions } from "iron-session";

export interface PendingIdentity {
  profile_id: string;
  tenant_id: string;
  identified_at: number;
  auth_mode: "totp" | "biometria" | "manual";
  match_score?: number;
}

export interface SessionData {
  userId: string;
  role: "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor" | "usuario";
  tenantId: string | null;
  reserveId: string | null;
  supabaseAccessToken: string;
  issuedAt?: number;
  // ID único por sessão (gerado no login/exchange) — permite que logout()
  // revogue APENAS esta sessão (via tabela revoked_sessions), sem derrubar
  // outras abas/dispositivos do mesmo usuário. Sessões seladas antes desta
  // mudança não têm este campo (undefined) — tratadas como não-revogáveis
  // individualmente, expiram naturalmente pelo maxAge do cookie (8h).
  sessionId?: string;
  nexusAuthorized?: boolean;
  nexusAuthorizedAt?: number;
  pendingTotpSecret?: string;
  pendingTotpExpiresAt?: number;
  pendingIdentity?: PendingIdentity;
  activeMode?: "usuario";
  originalRole?: "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor";
  csrfToken?: string;
}

// Domain escopado a .apmcb.pmpb.online (não o apex .pmpb.online, mais amplo
// que apmcb_mode/apmcb_role_info usam) — pmpb.online é o domínio
// institucional da PM-PB, não exclusivo deste app; subir até o apex faria
// QUALQUER outro subdomínio que a instituição opere ali (portal, intranet,
// outro sistema) receber automaticamente a sessão selada inteira em toda
// requisição. .apmcb.pmpb.online cobre exatamente os hosts deste app
// (apmcb.pmpb.online, api.apmcb.pmpb.online, staging/api-staging, e o
// wildcard por-tenant *.apmcb.pmpb.online já planejado).
//
// Sem domain nenhum, apmcb_session era host-only, visível SOMENTE para
// api.apmcb.pmpb.online — o frontend (apmcb.pmpb.online) nunca o recebia.
// Isso impedia qualquer verificação server-side no Next.js que dependesse
// de ler esse cookie (ex: mitigação de session-bleed em middleware.ts),
// sempre fail-open sem checar nada de fato.
const COOKIE_DOMAIN = process.env.NODE_ENV === "production" ? ".apmcb.pmpb.online" : undefined;

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "apmcb_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
    ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}),
  },
};
