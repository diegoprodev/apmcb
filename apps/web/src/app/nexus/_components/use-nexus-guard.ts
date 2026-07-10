"use client";

import { useEffect, useState } from "react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export function useNexusGuard() {
  const [ready, setReady] = useState(true); // otimista: renderiza imediatamente

  useEffect(() => {
    fetch(`${BFF_URL}/api/nexus/health`, { credentials: "include" })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          setReady(false);
          // Full page load — evita que o Router Cache reaproveite payload desta sessão
          window.location.href = "/nexus/login";
        }
      })
      .catch(() => {
        setReady(false);
        window.location.href = "/nexus/login";
      });
  }, []);

  return { ready };
}
