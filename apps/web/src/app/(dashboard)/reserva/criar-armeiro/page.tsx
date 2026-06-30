export const runtime = "edge";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CriarArmeiroClient } from "./_criar-armeiro-client";

export default async function CriarArmeiroPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (
    profile?.role !== "admin_reserva" &&
    profile?.role !== "admin_global" &&
    profile?.role !== "superadmin" &&
    profile?.role !== "armeiro"
  ) {
    redirect("/reserva");
  }

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Convidar para Reserva</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Envie convite de acesso ao sistema para um membro da reserva.
        </p>
      </div>
      <CriarArmeiroClient callerRole={profile?.role ?? "armeiro"} />
    </div>
  );
}
