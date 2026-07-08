"use client";

import { useSSERefresh } from "@/hooks/use-sse-refresh";

export function RealtimeEfetivoSync({ userId: _ }: { userId: string }) {
  // Channel subscriptions are constructed server-side from the iron-session —
  // userId is not needed here (the BFF reads it from the authenticated session).
  useSSERefresh("efetivo-sync");
  return null;
}
