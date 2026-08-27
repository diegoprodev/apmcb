"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export type SSEPayload = {
  table: string;
  type: string;
  row?: Record<string, unknown>;
};

/**
 * Connects to the BFF SSE Realtime proxy and calls router.refresh() (or the
 * provided onEvent callback) whenever a change event arrives.
 *
 * Security: JWT never leaves the BFF — the BFF authenticates via iron-session
 * (HttpOnly cookie) and subscribes to Supabase Realtime with the service role.
 * The browser only receives { table, type } signals (plus row data for nexus channels).
 *
 * channel must be stable across renders. onEvent, if provided, must be a stable
 * reference (useCallback) — it is intentionally excluded from the effect deps to
 * avoid reconnecting on every render.
 */
export function useSSERefresh(
  channel: string,
  onEvent?: (payload: SSEPayload) => void
) {
  const router = useRouter();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRunRef = useRef(0);

  useEffect(() => {
    if (!BFF_URL || !channel) return;

    const url = `${BFF_URL}/api/realtime/stream?channel=${encodeURIComponent(channel)}`;
    const es = new EventSource(url, { withCredentials: true });

    es.addEventListener("ready", () => {
      (window as Window & { __rtReady?: boolean }).__rtReady = true;
    });

    es.addEventListener("change", (e: MessageEvent<string>) => {
      if (onEvent) {
        try {
          onEvent(JSON.parse(e.data) as SSEPayload);
        } catch {}
        return;
      }
      // Achado de code review: sem throttle, uma rajada de eventos (ex:
      // aprovação em lote) disparava um router.refresh() por evento — cada
      // um recomputa a árvore RSC inteira da rota atual, incluindo dados
      // que não mudam entre eventos (branding, sessão). Throttle com
      // trailing call: 1º evento de uma janela refresca na hora; eventos
      // seguintes dentro de 1s são coalescidos num único refresh ao final
      // da janela — no máximo 1 refresh/s, nunca zero (diferente de um
      // debounce simples, que atrasaria todo evento isolado e poderia
      // nunca disparar sob fluxo contínuo).
      const elapsed = Date.now() - lastRunRef.current;
      if (elapsed >= 1000) {
        lastRunRef.current = Date.now();
        router.refresh();
      } else if (!refreshTimer.current) {
        refreshTimer.current = setTimeout(() => {
          refreshTimer.current = null;
          lastRunRef.current = Date.now();
          router.refresh();
        }, 1000 - elapsed);
      }
    });

    // ping events are keepalive — no action needed.

    return () => {
      es.close();
      (window as Window & { __rtReady?: boolean }).__rtReady = false;
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
    // router is stable in Next.js App Router. onEvent is excluded intentionally —
    // callers must pass a stable ref (useCallback). Reconnecting on every render
    // would be destructive for a long-lived SSE connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);
}
