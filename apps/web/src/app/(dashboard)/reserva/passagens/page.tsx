export const runtime = "edge";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { PassagensClient } from "./_client";

export default async function PassagensPage() {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, reserve_id:user_reserve_preferences(reserve_id)")
    .eq("id", session.user.id)
    .single();

  const allowed = ["armeiro", "admin_reserva", "admin_global", "superadmin"];
  if (!profile || !allowed.includes(profile.role)) redirect("/reserva");

  const reserveId =
    (profile.reserve_id as { reserve_id: string }[] | null)?.[0]?.reserve_id ?? null;

  return (
    <PassagensClient
      token={session.access_token}
      role={profile.role}
      reserveId={reserveId}
    />
  );
}
