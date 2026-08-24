import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser } from "@/lib/session-profile";
import { RealtimeEfetivoSync } from "@/components/efetivo/realtime-efetivo-sync";

export default async function EfetivoLayout({ children }: { children: ReactNode }) {
  // PERF-02: getSessionUser() (cache() do React) — reaproveita a mesma
  // identidade já resolvida por (dashboard)/layout.tsx dentro deste
  // request. createClient() local removido — sem outro uso neste arquivo.
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return (
    <>
      <RealtimeEfetivoSync userId={user.id} />
      {children}
    </>
  );
}
