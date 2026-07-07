"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

export function RealtimeEfetivoSync({ userId }: { userId: string }) {
  useRealtimeRefresh(`efetivo-sync:${userId}`, [
    { table: "profiles", event: "UPDATE", filter: `id=eq.${userId}` },
    { table: "lendings", event: "*", filter: `military_id=eq.${userId}` },
    // No client-side filter on material_requests: Supabase Realtime drops UPDATE events
    // when the filter column (military_id) is not in the UPDATE SET clause.
    // RLS (military_id = auth.uid()) enforces the same row-level isolation.
    { table: "material_requests", event: "*" },
  ]);
  return null;
}
