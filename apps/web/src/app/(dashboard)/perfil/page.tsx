export const runtime = "edge";

import { redirect } from "next/navigation";
import { getSessionUser, getSessionProfile } from "@/lib/session-profile";
import { ProfileClient } from "./_profile-client";

export default async function PerfilPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getSessionProfile(user.id);

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
        name={profile.nome_completo ?? user.email ?? "Usuario"}
        profileId={profile.id}
        role={profile.role}
        matricula={profile.matricula ?? null}
        posto={profile.posto ?? null}
        nomeDeGuerra={profile.nome_de_guerra ?? null}
        photoPath={profile.foto_url}
        totpConfigured={profile.totp_configured ?? false}
      />
    </div>
  );
}
