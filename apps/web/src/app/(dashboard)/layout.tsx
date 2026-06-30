
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { RoleWatcher } from "@/components/layout/role-watcher";
import { resolvePhotoUrl } from "@/lib/storage";
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

  const userPhoto = await resolvePhotoUrl(profile.foto_url, supabase);
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
    const isUsuario   = profile.role === "usuario";
    const isAdminRole = profile.role === "admin_global" || profile.role === "superadmin";

    // Para staff (admin/armeiro/auditor): busca reserva via membership
    // Para usuario (cadete): não tem reserve_membership — nome vem do tenant
    const membershipPromise = !isUsuario
      ? supabase
          .from("reserve_memberships")
          .select("reserve_id")
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null });

    const { data: reserveMembership } = await membershipPromise;
    currentReserveId = reserveMembership?.reserve_id ?? null;

    const [brandingResult, orgNameResult, allReservesResult] = await Promise.all([
      supabase
        .from("tenant_branding")
        .select("primary_hex, secondary_hex, reserve_logo_url")
        .eq("tenant_id", profile.default_tenant_id)
        .maybeSingle(),
      // usuario: nome do batalhão (tenant.nome) — onde foi cadastrado
      // staff: nome da reserva (por membership ou 1ª ativa do tenant)
      isUsuario
        ? supabase
            .from("tenants")
            .select("nome, acronym")
            .eq("id", profile.default_tenant_id)
            .maybeSingle()
        : currentReserveId
          ? supabase.from("reserves").select("id, nome, acronym").eq("id", currentReserveId).single()
          : supabase
              .from("reserves")
              .select("id, nome, acronym")
              .eq("tenant_id", profile.default_tenant_id)
              .eq("status", "ativa")
              .order("nome")
              .limit(1)
              .maybeSingle(),
      // lista de reservas para switcher:
      //   admin_global/superadmin → todas ativas do tenant
      //   armeiro/admin_reserva  → apenas as que têm membership
      //   demais                 → sem lista (sem switcher)
      isAdminRole
        ? supabase
            .from("reserves")
            .select("id, nome, acronym")
            .eq("tenant_id", profile.default_tenant_id)
            .eq("status", "ativa")
            .order("nome")
        : (profile.role === "armeiro" || profile.role === "admin_reserva")
          ? supabase
              .from("reserve_memberships")
              .select("reserve:reserves(id, nome, acronym)")
              .eq("user_id", user.id)
          : Promise.resolve({ data: null }),
    ]);

    if (brandingResult.data) {
      primaryHex = brandingResult.data.primary_hex ?? primaryHex;
      secondaryHex = brandingResult.data.secondary_hex ?? secondaryHex;
      reserveLogoUrl = brandingResult.data.reserve_logo_url ?? null;
    }
    if (orgNameResult.data) {
      const r = orgNameResult.data as { id?: string; nome: string; acronym?: string };
      reserveName = r.nome ?? r.acronym ?? null;
      if (!isUsuario && !currentReserveId && r.id) currentReserveId = r.id;
    }
    if (allReservesResult.data) {
      if (isAdminRole) {
        // admin: shape direto { id, nome, acronym }[]
        reserves = allReservesResult.data as { id: string; nome: string; acronym: string }[];
      } else {
        // armeiro/admin_reserva: Supabase join retorna array — reserve: { id, nome, acronym }[]
        type MembershipRow = { reserve: { id: string; nome: string; acronym: string }[] };
        reserves = (allReservesResult.data as unknown as MembershipRow[])
          .flatMap((m) => m.reserve ?? [])
          .filter((r) => r?.id);
      }
    }
  }

  // Ler modo ativo via cookies setados pelo BFF com domain=".pmpb.online"
  // O cookie apmcb_mode é setado pelo BFF em POST /api/session/mode
  // e fica acessível ao Next.js SSR porque o browser o inclui em qualquer
  // request para subdomínios de pmpb.online.
  const cookieStore = await cookies();
  const modeCookie = cookieStore.get("apmcb_mode")?.value;
  const roleInfoCookie = cookieStore.get("apmcb_role_info")?.value;

  const activeMode: "usuario" | null = modeCookie === "usuario" ? "usuario" : null;
  const roleInfoParts = roleInfoCookie?.split(":") ?? [];
  const originalRole: string | null = roleInfoParts[0] ?? null;
  const roleLabel: string | null = roleInfoParts[1] ?? null;

  // Map DB roles (Fase 2 RBAC) → UI nav roles
  // Modo usuário força UI como usuario independente do role real no DB
  const uiRole: Role = activeMode === "usuario"
    ? "usuario"
    : profile.role === "admin_global" || profile.role === "superadmin" || profile.role === "auditor"
      ? "admin"
      : profile.role === "armeiro" || profile.role === "admin_reserva"
      ? "master"
      : "usuario";

  return (
    <>
      {userPhoto ? <link rel="preload" as="image" href={userPhoto} /> : null}
      <style>{`:root { --color-primary: ${primaryHex}; --color-secondary: ${secondaryHex}; }`}</style>
      <RoleWatcher />
      <AppShell
        role={uiRole}
        userName={userName}
        userGreeting={userGreeting}
        userPhoto={userPhoto}
        reserveLogoUrl={reserveLogoUrl}
        reserveName={reserveName}
        reserves={reserves}
        currentReserveId={currentReserveId}
        activeMode={activeMode ?? undefined}
        originalRole={originalRole ?? undefined}
        roleLabel={roleLabel ?? undefined}
        dbRole={profile.role}
      >
        {children}
      </AppShell>
    </>
  );
}
