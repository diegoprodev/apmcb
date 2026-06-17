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
    .select("role, nome_completo, foto_url, registration_status, posto, nome_de_guerra")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  // Biometria pendente não bloqueia mais — militar acessa o dashboard normalmente.
  // O sistema TOTP + SSA funciona independente do status biométrico.

  const userName = profile.nome_completo ?? user.email ?? "Militar";
  const userGreeting =
    [profile.posto, profile.nome_de_guerra].filter(Boolean).join(" ") ||
    profile.nome_completo?.split(" ")[0] ||
    "Militar";

  return (
    <AppShell
      role={profile.role as Role}
      userName={userName}
      userGreeting={userGreeting}
      userPhoto={profile.foto_url}
    >
      {children}
    </AppShell>
  );
}
