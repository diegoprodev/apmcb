export const runtime = 'edge';

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import type { Role } from "@/hooks/use-role";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome_completo, foto_url, registration_status")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  if (profile.role === "military" && profile.registration_status !== "complete") {
    redirect("/registro-pendente");
  }

  const userName = profile.nome_completo ?? user.email ?? "Militar";

  return (
    <AppShell
      role={profile.role as Role}
      userName={userName}
      userPhoto={profile.foto_url}
    >
      {children}
    </AppShell>
  );
}
