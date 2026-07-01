"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export function useNexusGuard() {
  const router = useRouter();
  const [ready, setReady] = useState(true); // otimista: renderiza imediatamente

  useEffect(() => {
    fetch(`${BFF_URL}/api/nexus/health`, { credentials: "include" })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          setReady(false);
          router.replace("/nexus/login");
        }
      })
      .catch(() => {
        setReady(false);
        router.replace("/nexus/login");
      });
  }, [router]);

  return { ready };
}
