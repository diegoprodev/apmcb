
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { RoleWatcher } from "@/components/layout/role-watcher";
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
    .select("role, nome_completo, foto_url, registration_status, posto, nome_de_guerra, default_tenant_id")
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

  // Branding do tenant — injeta CSS custom properties e logo da reserva
  let primaryHex = "#0f172a";
  let secondaryHex = "#3b82f6";
  let reserveLogoUrl: string | null = null;
  if (profile.default_tenant_id) {
    const { data: branding } = await supabase
      .from("tenant_branding")
      .select("primary_hex, secondary_hex, reserve_logo_url")
      .eq("tenant_id", profile.default_tenant_id)
      .maybeSingle();
    if (branding) {
      primaryHex = branding.primary_hex ?? primaryHex;
      secondaryHex = branding.secondary_hex ?? secondaryHex;
      reserveLogoUrl = branding.reserve_logo_url ?? null;
    }
  }

  // Map DB roles (Fase 2 RBAC) → UI nav roles
  const uiRole: Role =
    profile.role === "admin_global" || profile.role === "superadmin" || profile.role === "auditor"
      ? "admin"
      : profile.role === "armeiro" || profile.role === "admin_reserva"
      ? "master"
      : "usuario";

  return (
    <>
      <style>{`:root { --color-primary: ${primaryHex}; --color-secondary: ${secondaryHex}; }`}</style>
      <RoleWatcher />
      <AppShell
        role={uiRole}
        userName={userName}
        userGreeting={userGreeting}
        userPhoto={profile.foto_url}
        reserveLogoUrl={reserveLogoUrl}
      >
        {children}
      </AppShell>
    </>
  );
}
