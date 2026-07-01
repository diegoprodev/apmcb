"use client";

/**
 * Processa magic links e invites com implicit flow (hash-based tokens).
 *
 * Fluxo duplo intencional:
 * 1. BFF iron-session  — POST /api/auth/exchange → cookie HttpOnly apmcb_session
 *                        BFF nunca recebe tokens diretamente do cliente; apenas valida o JWT
 * 2. Supabase SSR      — supabase.auth.setSession() via @supabase/ssr (cookies, NÃO localStorage)
 *                        Necessário para server components (layout.tsx) que chamam getUser()
 *
 * Tokens NUNCA são gravados em localStorage ou sessionStorage.
 * O @supabase/ssr usa document.cookie (não localStorage), satisfazendo o requisito de segurança.
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
