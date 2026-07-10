
// Decide o redirect por-usuário via cookies()/getUser() — mesma categoria de
// risco de cache cross-user do incidente de session-bleed (fora do route
// group (dashboard), não herda o force-dynamic do layout).
export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Staff em modo usuário vai direto para /cadete
  const cookieStore = await cookies();
  if (cookieStore.get("apmcb_mode")?.value === "usuario") redirect("/efetivo");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, registration_status")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  if (profile.role === "admin_global" || profile.role === "superadmin") redirect("/admin");
  if (profile.role === "armeiro" || profile.role === "admin_reserva") redirect("/reserva");
  redirect("/efetivo");
}
