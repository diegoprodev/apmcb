"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

export function RealtimeEfetivoSync({ userId }: { userId: string }) {
  useRealtimeRefresh(`efetivo-sync:${userId}`, [
    { table: "profiles", event: "UPDATE", filter: `id=eq.${userId}` },
    { table: "lendings", event: "*", filter: `military_id=eq.${userId}` },
    // Filter by military_id: without a client-side filter, Supabase Realtime evaluates
    // full table RLS for every change, and auth.uid() may not resolve in that context.
    // With REPLICA IDENTITY FULL, military_id is in WAL for all events (old + new rows),
    // so the filter correctly matches UPDATE events even when military_id is not in SET.
    { table: "material_requests", event: "*", filter: `military_id=eq.${userId}` },
  ]);
  return null;
}
