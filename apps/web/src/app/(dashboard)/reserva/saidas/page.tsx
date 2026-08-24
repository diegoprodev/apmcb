
import { createClient } from "@/lib/supabase/server";
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { redirect } from "next/navigation";
import { SaidasClient, type LendingRow } from "./_saidas-client";
import { RealtimeArmeiroSync } from "@/components/reserva/realtime-armeiro-sync";

export default async function SaidasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; limit?: string }>;
}) {
  const { status, limit: limitParam } = await searchParams;
  const limit = Math.min(Math.max(parseInt(limitParam ?? "10") || 10, 10), 30);

  const supabase = await createClient();
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getSessionProfile(user.id);

  if (
    profile?.role !== "armeiro" &&
    profile?.role !== "admin_global" &&
    profile?.role !== "admin_reserva" &&
    profile?.role !== "superadmin"
  ) redirect("/");

  let query = supabase
    .from("lendings")
    .select(`
      id, quantidade, status_legacy, issued_at, returned_at, local, notes, auth_mode, material_request_id, movement_id,
      material_type:material_types(nome, categoria),
      military:profiles!lendings_military_id_fkey(id, nome_completo, matricula, posto, foto_url),
      master:profiles!lendings_master_id_fkey(nome_completo, matricula)
    `)
    .order("issued_at", { ascending: false })
    .limit(limit + 1);

  if (status === "ativo" || status === "devolvido") {
    query = query.eq("status_legacy", status);
  }

  const [{ data: saidas }, { data: membership }] = await Promise.all([
    query,
    supabase
      .from("reserve_memberships")
      .select("reserve:reserves(id, nome, logo_url)")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const reserve = membership?.reserve as unknown as { id: string; nome: string; logo_url: string | null } | null;

  const raw = saidas ?? [];
  const hasMore = raw.length > limit;
  const pagedSaidas = hasMore ? raw.slice(0, limit) : raw;

  return (
    <>
    {profile?.default_tenant_id && <RealtimeArmeiroSync tenantId={profile.default_tenant_id} />}
    <SaidasClient
      saidas={pagedSaidas as unknown as LendingRow[]}
      currentStatus={status ?? ""}
      role={profile?.role ?? "armeiro"}
      hasMore={hasMore}
      reserveName={reserve?.nome}
      reserveId={reserve?.id}
      armeiroName={profile?.nome_completo ?? undefined}
      tenantLogoUrl={reserve?.logo_url ?? undefined}
    />
    </>
  );
}
