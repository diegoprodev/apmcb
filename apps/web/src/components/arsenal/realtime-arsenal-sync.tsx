"use client";

import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

const SUBS = [
  { table: "material_items", event: "*" as const },
  { table: "material_types", event: "*" as const },
  { table: "lendings", event: "*" as const }, // affects quantidade_armada in material_availability view
];

export function RealtimeArsenalSync() {
  useRealtimeRefresh("arsenal-sync", SUBS);
  return null;
}
