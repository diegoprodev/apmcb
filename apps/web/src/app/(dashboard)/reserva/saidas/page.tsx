
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { SaidasClient } from "./_saidas-client";

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

  return (
    <SaidasClient
      saidas={(saidas ?? []) as any[]}
      currentStatus={status ?? ""}
      role={profile?.role ?? "armeiro"}
    />
  );
}
