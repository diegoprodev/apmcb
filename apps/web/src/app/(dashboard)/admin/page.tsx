import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Users, Package, Activity, AlertTriangle } from "lucide-react";

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Visão geral do sistema — APMCB
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users className="size-5" />}
          label="Total de Militares"
          value="—"
          hint="cadastros ativos"
          color="blue"
        />
        <StatCard
          icon={<Package className="size-5" />}
          label="Materiais em Uso"
          value="—"
          hint="empréstimos ativos"
          color="blue"
        />
        <StatCard
          icon={<Activity className="size-5" />}
          label="Cadastros Pendentes"
          value="—"
          hint="aguardando biometria"
          color="warning"
        />
        <StatCard
          icon={<AlertTriangle className="size-5" />}
          label="Estoque Baixo"
          value="—"
          hint="materiais críticos"
          color="danger"
        />
      </div>

      {/* Coming soon placeholder */}
      <div
        className="rounded-2xl bg-card p-8 text-center"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <p className="text-muted-foreground text-sm">
          Gráficos e tabelas chegam no Sprint 2
        </p>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  color: "blue" | "warning" | "danger";
}) {
  const iconBg = {
    blue: "bg-primary/10 text-primary",
    warning: "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400",
    danger: "bg-destructive/10 text-destructive",
  }[color];

  return (
    <div
      className="rounded-2xl bg-card p-5 space-y-3 transition-shadow hover:card-shadow-hover"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-bold tracking-tight mt-0.5">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>
      </div>
    </div>
  );
}
