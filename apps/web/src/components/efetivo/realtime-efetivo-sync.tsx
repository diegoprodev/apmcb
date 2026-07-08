"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

// Supabase Realtime postgres_changes filters only work with specific events (INSERT/UPDATE/DELETE),
// NOT with event: "*". Splitting into explicit events is required when using a filter.
export function RealtimeEfetivoSync({ userId }: { userId: string }) {
  useRealtimeRefresh(`efetivo-sync:${userId}`, [
    { table: "profiles", event: "UPDATE", filter: `id=eq.${userId}` },
    { table: "lendings", event: "INSERT", filter: `military_id=eq.${userId}` },
    { table: "lendings", event: "UPDATE", filter: `military_id=eq.${userId}` },
    { table: "lendings", event: "DELETE", filter: `military_id=eq.${userId}` },
    { table: "material_requests", event: "INSERT", filter: `military_id=eq.${userId}` },
    { table: "material_requests", event: "UPDATE", filter: `military_id=eq.${userId}` },
    { table: "material_requests", event: "DELETE", filter: `military_id=eq.${userId}` },
  ]);
  return null;
}
