"use client";

import { useMemo } from "react";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

// Supabase Realtime postgres_changes filters only work with specific events, not event: "*".
export function RealtimeArsenalSync({ tenantId }: { tenantId: string }) {
  const subs = useMemo(() => [
    { table: "material_items", event: "INSERT" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_items", event: "UPDATE" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_items", event: "DELETE" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_types", event: "INSERT" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_types", event: "UPDATE" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_types", event: "DELETE" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "lendings", event: "INSERT" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "lendings", event: "UPDATE" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "lendings", event: "DELETE" as const, filter: `tenant_id=eq.${tenantId}` },
  ], [tenantId]);

  useRealtimeRefresh(`arsenal-sync:${tenantId}`, subs);
  return null;
}
