"use client";

/**
 * Processa magic links e invites com PKCE flow (?code=) e implicit flow (#hash).
 *
 * Fluxo pós Phase 2:
 * 1. BFF iron-session      — POST /api/auth/exchange → cookie HttpOnly apmcb_session ✅
 * 2. Supabase SSR          — setSession() → sb-* cookies (necessários para server components)
 * 3. upgrade-session       — POST /api/auth/upgrade-session (tokens no body) → re-emite sb-* como HttpOnly ✅
 *
 * Estado de segurança (Phase 2 completo):
 *   - JWT em localStorage              ✅ Nunca
 *   - iron-session (apmcb_session)     ✅ HttpOnly, Secure, SameSite=Strict
 *   - sb-* cookies                     ✅ HttpOnly após upgrade-session (~100ms pós-login)
 *   - Realtime WebSocket no browser    ✅ Eliminado — SSE via BFF (service role, iron-session)
 */
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { setCsrfToken } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export default function ExchangePage() {
  useEffect(() => {
    async function process() {
      const supabase = createClient();
      let access_token: string | null = null;
      let refresh_token: string | null = null;

      // Supabase invite usa PKCE flow: tokens chegam como ?code= na query string.
      // Magic links legados usam implicit flow: tokens chegam no hash #access_token=...
      const code = new URLSearchParams(window.location.search).get("code");

      if (code) {
        // PKCE — troca o código por sessão via SDK
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (error || !data.session) {
          window.location.href = "/auth/error";
          return;
        }
        access_token  = data.session.access_token;
        refresh_token = data.session.refresh_token;
      } else {
        // Implicit flow (hash-based) — fallback para magic links antigos
        const params = new URLSearchParams(window.location.hash.slice(1));
        access_token  = params.get("access_token");
        refresh_token = params.get("refresh_token");
        // Remove tokens do hash para evitar exposição no histórico do browser
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }

      if (!access_token || !refresh_token) {
        window.location.href = "/auth/error";
        return;
      }

      // 1. Cria iron-session no BFF — fonte de verdade para landAt e autorização de API.
      const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      let landAt: string | null = null;

      // 15s abort: if BFF is unreachable, fail fast so the exchange page redirects
      // to /auth/error immediately rather than hanging until the browser TCP timeout
      // (~75s), which causes waitForURL to expire in E2E tests and production alike.
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`${BFF_URL}/api/auth/exchange`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token, refresh_token }),
          signal: controller.signal,
        });
        clearTimeout(abortTimer);

        if (!res.ok) {
          window.location.href = "/auth/error";
          return;
        }

        const data = await res.json();
        landAt = data.landAt ?? null;
        if (data.csrfToken) setCsrfToken(data.csrfToken);
      } catch {
        clearTimeout(abortTimer);
        if (!isLocalhost) {
          window.location.href = "/auth/error";
          return;
        }
      }

      // 2. Persiste sessão Supabase em cookies SSR — necessário para server components.
      await supabase.auth.setSession({ access_token, refresh_token });

      // 3. Upgrade sb-* cookies to HttpOnly — fire-and-forget. Tokens enviados
      // explicitamente (mesmo fix do incidente 2026-07-20 em login/page.tsx):
      // se o navegador já tinha um cookie sb-* httpOnly de sessão anterior, a
      // rota não pode mais depender de lê-lo, senão recusa com 401.
      await fetch("/api/auth/upgrade-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token, refresh_token }),
      }).catch(() => {});

      // Full page load — evita que o Router Cache do Next reaproveite payload
      // RSC de uma sessão anterior (outro usuário) na mesma aba.
      window.location.href = landAt ?? "/";
    }

    process();
  }, []);

  return null;
}
