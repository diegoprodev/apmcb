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
    let channel: any = supabase.channel(channelName);
    for (const s of subs) {
      // channel is typed as any so the overloaded on() accepts all event literals
      channel = channel.on("postgres_changes", {
        event: s.event,
        schema: "public",
        table: s.table,
        ...(s.filter ? { filter: s.filter } : {}),
      }, () => router.refresh());
    }
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  // subsKey serializes stable subs; channelName changes when userId changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelName, subsKey, router]);
}
