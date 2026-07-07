
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SaidasClient } from "./_saidas-client";
import { resolvePhotoUrl } from "@/lib/storage";
import { RealtimeArmeiroSync } from "@/components/reserva/realtime-armeiro-sync";

export default async function SaidasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; limit?: string }>;
}) {
  const { status, limit: limitParam } = await searchParams;
  const limit = Math.min(Math.max(parseInt(limitParam ?? "10") || 10, 10), 30);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome_completo")
    .eq("id", user.id)
    .single();

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
      .select("reserve:reserves(nome, logo_url)")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const reserve = membership?.reserve as unknown as { nome: string; logo_url: string | null } | null;

  const raw = saidas ?? [];
  const hasMore = raw.length > limit;
  const pagedSaidas = hasMore ? raw.slice(0, limit) : raw;

  // Resolve signed URLs para fotos — deduplica por military.id para não fazer chamadas repetidas
  const uniqueMilitaryIds = new Set<string>();
  const photoMap = new Map<string, string | null>();
  for (const s of pagedSaidas) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mil = s.military as any;
    if (mil?.id && !uniqueMilitaryIds.has(mil.id)) {
      uniqueMilitaryIds.add(mil.id as string);
    }
  }
  await Promise.all(
    Array.from(uniqueMilitaryIds).map(async (milId) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = pagedSaidas.find((r) => (r.military as any)?.id === milId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const foto = (s?.military as any)?.foto_url ?? null;
      photoMap.set(milId, await resolvePhotoUrl(foto, supabase));
    })
  );
  const resolvedSaidas = pagedSaidas.map((s) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mil = s.military as any;
    if (!mil?.id) return s;
    return { ...s, military: { ...mil, foto_url: photoMap.get(mil.id) ?? null } };
  });

  return (
    <>
    <RealtimeArmeiroSync />
    <SaidasClient
      saidas={resolvedSaidas as any[]}
      currentStatus={status ?? ""}
      role={profile?.role ?? "armeiro"}
      hasMore={hasMore}
      currentLimit={limit}
      reserveName={reserve?.nome}
      armeiroName={profile?.nome_completo ?? undefined}
      tenantLogoUrl={reserve?.logo_url ?? undefined}
    />
    </>
  );
}
