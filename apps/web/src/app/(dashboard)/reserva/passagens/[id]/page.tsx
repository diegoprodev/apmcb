export const runtime = "edge";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { HandoverDetail } from "./_detail";

export default async function PassagemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, id")
    .eq("id", session.user.id)
    .single();

  const allowed = ["armeiro", "admin_reserva", "admin_global", "superadmin"];
  if (!profile || !allowed.includes(profile.role)) redirect("/reserva");

  // Get armeiro list for admin assignment
  const { data: armeiroList } = await supabase
    .from("profiles")
    .select("id, nome_completo, matricula, posto")
    .eq("role", "armeiro")
    .order("nome_completo");

  return (
    <HandoverDetail
      handoverId={id}
      token={session.access_token}
      currentUserId={session.user.id}
      role={profile.role}
      armeiroList={(armeiroList ?? []).map((a) => ({
        id: a.id,
        nome_completo: a.nome_completo ?? "",
        matricula: a.matricula ?? "",
        posto: a.posto ?? null,
      }))}
    />
  );
}
