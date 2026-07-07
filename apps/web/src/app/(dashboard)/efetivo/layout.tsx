import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { RealtimeEfetivoSync } from "@/components/efetivo/realtime-efetivo-sync";

export default async function EfetivoLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <>
      <RealtimeEfetivoSync userId={user.id} />
      {children}
    </>
  );
}
