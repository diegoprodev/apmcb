export const runtime = "edge";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileClient } from "./_profile-client";

export default async function PerfilPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, nome_completo, role, matricula, posto, foto_url")
    .eq("id", user.id)
    .single();

  if (!profile) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Perfil</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dados pessoais, foto e preferencias basicas.
        </p>
      </div>
      <ProfileClient
        userId={profile.id}
        name={profile.nome_completo ?? user.email ?? "Usuario"}
        role={profile.role}
        matricula={profile.matricula ?? null}
        posto={profile.posto ?? null}
        photoUrl={profile.foto_url ?? null}
      />
    </div>
  );
}
