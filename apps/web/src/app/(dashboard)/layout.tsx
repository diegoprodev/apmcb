
// Renderiza por-usuário via cookies() — detecção automática de rota dinâmica
// já se mostrou não confiável no adaptador CF Pages (causa raiz confirmada
// do incidente de session-bleed em /api/auth/upgrade-session). Declarar
// explicitamente evita que essa árvore inteira (todo o dashboard) seja
// servida em cache para o usuário errado.
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";
import { RoleWatcher } from "@/components/layout/role-watcher";
import { resolvePhotoUrl } from "@/lib/storage";
import { decideSessionMismatch } from "@/lib/session-mismatch";
import type { Role } from "@/hooks/use-role";


export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const cookieStore = await cookies();
  let { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Mitigação do incidente de session-bleed (ver middleware.ts,
  // resolveVerifiedUserId) — o middleware resolveu a identidade do cookie
  // de sessão de forma independente, direto do objeto Request (não via
  // cookies()/next/headers, a mesma camada usada por supabase.auth.getUser()
  // acima, cuja confiabilidade está em questão no incidente). Se divergir,
  // não é seguro renderizar nenhum conteúdo por-usuário desta árvore.
  const verifiedUserId = (await headers()).get("x-verified-user-id");
  if (verifiedUserId && verifiedUserId !== user.id) {
    // middleware.ts resolveu x-verified-user-id chamando o BFF (iron-session,
    // cookie selado — decodificação local, determinística por cookie) em
    // paralelo à validação do JWT contra o Supabase Auth acima (round-trip
    // de rede real a cada chamada — é o lado que pode legitimamente variar
    // entre duas leituras). Uma divergência isolada logo após login pode
    // refletir só propagação ainda não concluída nesse round-trip, não
    // necessariamente vazamento real de sessão entre usuários. Reconfirma
    // pelo MESMO lado que pode ter causado a divergência (Supabase, não o
    // BFF — re-checar o BFF não teria efeito: mesmo cookie sempre resolve
    // pro mesmo user_id). decideSessionMismatch nunca trata falha/timeout do
    // recheck como "ok" — mantém fail-closed se a revalidação for inconclusiva.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const { data: { user: recheckedUser } } = await supabase.auth.getUser();
    const decision = decideSessionMismatch(verifiedUserId, recheckedUser?.id);

    if (decision.kind === "redirect") {
      // Evento de segurança — log estruturado pra confirmar/investigar o
      // incidente de session-bleed em produção (server-side apenas, nunca
      // chega no client).
      console.error("[session-mismatch]", {
        resolvedByNext: user.id,
        verifiedByBff: verifiedUserId,
        recheckedByNext: recheckedUser?.id ?? null,
        reason: decision.reason,
        at: new Date().toISOString(),
      });

      if (decision.reason === "persistent") {
        // Divergência CONFIRMADA entre duas identidades distintas (duas
        // leituras independentes do Supabase concordam que o usuário não é
        // quem o BFF verificou) — o cenário exato que este guard existe para
        // pegar (incidente de session-bleed). Mantém fail-closed sempre,
        // mesmo durante a suspensão abaixo — nunca renderizar dashboard com
        // identidade divergente confirmada.
        redirect("/auth/session-mismatch");
      }

      // AÇÃO DE DERRUBAR SESSÃO SUSPENSA TEMPORARIAMENTE (2026-07-17) — só
      // para reason "inconclusive" (recheck deu timeout/erro, não uma
      // divergência confirmada). Achado real de produção: usuário em PWA
      // instalado no iOS (canal primário de uso do sistema) sendo deslogado
      // poucos segundos após login OU após sessão restaurada com sucesso,
      // mesmo depois de 2 rodadas de fix em SameSite de cookies
      // (apmcb_session e sb-*). Hipótese mais provável: PWA saindo de
      // background / rede instável colidindo com a janela de 300ms do
      // recheck, fazendo a segunda leitura do Supabase falhar por timeout —
      // não uma divergência real. A mitigação original do incidente de
      // session-bleed (force-dynamic, linha 7) permanece ativa. Segue o
      // render com a PRIMEIRA identidade resolvida (user, já validada pelo
      // getUser() do topo da função) — recheckedUser é null neste caso
      // (é exatamente por isso que é "inconclusive"), então não há
      // identidade alternativa confiável para usar. Reativar o redirect
      // assim que a causa raiz do "inconclusive" no iOS for confirmada.
      console.error("[session-mismatch-ACTION-SUSPENDED]", {
        resolvedByNext: user.id,
        verifiedByBff: verifiedUserId,
        recheckedByNext: recheckedUser?.id ?? null,
        reason: decision.reason,
        at: new Date().toISOString(),
      });
    } else {
      // Divergência confirmada como transitória — loga para acompanhar
      // frequência/tendência (warn, não error: não é mais tratado como
      // incidente) e segue o render com a identidade reconfirmada, não a
      // primeira leitura (potencialmente stale).
      console.warn("[session-mismatch-transient]", {
        resolvedByNext: user.id,
        verifiedByBff: verifiedUserId,
        recheckedByNext: recheckedUser?.id ?? null,
        at: new Date().toISOString(),
      });
      if (recheckedUser) user = recheckedUser;
    }
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome_completo, foto_url, registration_status, posto, nome_de_guerra, default_tenant_id")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  // Biometria pendente não bloqueia mais — militar acessa o dashboard normalmente.
  // O sistema TOTP + SSA funciona independente do status biométrico.

  const userPhoto = await resolvePhotoUrl(profile.foto_url, supabase);
  const userName = profile.nome_completo ?? user.email ?? "Usuário";
  const shortName = profile.nome_de_guerra || profile.nome_completo?.split(" ")[0] || "Usuário";

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
