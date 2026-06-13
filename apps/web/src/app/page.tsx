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

  if (profile.role === "admin") redirect("/admin");
  if (profile.role === "master") redirect("/armeiro");
  if (profile.registration_status === "complete") redirect("/cadete");
  redirect("/registro-pendente");
}
