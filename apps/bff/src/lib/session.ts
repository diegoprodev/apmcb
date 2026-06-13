import type { SessionOptions } from "iron-session";

export interface SessionData {
  userId: string;
  role: "admin" | "master" | "military";
  supabaseAccessToken: string;
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
