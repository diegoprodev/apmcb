"use client";

import { useMemo } from "react";
import { useRealtimeRefresh } from "@/hooks/use-realtime-refresh";

export function RealtimeArmeiroSync({ tenantId }: { tenantId: string }) {
  // filter by tenant_id ensures Supabase Realtime can evaluate RLS correctly in WAL context
  const subs = useMemo(() => [
    { table: "lendings", event: "*" as const, filter: `tenant_id=eq.${tenantId}` },
    { table: "material_requests", event: "*" as const, filter: `tenant_id=eq.${tenantId}` },
  ], [tenantId]);

  useRealtimeRefresh(`armeiro-sync:${tenantId}`, subs);
  return null;
}
