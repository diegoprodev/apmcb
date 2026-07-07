"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

const SUBS = [
  { table: "lendings", event: "*" as const },
  { table: "material_requests", event: "*" as const },
];

export function RealtimeArmeiroSync() {
  useRealtimeRefresh("armeiro-sync", SUBS);
  return null;
}
