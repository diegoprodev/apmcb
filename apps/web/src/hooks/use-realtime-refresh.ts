"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export type RealtimeSub = {
  table: string;
  event: "INSERT" | "UPDATE" | "DELETE" | "*";
  filter?: string;
};

/**
 * Subscribes to one or more postgres_changes events and calls router.refresh()
 * on any match. Correct pattern for Next.js App Router server components.
 *
 * subs must be stable (module-level const or useMemo'd) to avoid channel churn.
 * channelName encodes uniqueness — changing it (e.g., embedding userId) causes
 * the effect to re-run with the new subs.
 */
export function useRealtimeRefresh(channelName: string, subs: RealtimeSub[]) {
  const router = useRouter();
  const subsKey = subs.map((s) => `${s.table}:${s.event}:${s.filter ?? ""}`).join("|");

  useEffect(() => {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let channel: any = null;
    let cancelled = false;

    // createBrowserClient initializes the session asynchronously via initializePromise.
    // Subscribing before getSession() resolves means the channel joins with the anon JWT
    // (auth.uid() = NULL in RLS), so all postgres_changes events are filtered out.
    // Awaiting getSession() ensures realtime.setAuth(jwt) has been called first.
    supabase.auth.getSession().then(() => {
      if (cancelled) return;
      channel = supabase.channel(channelName);

      // Supabase Realtime rejects event:"*" combined with a filter with "Unable to subscribe
      // to changes". Expand "*" into explicit INSERT/UPDATE/DELETE when a filter is present.
      const expanded: RealtimeSub[] = subs.flatMap((s) =>
        s.event === "*" && s.filter
          ? (["INSERT", "UPDATE", "DELETE"] as const).map((ev) => ({ ...s, event: ev }))
          : [s]
      );

      for (const s of expanded) {
        // channel is typed as any so the overloaded on() accepts all event literals
        channel = channel.on("postgres_changes", {
          event: s.event,
          schema: "public",
          table: s.table,
          ...(s.filter ? { filter: s.filter } : {}),
        }, () => router.refresh());
      }
      channel.subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          // E2E signal: use window flag instead of html attribute to avoid
          // React #418 hydration mismatch when router.refresh() re-renders <html>.
          (window as Window & { __rtReady?: boolean }).__rtReady = true;
        }
      });
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  // subsKey serializes stable subs; channelName changes when userId changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, subsKey, router]);
}
