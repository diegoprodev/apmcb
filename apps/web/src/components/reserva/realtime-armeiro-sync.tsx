"use client";

import { useMemo } from "react";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

// Supabase Realtime postgres_changes filters only work with specific events, not event: "*".
export function RealtimeArmeiroSync({ tenantId }: { tenantId: string }) {
  const subs = useMemo(() => [
    { table: "lendings", event: "INSERT" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "lendings", event: "UPDATE" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "lendings", event: "DELETE" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_requests", event: "INSERT" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_requests", event: "UPDATE" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_requests", event: "DELETE" as const, filter: `tenant_id=eq.${tenantId}` },
  ], [tenantId]);

  useRealtimeRefresh(`armeiro-sync:${tenantId}`, subs);
  return null;
}
