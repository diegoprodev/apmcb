"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";
const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Polls /api/auth/me and forces re-login if role changed or session was invalidated.
export function useRoleGuard() {
  const router = useRouter();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function check() {
    try {
      const res = await fetch(`${BFF_URL}/api/auth/me`, {
        credentials: "include",
        cache: "no-store",
      });
      if (res.status === 401) {
        router.push("/login?reason=session_expired");
      }
    } catch {
      // Network error — don't log out, just skip this check
    }
  }

  useEffect(() => {
    // Delay first check: iron-session exchange needs time to complete after Supabase login
    const initial = setTimeout(check, 3_000);
    // Achado de code review: pula o tick enquanto a aba está em background
    // — só a chamada do interval, não o corpo de check() (que também é
    // usado pelo timeout inicial e pelo listener de focus abaixo; pular
    // ali também pularia a checagem inicial se a aba abrir oculta).
    intervalRef.current = setInterval(() => {
      if (!document.hidden) check();
    }, POLL_INTERVAL_MS);

    const onFocus = () => check();
    window.addEventListener("focus", onFocus);

    return () => {
      clearTimeout(initial);
      if (intervalRef.current) clearInterval(intervalRef.current);
      window.removeEventListener("focus", onFocus);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
