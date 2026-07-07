"use client";

import { useMemo } from "react";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

export function RealtimeArsenalSync({ tenantId }: { tenantId: string }) {
  // filter by tenant_id ensures Supabase Realtime can evaluate RLS correctly in WAL context
  const subs = useMemo(() => [
    { table: "material_items", event: "*" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_types", event: "*" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "lendings", event: "*" as const, filter: `tenant_id=eq.${tenantId}` },
  ], [tenantId]);

  useRealtimeRefresh(`arsenal-sync:${tenantId}`, subs);
  return null;
}
