
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ComandoClient } from "./_client";

export default async function ComandoPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const allowed = ["admin_global", "superadmin", "admin_reserva"];
  if (!profile || !allowed.includes(profile.role)) redirect("/admin");

  const { data: reserves } = await supabase
    .from("reserves")
    .select("id, nome, acronym")
    .eq("status", "ativa")
    .order("nome");

  return (
    <ComandoClient
      role={profile.role}
      token={session.access_token}
      reserves={reserves ?? []}
    />
  );
}
