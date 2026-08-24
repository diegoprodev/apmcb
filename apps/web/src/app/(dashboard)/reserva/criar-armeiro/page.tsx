export const runtime = "edge";

import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { redirect } from "next/navigation";
import { CriarArmeiroClient } from "./_criar-armeiro-client";

export default async function CriarArmeiroPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getSessionProfile(user.id);

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
