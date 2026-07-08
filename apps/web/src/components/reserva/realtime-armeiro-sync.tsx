"use client";

import { useSSERefresh } from "@/hooks/use-sse-refresh";

export function RealtimeArmeiroSync({ tenantId: _ }: { tenantId: string }) {
  useSSERefresh("armeiro-sync");
  return null;
}
