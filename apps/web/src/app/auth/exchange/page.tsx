"use client";

/**
 * Processa magic links e invites com implicit flow (hash-based tokens).
 * Os tokens são enviados ao BFF para criação de iron-session e NUNCA
 * armazenados em localStorage/sessionStorage.
 */
import { useEffect } from "react";
import { useRouter } from "next/navigation";

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

      // Troca tokens via BFF — cria iron-session sem expor tokens ao storage do browser.
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
      router.replace(data.landAt ?? "/cadete");
    }

    process();
  }, [router]);

  return null;
}
