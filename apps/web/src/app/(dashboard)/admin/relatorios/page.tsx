export const runtime = "edge";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, RotateCcw, TrendingUp, AlertTriangle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default async function AdminRelatoriosPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [
    { count: totalSaidasMes },
    { count: totalDevolucoesMes },
    { count: saidasAtivas },
    { data: matStats },
  ] = await Promise.all([
    supabase.from("lendings").select("*", { count: "exact", head: true }).gte("issued_at", monthStart),
    supabase.from("lendings").select("*", { count: "exact", head: true }).gte("returned_at", monthStart).eq("status", "devolvido"),
    supabase.from("lendings").select("*", { count: "exact", head: true }).eq("status", "ativo"),
    supabase
      .from("material_availability")
      .select("id, nome, categoria, quantidade_total, quantidade_disponivel, quantidade_em_uso")
      .order("quantidade_em_uso", { ascending: false }),
  ]);

  const taxaDevolucao = totalSaidasMes
    ? Math.round(((totalDevolucoesMes ?? 0) / totalSaidasMes) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Relatórios</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Visão consolidada —{" "}
          {now.toLocaleString("pt-BR", { month: "long", year: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { icon: <Package className="size-5" />, label: "Saídas no mês", value: String(totalSaidasMes ?? 0), warning: false },
          { icon: <RotateCcw className="size-5" />, label: "Devoluções no mês", value: String(totalDevolucoesMes ?? 0), warning: false },
          { icon: <TrendingUp className="size-5" />, label: "Taxa de devolução", value: `${taxaDevolucao}%`, warning: false },
          { icon: <AlertTriangle className="size-5" />, label: "Saídas em aberto", value: String(saidasAtivas ?? 0), warning: true },
        ].map((kpi, i) => {
          const iconBg = kpi.warning
            ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400"
            : "bg-primary/10 text-primary";
          return (
            <div key={i} className="rounded-2xl bg-card p-5 space-y-3" style={{ boxShadow: "var(--shadow-card)" }}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${iconBg}`}>{kpi.icon}</div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
                <p className="text-2xl font-bold tracking-tight mt-0.5">{kpi.value}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="px-5 py-4 border-b">
          <h3 className="text-sm font-semibold">Materiais — Status do Arsenal</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead className="hidden sm:table-cell">Categoria</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Disponível</TableHead>
              <TableHead className="text-right">Em saída</TableHead>
              <TableHead className="hidden md:table-cell">Ocupação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(matStats ?? []).map((m: any) => {
              const pct = m.quantidade_total > 0
                ? Math.round((m.quantidade_em_uso / m.quantidade_total) * 100)
                : 0;
              const barColor =
                pct >= 100 ? "bg-destructive" : pct >= 75 ? "bg-yellow-500" : "bg-primary";
              return (
                <TableRow key={m.id}>
                  <TableCell className="font-medium text-sm">{m.nome}</TableCell>
                  <TableCell className="hidden sm:table-cell text-xs text-muted-foreground capitalize">
                    {m.categoria}
                  </TableCell>
                  <TableCell className="text-right text-sm">{m.quantidade_total}</TableCell>
                  <TableCell className="text-right text-sm text-emerald-600">{m.quantidade_disponivel}</TableCell>
                  <TableCell className="text-right text-sm text-orange-600">{m.quantidade_em_uso}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
