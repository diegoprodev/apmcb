import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getIronSession } from "iron-session";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import type { HonoVariables, Role } from "../types/hono";

export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> =
  async (c, next) => {
    // 1. Try iron-session cookie first
    const session = await getIronSession<SessionData>(
      c.req.raw,
      c.res,
      sessionOptions
    );
    if (session.userId && session.role) {
      c.set("userId", session.userId);
      c.set("role", session.role as Role);
      await next();
      return;
    }

    // 2. Fall back to Bearer token (for backward compat / direct API calls)
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HTTPException(401, { message: "Authentication required" });
    }

    const token = authHeader.slice(7);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      throw new HTTPException(401, { message: "Invalid token" });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile) {
      throw new HTTPException(403, { message: "Profile not found" });
    }

    c.set("userId", user.id);
    c.set("role", profile.role as Role);
    await next();
  };
