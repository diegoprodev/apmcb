export const runtime = 'edge';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, CheckCircle, Clock } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AddMaterialButton, MaterialRowActions } from "./_arsenal-actions";

type MaterialAvailability = {
  id: string;
  nome: string;
  categoria: string;
  quantidade_total: number;
  quantidade_disponivel: number;
  quantidade_em_uso: number;
};

function StockStatusBadge({ disponivel }: { disponivel: number }) {
  if (disponivel === 0) {
    return (
      <span className="badge-danger text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
        Crítico
      </span>
    );
  }
  if (disponivel <= 3) {
    return (
      <span className="badge-warning text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
        Atenção
      </span>
    );
  }
  return (
    <span className="badge-success text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
      Disponível
    </span>
  );
}

function AvailabilityBar({
  total,
  emUso,
}: {
  total: number;
  emUso: number;
}) {
  const pct = total > 0 ? Math.round((emUso / total) * 100) : 0;
  const color =
    pct >= 100
      ? "#DC2626"
      : pct >= 75
      ? "#D97706"
      : "#1B3A8C";

  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-[11px] text-muted-foreground w-8 text-right tabular-nums">
        {pct}%
      </span>
    </div>
  );
}

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
    blue: { backgroundColor: "rgba(27,58,140,0.08)", color: "#1B3A8C" },
    success: { backgroundColor: "#DCFCE7", color: "#166534" },
    warning: { backgroundColor: "#FEF3C7", color: "#92400E" },
  };

  return (
    <div
      className="rounded-2xl bg-card p-5 space-y-3 transition-all hover:-translate-y-0.5"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div
        className="w-9 h-9 rounded-xl flex items-center justify-center"
        style={iconStyle[color]}
      >
        {icon}
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-bold tracking-tight mt-0.5">{value}</p>
      </div>
    </div>
  );
}

export default async function ArsenalPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") redirect("/");

  const [
    { data: materials },
    { count: totalTipos },
  ] = await Promise.all([
    supabase
      .from("material_availability")
      .select("*")
      .order("nome"),
    supabase
      .from("material_types")
      .select("*", { count: "exact", head: true }),
  ]);

  const rows = (materials ?? []) as MaterialAvailability[];

  const totalDisponivel = rows.reduce((sum, m) => sum + (m.quantidade_disponivel ?? 0), 0);
  const totalEmUso = rows.reduce((sum, m) => sum + (m.quantidade_em_uso ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Arsenal</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Controle de estoque e materiais
          </p>
        </div>
        <AddMaterialButton />
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard
          icon={<Package className="size-5" />}
          label="Total de materiais"
          value={totalTipos ?? 0}
          color="blue"
        />
        <KpiCard
          icon={<CheckCircle className="size-5" />}
          label="Unidades disponíveis"
          value={totalDisponivel}
          color="success"
        />
        <KpiCard
          icon={<Clock className="size-5" />}
          label="Unidades em uso"
          value={totalEmUso}
          color="warning"
        />
      </div>

      {/* Table */}
      <div
        className="rounded-2xl bg-card overflow-hidden"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {rows.length === 0 ? (
          <div className="p-12 text-center">
            <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              Nenhum material cadastrado
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="pl-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Material
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">
                  Categoria
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">
                  Total
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">
                  Disponível
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">
                  Em uso
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">
                  Ocupação
                </TableHead>
                <TableHead className="py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Status
                </TableHead>
                <TableHead className="pr-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide text-right">
                  Ações
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => (
                <TableRow
                  key={m.id}
                  className="border-b border-border/60 hover:bg-muted/40 transition-colors"
                >
                  {/* Material */}
                  <TableCell className="pl-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                        style={{
                          backgroundColor: "rgba(27,58,140,0.08)",
                          color: "#1B3A8C",
                        }}
                      >
                        <Package className="size-3.5" />
                      </div>
                      <span className="text-sm font-medium text-foreground">
                        {m.nome}
                      </span>
                    </div>
                  </TableCell>

                  {/* Categoria */}
                  <TableCell className="py-3 hidden sm:table-cell">
                    <span className="text-sm text-muted-foreground capitalize">
                      {m.categoria}
                    </span>
                  </TableCell>

                  {/* Total */}
                  <TableCell className="py-3 text-right">
                    <span className="text-sm font-medium tabular-nums">
                      {m.quantidade_total}
                    </span>
                  </TableCell>

                  {/* Disponível */}
                  <TableCell className="py-3 text-right">
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: "#166534" }}
                    >
                      {m.quantidade_disponivel}
                    </span>
                  </TableCell>

                  {/* Em uso */}
                  <TableCell className="py-3 text-right">
                    <span
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: "#92400E" }}
                    >
                      {m.quantidade_em_uso}
                    </span>
                  </TableCell>

                  {/* Availability bar */}
                  <TableCell className="py-3 hidden md:table-cell">
                    <AvailabilityBar
                      total={m.quantidade_total}
                      emUso={m.quantidade_em_uso}
                    />
                  </TableCell>

                  {/* Status */}
                  <TableCell className="py-3">
                    <StockStatusBadge disponivel={m.quantidade_disponivel} />
                  </TableCell>

                  {/* Actions */}
                  <TableCell className="pr-5 py-3">
                    <MaterialRowActions material={{
                      id: m.id,
                      nome: m.nome,
                      categoria: m.categoria,
                      quantidade_total: m.quantidade_total,
                      quantidade_em_uso: m.quantidade_em_uso,
                    }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
