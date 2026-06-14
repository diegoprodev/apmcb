export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, RotateCcw, TrendingUp } from "lucide-react";

export default async function ArmeiroRelatoriosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, id")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "master" && profile?.role !== "admin") redirect("/");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    { count: totalSaidasMes },
    { count: totalDevolucoesMes },
    { count: saidasAtivas },
  ] = await Promise.all([
    supabase
      .from("lendings")
      .select("*", { count: "exact", head: true })
      .gte("issued_at", monthStart),
    supabase
      .from("lendings")
      .select("*", { count: "exact", head: true })
      .gte("returned_at", monthStart)
      .eq("status", "devolvido"),
    supabase
      .from("lendings")
      .select("*", { count: "exact", head: true })
      .eq("status", "ativo"),
  ]);

  // Top materials by lending count this month
  const { data: topMaterials } = await supabase
    .from("lendings")
    .select("material_type:material_types(nome, categoria), quantidade")
    .gte("issued_at", monthStart)
    .limit(50);

  // Aggregate top materials client-side (edge-compatible)
  const matMap: Record<string, { nome: string; categoria: string; total: number }> = {};
  topMaterials?.forEach((l: any) => {
    const key = l.material_type?.nome ?? "—";
    if (!matMap[key]) {
      matMap[key] = { nome: key, categoria: l.material_type?.categoria ?? "—", total: 0 };
    }
    matMap[key].total += l.quantidade ?? 1;
  });
  const top5 = Object.values(matMap).sort((a, b) => b.total - a.total).slice(0, 5);

  const taxaDevolucao = totalSaidasMes
    ? Math.round(((totalDevolucoesMes ?? 0) / totalSaidasMes) * 100)
    : 0;

  const kpis = [
    {
      icon: <Package className="size-5" />,
      label: "Saídas no mês",
      value: totalSaidasMes ?? 0,
    },
    {
      icon: <RotateCcw className="size-5" />,
      label: "Devoluções no mês",
      value: totalDevolucoesMes ?? 0,
    },
    {
      icon: <TrendingUp className="size-5" />,
      label: "Taxa de devolução",
      value: `${taxaDevolucao}%`,
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Relatório do Armeiro</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Resumo do mês de{" "}
          {now.toLocaleString("pt-BR", { month: "long", year: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {kpis.map((kpi, i) => (
          <div
            key={i}
            className="rounded-2xl bg-card p-5 space-y-3"
            style={{ boxShadow: "var(--shadow-card)" }}
          >
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              {kpi.icon}
            </div>
            <div>
              <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
              <p className="text-2xl font-bold tracking-tight mt-0.5">{kpi.value}</p>
            </div>
          </div>
        ))}
      </div>

      {top5.length > 0 && (
        <div
          className="rounded-2xl bg-card p-5 space-y-4"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <h3 className="text-sm font-semibold">
            Materiais mais solicitados — mês atual
          </h3>
          <ul className="space-y-3">
            {top5.map((m, i) => (
              <li key={m.nome} className="flex items-center gap-3">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.nome}</p>
                  <p className="text-xs text-muted-foreground capitalize">{m.categoria}</p>
                </div>
                <span className="text-sm font-semibold text-primary">{m.total}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
