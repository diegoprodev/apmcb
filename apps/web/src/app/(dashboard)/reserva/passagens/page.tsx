
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PassagensClient } from "./_client";

export default async function PassagensPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", session.user.id)
    .single();

  const allowed = ["armeiro", "admin_reserva", "admin_global", "superadmin"];
  if (!profile || !allowed.includes(profile.role)) redirect("/reserva");

  // Use reserve_memberships — works for all roles including armeiro
  const { data: memberships } = await supabase
    .from("reserve_memberships")
    .select("reserve_id")
    .eq("user_id", session.user.id)
    .limit(10);

  const reserveId = (memberships ?? [])[0]?.reserve_id ?? null;
  const reserveIds = (memberships ?? []).map((m) => m.reserve_id);

  return (
    <PassagensClient
      token={session.access_token}
      role={profile.role}
      reserveId={reserveId}
      reserveIds={reserveIds}
    />
  );
}
