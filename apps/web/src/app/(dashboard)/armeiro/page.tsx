import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Fingerprint, Package, UserCheck, Clock } from "lucide-react";

export default async function ArmeiroPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "master" && profile?.role !== "admin") redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Armeiro</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Gestão de empréstimos e biometria
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ActionCard
          icon={<Fingerprint className="size-6" />}
          title="Identificar Militar"
          description="Identificação biométrica 1:N via leitor ZKTeco"
          badge="Biometria"
        />
        <ActionCard
          icon={<Package className="size-6" />}
          title="Novo Empréstimo"
          description="Registrar saída de material do armário"
          badge="Empréstimo"
        />
        <ActionCard
          icon={<UserCheck className="size-6" />}
          title="Cadastrar Militar"
          description="Captura biométrica e conclusão de cadastro"
          badge="Cadastro"
        />
        <ActionCard
          icon={<Clock className="size-6" />}
          title="Devoluções Pendentes"
          description="Materiais ainda com militares"
          badge="Pendente"
        />
      </div>

      {/* Placeholder for real-time feed */}
      <div
        className="rounded-2xl bg-card p-8 text-center"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <p className="text-muted-foreground text-sm">
          Feed de atividades em tempo real — Sprint 2
        </p>
      </div>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  description,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  badge: string;
}) {
  return (
    <button
      type="button"
      className="rounded-2xl bg-card p-5 text-left space-y-3 transition-all hover:-translate-y-0.5 active:scale-[0.97] w-full"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-start justify-between">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          {icon}
        </div>
        <span className="badge-neutral text-[10px] font-semibold tracking-wide rounded-full px-2.5 py-0.5">
          {badge}
        </span>
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </button>
  );
}
