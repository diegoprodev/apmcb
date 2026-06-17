export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, CheckCircle, Clock } from "lucide-react";
import { AddMaterialButton } from "./_arsenal-actions";
import { ArsenalTable as AlmoxarifadoTable } from "./_arsenal-filters";

type MaterialAvailability = {
  id: string;
  nome: string;
  categoria: string;
  quantidade_total: number;
  quantidade_disponivel: number;
  quantidade_em_uso: number;
};

function KpiCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: "blue" | "success" | "warning";
}) {
  const iconStyle: Record<string, React.CSSProperties> = {
    blue:    { backgroundColor: "rgba(27,58,140,0.08)", color: "#1B3A8C" },
    success: { backgroundColor: "#DCFCE7", color: "#166534" },
    warning: { backgroundColor: "#FEF3C7", color: "#92400E" },
  };

  return (
    <div
      className="rounded-2xl bg-card p-5 space-y-3 transition-all hover:-translate-y-0.5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={iconStyle[color]}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-bold tracking-tight mt-0.5">{value}</p>
      </div>
    </div>
  );
}

export default async function AlmoxarifadoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/");

  const [{ data: materials }, { count: totalTipos }] = await Promise.all([
    supabase.from("material_availability").select("*").order("nome"),
    supabase.from("material_types").select("*", { count: "exact", head: true }),
  ]);

  const rows = (materials ?? []) as MaterialAvailability[];
  const totalDisponivel = rows.reduce((sum, m) => sum + (m.quantidade_disponivel ?? 0), 0);
  const totalEmUso = rows.reduce((sum, m) => sum + (m.quantidade_em_uso ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Almoxarifado</h2>
          <p className="text-muted-foreground text-sm mt-1">Controle de estoque e materiais</p>
        </div>
        <AddMaterialButton />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard icon={<Package className="size-5" />}      label="Total de materiais"   value={totalTipos ?? 0}  color="blue" />
        <KpiCard icon={<CheckCircle className="size-5" />}  label="Unidades disponíveis" value={totalDisponivel}  color="success" />
        <KpiCard icon={<Clock className="size-5" />}        label="Unidades em uso"       value={totalEmUso}       color="warning" />
      </div>

      <AlmoxarifadoTable rows={rows} />
    </div>
  );
}
