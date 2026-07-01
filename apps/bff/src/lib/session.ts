import type { SessionOptions } from "iron-session";

export interface SessionData {
  userId: string;
  role: "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor" | "usuario";
  tenantId: string | null;
  reserveId: string | null;
  supabaseAccessToken: string;
  issuedAt?: number;
  nexusAuthorized?: boolean;
  nexusAuthorizedAt?: number;
  pendingTotpSecret?: string;
  pendingTotpExpiresAt?: number;
  activeMode?: "usuario";
  originalRole?: "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor";
  csrfToken?: string;
}

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET!,
  cookieName: "apmcb_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  },
};
