export const runtime = 'edge';

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, registration_status")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  if (profile.role === "admin_global" || profile.role === "superadmin") redirect("/admin");
  if (profile.role === "armeiro" || profile.role === "admin_reserva") redirect("/reserva");
  redirect("/cadete");
}
