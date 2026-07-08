"use client";

import { useSSERefresh } from "@/hooks/use-sse-refresh";

export function RealtimeArsenalSync({ tenantId: _ }: { tenantId: string }) {
  useSSERefresh("arsenal-sync");
  return null;
}
