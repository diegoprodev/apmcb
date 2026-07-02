
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SaidasClient } from "./_saidas-client";
import { resolvePhotoUrl } from "@/lib/storage";

export default async function SaidasPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
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
    .limit(200);

  if (status === "ativo" || status === "devolvido") {
    query = query.eq("status_legacy", status);
  }

  const { data: saidas } = await query;

  // Resolve signed URLs para fotos — deduplica por military.id para não fazer chamadas repetidas
  const uniqueMilitaryIds = new Set<string>();
  const photoMap = new Map<string, string | null>();
  for (const s of saidas ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mil = s.military as any;
    if (mil?.id && !uniqueMilitaryIds.has(mil.id)) {
      uniqueMilitaryIds.add(mil.id as string);
    }
  }
  await Promise.all(
    Array.from(uniqueMilitaryIds).map(async (milId) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = (saidas ?? []).find((r) => (r.military as any)?.id === milId);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const foto = (s?.military as any)?.foto_url ?? null;
      photoMap.set(milId, await resolvePhotoUrl(foto, supabase));
    })
  );
  const resolvedSaidas = (saidas ?? []).map((s) => {
    const mil = s.military as any;
    if (!mil?.id) return s;
    return { ...s, military: { ...mil, foto_url: photoMap.get(mil.id) ?? null } };
  });

  return (
    <SaidasClient
      saidas={resolvedSaidas as any[]}
      currentStatus={status ?? ""}
      role={profile?.role ?? "armeiro"}
    />
  );
}
