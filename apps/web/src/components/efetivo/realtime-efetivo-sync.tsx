"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

export function RealtimeEfetivoSync({ userId }: { userId: string }) {
  useRealtimeRefresh(`efetivo-sync:${userId}`, [
    { table: "profiles", event: "UPDATE", filter: `id=eq.${userId}` },
    { table: "lendings", event: "*", filter: `military_id=eq.${userId}` },
    { table: "material_requests", event: "*", filter: `military_id=eq.${userId}` },
  ]);
  return null;
}
