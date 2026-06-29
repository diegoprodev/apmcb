
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
  const shortName = profile.nome_de_guerra || profile.nome_completo?.split(" ")[0] || "Militar";

  // Mapeia o valor raw do DB para o label de exibição ("coronel" → "Cel")
  const POSTO_LABELS: Record<string, string> = {
    sd: "Sd", cb: "Cb", "3sgt": "3° Sgt", "2sgt": "2° Sgt", "1sgt": "1° Sgt",
    st: "ST", cad1ano: "Cad 1°", cad2ano: "Cad 2°", cadete: "Cadete",
    aspirante: "Asp", segundo_tenente: "2° Ten", primeiro_tenente: "1° Ten",
    capitao: "Cap", major: "Maj", tenente_coronel: "TC", coronel: "Cel",
  };
  const postoLabel = profile.posto ? (POSTO_LABELS[profile.posto] ?? profile.posto) : null;
  const userGreeting = [
    postoLabel,
    profile.nome_de_guerra || profile.nome_completo?.split(" ")[0],
  ].filter(Boolean).join(" ") || shortName;

  // Branding do tenant — injeta CSS custom properties e logo da reserva
  let primaryHex = "#0f172a";
  let secondaryHex = "#3b82f6";
  let reserveLogoUrl: string | null = null;
  let reserveName: string | null = null;
  let reserves: { id: string; nome: string; acronym: string }[] = [];
  let currentReserveId: string | null = null;

  if (profile.default_tenant_id) {
    const { data: reserveMembership } = await supabase
      .from("reserve_memberships")
      .select("reserve_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    currentReserveId = reserveMembership?.reserve_id ?? null;

    const [brandingResult, reserveResult, allReservesResult] = await Promise.all([
      supabase
        .from("tenant_branding")
        .select("primary_hex, secondary_hex, reserve_logo_url")
        .eq("tenant_id", profile.default_tenant_id)
        .maybeSingle(),
      // nome da reserva atual do usuario
      currentReserveId
        ? supabase
            .from("reserves")
            .select("id, nome, acronym")
            .eq("id", currentReserveId)
            .single()
        : Promise.resolve({ data: null }),
      // lista de reservas (para switcher admin_global)
      (profile.role === "admin_global" || profile.role === "superadmin")
        ? supabase
            .from("reserves")
            .select("id, nome, acronym")
            .eq("tenant_id", profile.default_tenant_id)
            .eq("status", "ativa")
            .order("nome")
        : Promise.resolve({ data: null }),
    ]);

    if (brandingResult.data) {
      primaryHex = brandingResult.data.primary_hex ?? primaryHex;
      secondaryHex = brandingResult.data.secondary_hex ?? secondaryHex;
      reserveLogoUrl = brandingResult.data.reserve_logo_url ?? null;
    }
    if (reserveResult.data) {
      reserveName = reserveResult.data.nome ?? reserveResult.data.acronym ?? null;
    }
    if (allReservesResult.data) {
      reserves = allReservesResult.data as { id: string; nome: string; acronym: string }[];
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
      {profile.foto_url ? <link rel="preload" as="image" href={profile.foto_url} /> : null}
      <style>{`:root { --color-primary: ${primaryHex}; --color-secondary: ${secondaryHex}; }`}</style>
      <RoleWatcher />
      <AppShell
        role={uiRole}
        userName={userName}
        userGreeting={userGreeting}
        userPhoto={profile.foto_url}
        reserveLogoUrl={reserveLogoUrl}
        reserveName={reserveName}
        reserves={reserves}
        currentReserveId={currentReserveId}
      >
        {children}
      </AppShell>
    </>
  );
}
