export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Users, Package, Activity, AlertTriangle } from "lucide-react";
import { LendingChart, type ChartDataPoint } from "@/components/dashboard/lending-chart";

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

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [
    { count: totalMilitares },
    { count: cadastrosPendentes },
    { count: materiaisEmUso },
    { data: lowStockData },
    { data: weeklyLendings },
  ] = await Promise.all([
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("role", "military"),
    supabase.from("profiles").select("*", { count: "exact", head: true }).eq("registration_status", "pending_biometric"),
    supabase.from("lendings").select("*", { count: "exact", head: true }).eq("status", "ativo"),
    supabase.from("material_availability").select("quantidade_disponivel").lte("quantidade_disponivel", 3),
    supabase.from("lendings").select("issued_at, returned_at, status").gte("issued_at", sevenDaysAgo),
  ]);

  const ptDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const chartData: ChartDataPoint[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
    const dayName = ptDays[d.getDay()];
    const dateStr = d.toISOString().split("T")[0];
    return {
      day: dayName,
      emprestimos: weeklyLendings?.filter((l) => l.issued_at.startsWith(dateStr)).length ?? 0,
      devolucoes: weeklyLendings?.filter((l) => l.returned_at?.startsWith(dateStr)).length ?? 0,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Visão geral do sistema — APMCB
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Users className="size-5" />}
          label="Total de Militares"
          value={String(totalMilitares ?? 0)}
          hint="cadastros ativos"
          color="blue"
        />
        <StatCard
          icon={<Package className="size-5" />}
          label="Materiais em Uso"
          value={String(materiaisEmUso ?? 0)}
          hint="empréstimos ativos"
          color="blue"
        />
        <StatCard
          icon={<Activity className="size-5" />}
          label="Cadastros Pendentes"
          value={String(cadastrosPendentes ?? 0)}
          hint="aguardando biometria"
          color="warning"
        />
        <StatCard
          icon={<AlertTriangle className="size-5" />}
          label="Estoque Baixo"
          value={String(lowStockData?.length ?? 0)}
          hint="materiais críticos"
          color="danger"
        />
      </div>

      <LendingChart data={chartData} />
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
