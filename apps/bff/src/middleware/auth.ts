import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie, deleteCookie } from "hono/cookie";
import { getIronSession } from "iron-session";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import { checkSessionValid, makeSupabaseFetcher } from "../lib/session-guard";
import type { HonoVariables, Role } from "../types/hono";

const COOKIE_DOMAIN = process.env.NODE_ENV === "production" ? ".pmpb.online" : undefined;
const DEL_COOKIE_OPTS = { path: "/", ...(COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {}) };

const _sessionFetcher = makeSupabaseFetcher(supabase);

export const authMiddleware: MiddlewareHandler<{ Variables: HonoVariables }> =
  async (c, next) => {
    // 1. Try iron-session cookie first
    const session = await getIronSession<SessionData>(
      c.req.raw,
      c.res,
      sessionOptions
    );
    if (session.userId && session.role) {
      const guard = await checkSessionValid(
        { userId: session.userId, role: session.role, issuedAt: session.issuedAt ?? 0 },
        _sessionFetcher,
      );
      if (!guard.valid) {
        session.destroy();
        throw new HTTPException(401, {
          message:
            guard.reason === "role_changed"
              ? "Permissões alteradas. Faça login novamente."
              : "Sessão revogada. Faça login novamente.",
        });
      }
      c.set("userId", session.userId);
      // No iron-session path, session.activeMode é a única fonte de verdade.
      // O apmcb_mode cookie NÃO é consultado aqui — ele pode ficar stale entre sessões
      // (ex: usuário ativa modo-usuario, faz logout sem trocar de volta; cookie persiste).
      // O cookie é usado apenas pelo Bearer path (proxy Next.js sem iron-session).
      const isUserMode = session.activeMode === "usuario";
      // Limpa cookie stale se iron-session não confirma modo-usuario
      if (!isUserMode && getCookie(c, "apmcb_mode") === "usuario") {
        deleteCookie(c, "apmcb_mode", DEL_COOKIE_OPTS);
        deleteCookie(c, "apmcb_role_info", DEL_COOKIE_OPTS);
      }
      const effectiveRole: Role = isUserMode ? "usuario" : (session.role as Role);
      c.set("role", effectiveRole);
      if (isUserMode && (session.originalRole || session.role)) {
        c.set("originalRole", (session.originalRole ?? session.role) as Role);
        c.set("activeMode", "usuario");
      }
      c.set("tenantId", session.tenantId ?? null);
      c.set("reserveId", session.reserveId ?? null);
      await next();
      return;
    }

    // 2. Fall back to Bearer token (for backward compat / direct API calls)
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new HTTPException(401, { message: "Authentication required" });
    }

    const token = authHeader.slice(7);

    // Use REST endpoint directly to avoid corrupting the shared supabase client's
    // in-memory auth state (supabase.auth.getUser caches the session in the singleton).
    const supabaseUrl = process.env.SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: serviceKey,
      },
    });
    if (!userRes.ok) {
      throw new HTTPException(401, { message: "Invalid token" });
    }
    const user = await userRes.json() as { id: string; email?: string } | null;
    if (!user?.id) {
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

    // Bearer token path: resolve tenant from tenant_memberships
    const { data: membership } = await supabase
      .from("tenant_memberships")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    const { data: reserveMembership } = await supabase
      .from("reserve_memberships")
      .select("reserve_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    c.set("userId", user.id);
    c.set("role", profile.role as Role);
    c.set("tenantId", membership?.tenant_id ?? null);
    c.set("reserveId", reserveMembership?.reserve_id ?? null);
    await next();
  };
