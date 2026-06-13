import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, Clock, CheckCircle2 } from "lucide-react";

export default async function CadetePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, registration_status")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "military") redirect("/");
  if (profile.registration_status !== "complete") redirect("/registro-pendente");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Olá, {profile.full_name?.split(" ")[0] ?? "Cadete"}
        </h2>
        <p className="text-muted-foreground text-sm mt-1">
          Acompanhe seus materiais emprestados
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <MiniStat icon={<Package className="size-4" />} label="Em uso" value="0" />
        <MiniStat icon={<Clock className="size-4" />} label="Histórico" value="0" />
        <MiniStat icon={<CheckCircle2 className="size-4" />} label="Devolvidos" value="0" />
      </div>

      {/* Empty state */}
      <div
        className="rounded-2xl bg-card p-10 text-center"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">Nenhum material em uso</p>
        <p className="text-xs text-muted-foreground mt-1">
          Procure o armeiro para retirar materiais
        </p>
      </div>
    </div>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div
      className="rounded-xl bg-card p-3 text-center"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="text-primary flex justify-center mb-1">{icon}</div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
