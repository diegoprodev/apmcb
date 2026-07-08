"use client";

/**
 * Processa magic links e invites com implicit flow (hash-based tokens).
 *
 * Fluxo duplo intencional:
 * 1. BFF iron-session  — POST /api/auth/exchange → cookie HttpOnly apmcb_session ✅
 * 2. Supabase SSR      — supabase.auth.setSession() → cookies sb-* (SameSite=Lax, NÃO HttpOnly)
 *                        Necessário para:
 *                        a) Server components (createServerClient lê sb-* via cookies())
 *                        b) Realtime WebSocket (createBrowserClient lê JWT de sb-* para phx_join)
 *
 * Por que sb-* NÃO podem ser HttpOnly:
 *   O Supabase Realtime usa createBrowserClient.auth.getSession() para obter o JWT e
 *   autenticar o WebSocket (phx_join). Cookies HttpOnly não são acessíveis via document.cookie →
 *   getSession() retorna null → WebSocket usa anon key → RLS bloqueia eventos privados.
 *
 * Estado de segurança atual:
 *   - JWT NÃO está em localStorage ✅
 *   - iron-session é HttpOnly, Secure, SameSite=Strict ✅
 *   - sb-* em cookies (não localStorage), mas legíveis por JS ⚠️
 *
 * Migração completa (Phase 2): substituir Realtime auth por token efêmero via BFF,
 * eliminar sb-* cookies e usar iron-session como única sessão.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export default function ExchangePage() {
  const router = useRouter();

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
          router.replace("/auth/error");
          return;
        }
        access_token  = data.session.access_token;
        refresh_token = data.session.refresh_token;
      } else {
        // Implicit flow (hash-based) — fallback para magic links antigos
        const params = new URLSearchParams(window.location.hash.slice(1));
        access_token  = params.get("access_token");
        refresh_token = params.get("refresh_token");
      }

      if (!access_token || !refresh_token) {
        router.replace("/auth/error");
        return;
      }

      // 1. Cria iron-session no BFF — fonte de verdade para landAt e autorização de API.
      const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
      let landAt: string | null = null;

      try {
        const res = await fetch(`${BFF_URL}/api/auth/exchange`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ access_token, refresh_token }),
        });

        if (!res.ok) {
          router.replace("/auth/error");
          return;
        }

        const data = await res.json();
        landAt = data.landAt ?? null;
      } catch {
        if (!isLocalhost) {
          router.replace("/auth/error");
          return;
        }
      }

      // 2. Persiste sessão Supabase em cookies SSR — necessário para server components.
      await supabase.auth.setSession({ access_token, refresh_token });

      router.replace(landAt ?? "/");
    }

    process();
  }, [router]);

  return null;
}
