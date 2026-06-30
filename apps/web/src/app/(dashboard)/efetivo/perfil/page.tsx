
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { User, ShieldCheck, ShieldAlert } from "lucide-react";
import { SignOutButton } from "./_sign-out-button";
import { resolvePhotoUrl } from "@/lib/storage";

export default async function EfetivoPerfilPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, nome_completo, matricula, foto_url, registration_status, posto, created_at")
    .eq("id", user.id)
    .single();

  const cookieStore = await cookies();
  const activeMode = cookieStore.get("apmcb_mode")?.value;
  if (!profile || (profile.role !== "usuario" && activeMode !== "usuario")) redirect("/");

  const fotoUrl = await resolvePhotoUrl(profile.foto_url, supabase);
  const initials = (profile.nome_completo ?? "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase();

  const biometricComplete = profile.registration_status === "complete";

  function registrationBadge(status: string) {
    switch (status) {
      case "complete":
        return (
          <span className="badge-success text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
            Completo
          </span>
        );
      case "pending_biometric":
        return (
          <span className="badge-warning text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
            Biometria pendente
          </span>
        );
      default:
        return (
          <span className="badge-neutral text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
            {status}
          </span>
        );
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Meu Perfil</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Informações da sua conta e biometria
        </p>
      </div>

      {/* Avatar + identity card */}
      <div
        className="rounded-2xl bg-card p-6 flex items-center gap-5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="relative shrink-0">
          {fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fotoUrl}
              alt={profile.nome_completo ?? "Foto"}
              className="w-20 h-20 rounded-2xl object-cover"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold">
              {initials || <User className="size-8" />}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-foreground truncate">
            {profile.nome_completo ?? "—"}
          </h3>
          <p className="text-sm text-muted-foreground">{profile.posto ?? "—"}</p>
          <p className="text-xs text-muted-foreground font-mono mt-0.5">
            Mat. {profile.matricula ?? "—"}
          </p>
          <div className="mt-2">{registrationBadge(profile.registration_status ?? "")}</div>
        </div>
      </div>

      {/* Biometria status */}
      <div
        className="rounded-2xl bg-card p-5"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              biometricComplete
                ? "bg-[#D1FAE5] text-[#065F46]"
                : "bg-[#FEF3C7] text-[#92400E]"
            }`}
          >
            {biometricComplete ? (
              <ShieldCheck className="size-5" />
            ) : (
              <ShieldAlert className="size-5" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Biometria</p>
            <p className="text-xs text-muted-foreground">
              {biometricComplete
                ? "Verificada — acesso liberado"
                : "Pendente — procure a Reserva de Armamento para cadastro"}
            </p>
          </div>
          <div className="ml-auto">
            {biometricComplete ? (
              <span className="badge-biometric-verified text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
                Verificada
              </span>
            ) : (
              <span className="badge-biometric-pending text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
                Pendente
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Info cards */}
      <div className="space-y-3">
        <InfoRow label="Cargo" value="Militar" />
        <InfoRow
          label="Data de cadastro"
          value={
            profile.created_at
              ? new Date(profile.created_at).toLocaleDateString("pt-BR")
              : "—"
          }
        />
        <InfoRow label="E-mail" value={user.email ?? "—"} />
      </div>

      {/* Sign out */}
      <SignOutButton />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl bg-card px-4 py-3 flex items-center justify-between"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
