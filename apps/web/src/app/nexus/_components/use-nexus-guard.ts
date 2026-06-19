"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export function useNexusGuard() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch(`${BFF_URL}/api/nexus/health`, { credentials: "include" })
      .then((r) => {
        if (r.status === 401 || r.status === 403) {
          router.replace("/nexus/login");
        } else {
          setReady(true);
        }
      })
      .catch(() => router.replace("/nexus/login"));
  }, [router]);

  return { ready };
}
