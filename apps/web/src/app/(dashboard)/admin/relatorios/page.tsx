export const runtime = "edge";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { FileText, Package, RotateCcw, TrendingUp, AlertTriangle, Users } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPanel } from "./_filter-panel";
import { ExportButtons } from "./_export-buttons";

type SearchParams = Promise<{
  from?: string;
  to?: string;
  status?: string;
  material_id?: string;
  military_id?: string;
  posto?: string;
}>;

function getDefaults() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const to = now.toISOString().split("T")[0];
  return { from, to };
}

export default async function AdminRelatoriosPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { from: defaultFrom, to: defaultTo } = getDefaults();

  const from = params.from || defaultFrom;
  const to = params.to || defaultTo;
  const statusFilter = params.status || "";
  const materialId = params.material_id || "";
  const militaryId = params.military_id || "";
  const postoFilter = params.posto || "";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, nome_completo").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/");
  const userName = (profile as any)?.nome_completo ?? user.email ?? "Usuário";

  // Fetch filter options
  const [{ data: materiais }, { data: militaresAll }] = await Promise.all([
    supabase.from("material_types").select("id, nome, categoria").order("nome"),
    supabase.from("profiles").select("id, nome_completo, matricula, posto").eq("role", "usuario").order("nome_completo"),
  ]);

  const postos = [...new Set((militaresAll ?? []).map(m => m.posto).filter(Boolean))].sort() as string[];

  // Build filtered lendings query
  let query = supabase
    .from("lendings")
    .select(`
      id, issued_at, returned_at, status, quantidade, notes,
      military:profiles!lendings_military_id_fkey(nome_completo, matricula, posto),
      material_type:material_types!lendings_material_type_id_fkey(nome, categoria)
    `)
    .gte("issued_at", `${from}T00:00:00.000Z`)
    .lte("issued_at", `${to}T23:59:59.999Z`)
    .order("issued_at", { ascending: false })
    .limit(500);

  if (statusFilter) query = query.eq("status", statusFilter);
  if (materialId) query = query.eq("material_type_id", materialId);
  if (militaryId) query = query.eq("military_id", militaryId);

  const { data: lendings } = await query;

  // Post-filter by posto (can't filter on joined table columns in Supabase directly)
  const rows = (lendings ?? []).filter((l: any) =>
    !postoFilter || l.military?.posto === postoFilter
  );

  // Compute KPIs from filtered data
  const totalSaidas = rows.length;
  const totalDevolvidas = rows.filter((l: any) => l.status === "devolvido").length;
  const totalAtivas = rows.filter((l: any) => l.status === "ativo").length;
  const militaresUnicos = new Set(rows.map((l: any) => l.military?.matricula)).size;
  const taxaDevolucao = totalSaidas > 0 ? Math.round((totalDevolvidas / totalSaidas) * 100) : 0;

  // Material aggregation
  const matMap: Record<string, { nome: string; categoria: string; total: number; devolvidas: number; ativas: number }> = {};
  rows.forEach((l: any) => {
    const key = l.material_type?.nome ?? "—";
    if (!matMap[key]) matMap[key] = { nome: key, categoria: l.material_type?.categoria ?? "—", total: 0, devolvidas: 0, ativas: 0 };
    matMap[key].total++;
    if (l.status === "devolvido") matMap[key].devolvidas++;
    if (l.status === "ativo") matMap[key].ativas++;
  });
  const matSummary = Object.values(matMap).sort((a, b) => b.total - a.total);

  const fromLabel = new Date(`${from}T12:00:00`).toLocaleDateString("pt-BR");
  const toLabel = new Date(`${to}T12:00:00`).toLocaleDateString("pt-BR");

  const printDate = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <>
      {/* Print styles — injected inline so they work with edge runtime */}
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          nav, aside, header, [data-sidebar], [data-bottom-nav] { display: none !important; }
          body { background: white !important; }
          .rounded-2xl { border-radius: 0 !important; box-shadow: none !important; border: 1px solid #e5e7eb !important; }
          * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      {/* ── Print-only letterhead ─────────────────────────────────────────── */}
      <div className="hidden print:flex items-center justify-between border-b border-gray-300 pb-4 mb-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="APMCB" width={56} height={56} />
          <div>
            <p className="text-base font-bold text-gray-900">Academia de Polícia Militar do Cabo Branco</p>
            <p className="text-xs text-gray-500">APMCB — Sistema de Controle de Materiais</p>
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          <p className="font-medium text-gray-700">Gerado por: {userName}</p>
          <p>{printDate}</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Relatórios</h2>
            <p className="text-muted-foreground text-sm mt-1">
              {fromLabel} → {toLabel}
              {statusFilter && ` · ${statusFilter}`}
            </p>
          </div>
          <ExportButtons data={rows as any} title="Relatorio_APMCB" />
        </div>

        {/* Filter Panel */}
        <div className="print:hidden">
          <FilterPanel
            materiais={materiais ?? []}
            militares={militaresAll ?? []}
            postos={postos}
          />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { icon: <Package className="size-5" />, label: "Total saídas", value: String(totalSaidas), warning: false },
            { icon: <RotateCcw className="size-5" />, label: "Devolvidas", value: String(totalDevolvidas), warning: false },
            { icon: <AlertTriangle className="size-5" />, label: "Em aberto", value: String(totalAtivas), warning: totalAtivas > 0 },
            { icon: <TrendingUp className="size-5" />, label: "Taxa devolução", value: `${taxaDevolucao}%`, warning: false },
            { icon: <Users className="size-5" />, label: "Militares distintos", value: String(militaresUnicos), warning: false },
          ].map((kpi, i) => {
            const iconBg = kpi.warning
              ? "bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400"
              : "bg-primary/10 text-primary";
            return (
              <div key={i} className="rounded-2xl bg-card p-4 space-y-2" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${iconBg}`}>{kpi.icon}</div>
                <div>
                  <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">{kpi.label}</p>
                  <p className="text-xl font-bold tracking-tight mt-0.5">{kpi.value}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detailed lendings table */}
        <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold">Saídas de Material — Detalhado</h3>
            <span className="text-xs text-muted-foreground">{rows.length} registros</span>
          </div>
          {rows.length === 0 ? (
            <div className="p-10 text-center">
              <FileText className="size-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium">Nenhum registro encontrado</p>
              <p className="text-xs text-muted-foreground mt-1">Ajuste os filtros para ver resultados</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data Saída</TableHead>
                    <TableHead>Militar</TableHead>
                    <TableHead className="hidden sm:table-cell">Posto</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead className="hidden md:table-cell">Categoria</TableHead>
                    <TableHead className="text-center">Qtd</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Devolução</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {l.issued_at ? new Date(l.issued_at).toLocaleDateString("pt-BR") : "—"}
                      </TableCell>
                      <TableCell>
                        <p className="text-sm font-medium">{l.military?.nome_completo ?? "—"}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{l.military?.matricula ?? ""}</p>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">{l.military?.posto ?? "—"}</TableCell>
                      <TableCell className="text-sm font-medium">{l.material_type?.nome ?? "—"}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs text-muted-foreground capitalize">{l.material_type?.categoria ?? "—"}</TableCell>
                      <TableCell className="text-center text-sm">{l.quantidade ?? 1}</TableCell>
                      <TableCell>
                        <span className={
                          l.status === "devolvido"
                            ? "badge-success text-[10px] font-semibold rounded-full px-2 py-0.5"
                            : l.status === "ativo"
                            ? "badge-in-use text-[10px] font-semibold rounded-full px-2 py-0.5"
                            : "badge-danger text-[10px] font-semibold rounded-full px-2 py-0.5"
                        }>
                          {l.status === "devolvido" ? "Devolvido" : l.status === "ativo" ? "Ativo" : l.status}
                        </span>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                        {l.returned_at ? new Date(l.returned_at).toLocaleDateString("pt-BR") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Material summary */}
        {matSummary.length > 0 && (
          <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="px-5 py-4 border-b">
              <h3 className="text-sm font-semibold">Resumo por Material</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead className="hidden sm:table-cell">Categoria</TableHead>
                  <TableHead className="text-right">Total saídas</TableHead>
                  <TableHead className="text-right">Devolvidas</TableHead>
                  <TableHead className="text-right">Em aberto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matSummary.map(m => (
                  <TableRow key={m.nome}>
                    <TableCell className="font-medium text-sm">{m.nome}</TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground capitalize">{m.categoria}</TableCell>
                    <TableCell className="text-right text-sm">{m.total}</TableCell>
                    <TableCell className="text-right text-sm text-emerald-600">{m.devolvidas}</TableCell>
                    <TableCell className="text-right text-sm text-orange-600">{m.ativas}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </>
  );
}
