import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getCookie, deleteCookie } from "hono/cookie";
import { getIronSession } from "iron-session";
import { supabase } from "../services/supabase";
import { sessionOptions, type SessionData } from "../lib/session";
import { checkSessionValid, makeSupabaseFetcher } from "../lib/session-guard";
import { logger as structuredLogger } from "../lib/logger";
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
      c.set("nexusAuthorized", session.nexusAuthorized ?? false);
      // Renovação deslizante: sem isso o cookie apmcb_session expira aos
      // 8h fixas mesmo com uso contínuo, dessincronizado do auto-refresh
      // do Supabase (sb-*) — resultado: SSR continua funcionando (usa a
      // sessão Supabase), mas chamadas client-side que dependem só do
      // apmcb_session (polling de /api/auth/me, EventSource do realtime)
      // passam a tomar 401 depois de 8h de sessão aberta.
      //
      // Roda no `finally` (depois de next(), inclusive se a rota downstream
      // lançar HTTPException — preserva o comportamento original de renovar
      // mesmo em respostas de erro) e só se a rota downstream ainda não
      // setou seu próprio Set-Cookie para apmcb_session. Rotas como
      // /api/session/mode, /api/nexus/*, /api/totp/*, /api/lendings/* chamam
      // session.save() com estado próprio mutado (ex: activeMode,
      // nexusAuthorized) via seu PRÓPRIO getIronSession() — independente
      // desta instância. Se a renovação rodasse sempre (como antes,
      // incondicional e ANTES de next()), a resposta ganhava DOIS headers
      // `Set-Cookie: apmcb_session` (um por getIronSession(), cada um
      // ~1.7KB de cookie selado contendo o JWT do Supabase) — quase
      // dobrando o tamanho dos headers e estourando o proxy_buffer_size
      // default do nginx (4KB), causando 502 "upstream sent too big header"
      // que o browser reporta como erro de CORS (o nginx aborta antes de
      // repassar Access-Control-Allow-Origin). Bug real reproduzido 100%
      // das vezes em POST /api/session/mode.
      try {
        await next();
      } finally {
        const alreadyPersisted = c.res.headers
          .getSetCookie()
          .some((v) => v.startsWith("apmcb_session="));
        if (!alreadyPersisted) {
          // Fail-open: uma falha na renovação (ex: payload de sessão perto
          // do limite de 4KB do iron-session) não pode derrubar a rota
          // inteira com 500, só pular a renovação.
          try {
            await session.save();
          } catch (err) {
            structuredLogger.warn("auth.session_renewal_failed", {
              user_id: session.userId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
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
