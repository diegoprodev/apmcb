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
      const hash = window.location.hash.slice(1);
      const params = new URLSearchParams(hash);
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");

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
      //    @supabase/ssr usa cookies (não localStorage/sessionStorage).
      const supabase = createClient();
      await supabase.auth.setSession({ access_token, refresh_token });

      router.replace(landAt ?? "/");
    }

    process();
  }, [router]);

  return null;
}
