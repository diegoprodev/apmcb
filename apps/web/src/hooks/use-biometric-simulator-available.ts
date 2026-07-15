"use client";

import { useEffect, useState } from "react";
import { bffFetch } from "@/lib/bff-client";

/**
 * Única fonte de verdade para "o simulador biométrico está habilitado".
 * NUNCA ler NEXT_PUBLIC_BIOMETRIC_SIMULATOR_ENABLED direto — é uma env var
 * de build do CF Pages, dessincronizada da flag real do BFF
 * (BIOMETRIC_SIMULATOR_ENABLED, VPS). Sempre consulta o backend, que já
 * aplica o gate real (NODE_ENV !== "production" && BIOMETRIC_SIMULATOR_ENABLED).
 */
export function useBiometricSimulatorAvailable(reserveId: string | null | undefined): boolean {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!reserveId) {
      setAvailable(false);
      return () => { mounted = false; };
    }
    void bffFetch("GET", `/api/biometric/devices?reserve_id=${encodeURIComponent(reserveId)}`, undefined, 8_000)
      .then((res) => {
        if (!mounted) return;
        const data = res.data as { simulator_available?: boolean };
        setAvailable(res.ok && data.simulator_available === true);
      })
      .catch(() => {
        if (mounted) setAvailable(false);
      });
    return () => { mounted = false; };
  }, [reserveId]);

  return available;
}
