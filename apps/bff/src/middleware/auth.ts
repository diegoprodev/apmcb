import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { supabase } from "../services/supabase";
import type { HonoVariables, Role } from "../types/hono";

export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> =
  async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HTTPException(401, { message: "Missing Bearer token" });
    }

    const token = authHeader.slice(7);
    const { data: { user }, error } = await supabase.auth.getUser(token);

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
