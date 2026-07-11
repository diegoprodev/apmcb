export const runtime = "edge";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Package, RotateCcw, TrendingUp, AlertTriangle, Users, ClipboardList, Clock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RelatorioFilterPanel } from "@/components/reports/relatorio-filter-panel";
import { RelatorioDetailTable } from "@/components/reports/relatorio-detail-table";
import { RelatorioExportButtons } from "@/components/reports/relatorio-export-buttons";
import type { CautelaRow, LivroRow, RecordType, SaidaRow } from "@/components/reports/types";
import { resolveLivroMaterialNomes } from "@/components/reports/resolve-livro-material";

const PRINT_TARGET_ID = "relatorio-detail-table";

type SearchParams = Promise<{
  from?: string;
  to?: string;
  tipo?: string;
  status?: string;
  material_id?: string;
  categoria?: string;
  calibre?: string;
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
  const recordType: RecordType = params.tipo === "cautelas" || params.tipo === "livro" ? params.tipo : "saidas";
  const statusFilter = params.status || "";
  const materialId = params.material_id || "";
  const categoriaFilter = params.categoria || "";
  const calibreFilter = params.calibre || "";
  const militaryId = params.military_id || "";
  const postoFilter = params.posto || "";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, nome_completo").eq("id", user.id).single();
  if (profile?.role !== "admin_global") redirect("/");
  const userName = (profile as any)?.nome_completo ?? user.email ?? "Usuário";

  const [{ data: materiais }, { data: postoRows }] = await Promise.all([
    supabase.from("material_types").select("id, nome, categoria, categoria_slug, calibre").order("nome"),
    // Só a coluna posto — evita carregar nome/matrícula de toda a base (10k+) só para montar
    // a lista de postos do filtro. O filtro de Usuário usa /api/admin/search-profiles (busca assíncrona).
    supabase.from("profiles").select("posto").eq("role", "usuario"),
  ]);

  const postos = [...new Set((postoRows ?? []).map((p) => p.posto).filter(Boolean))].sort() as string[];

  const fromISO = `${from}T00:00:00.000Z`;
  const toISO = `${to}T23:59:59.999Z`;

  let saidaRows: SaidaRow[] = [];
  let cautelaRows: CautelaRow[] = [];
  let livroRows: LivroRow[] = [];

  if (recordType === "saidas") {
    let query = supabase
      .from("lendings")
      .select(`
        id, issued_at, returned_at, status, quantidade, notes, local,
        military:profiles!lendings_military_id_fkey(nome_completo, matricula, posto),
        material_type:material_types!lendings_material_type_id_fkey(id, nome, categoria, categoria_slug, calibre)
      `)
      .gte("issued_at", fromISO)
      .lte("issued_at", toISO)
      .order("issued_at", { ascending: false })
      .limit(500);

    if (statusFilter) query = query.eq("status", statusFilter);
    if (materialId) query = query.eq("material_type_id", materialId);
    if (militaryId) query = query.eq("military_id", militaryId);

    const { data } = await query;
    saidaRows = ((data ?? []) as unknown as SaidaRow[]).filter((l) =>
      (!postoFilter || l.military?.posto === postoFilter)
      && (!categoriaFilter || l.material_type?.categoria_slug === categoriaFilter || l.material_type?.categoria === categoriaFilter)
      && (!calibreFilter || l.material_type?.calibre === calibreFilter)
    );
  } else if (recordType === "cautelas") {
    let query = supabase
      .from("cautelamentos")
      .select(`
        id, status, motivo_emissao, motivo_devolucao, condicao_emissao, condicao_devolucao, data_emissao, data_devolucao,
        militar:profiles!cautelamentos_militar_id_fkey(nome_completo, matricula, posto),
        item:material_items!cautelamentos_item_id_fkey(identificador_principal, material_type:material_types(id, nome, categoria, categoria_slug, calibre))
      `)
      .gte("data_emissao", fromISO)
      .lte("data_emissao", toISO)
      .order("data_emissao", { ascending: false })
      .limit(500);

    if (statusFilter) query = query.eq("status", statusFilter);
    if (militaryId) query = query.eq("militar_id", militaryId);

    const { data } = await query;
    cautelaRows = ((data ?? []) as unknown as CautelaRow[]).filter((c) => {
      const mt = c.item?.material_type;
      return (!postoFilter || c.militar?.posto === postoFilter)
        && (!materialId || mt?.id === materialId)
        && (!categoriaFilter || mt?.categoria_slug === categoriaFilter || mt?.categoria === categoriaFilter)
        && (!calibreFilter || mt?.calibre === calibreFilter);
    });
  } else {
    let query = supabase
      .from("service_log_events")
      .select(`
        id, happened_at, event_type, description, is_pending, resolved_at, subject_id, subject_type,
        actor:profiles!service_log_events_actor_id_fkey(nome_completo, matricula, posto, foto_url)
      `)
      .gte("happened_at", fromISO)
      .lte("happened_at", toISO)
      .order("happened_at", { ascending: false })
      .limit(500);

    if (statusFilter === "pendente") query = query.eq("is_pending", true).is("resolved_at", null);
    else if (statusFilter === "resolvido") query = query.eq("is_pending", true).not("resolved_at", "is", null);

    const { data } = await query;
    livroRows = await resolveLivroMaterialNomes(
      supabase,
      ((data ?? []) as unknown as LivroRow[]).filter((e) => !postoFilter || e.actor?.posto === postoFilter)
    );
  }

  // Arsenal approval requests in the same date range — escopo cross-reserva (admin_global), só se aplica ao tipo Saídas
  let arsenalRequests: any[] = [];
  if (recordType === "saidas") {
    const { data } = await supabase
      .from("admin_approval_requests")
      .select(`
        id, type, status, payload, admin_note, created_at, reviewed_at,
        requestor:requestor_id(nome_completo, posto, matricula),
        reviewer:reviewed_by(nome_completo)
      `)
      .gte("created_at", fromISO)
      .lte("created_at", toISO)
      .order("created_at", { ascending: false })
      .limit(200);
    arsenalRequests = data ?? [];
  }

  // ── KPIs por tipo ───────────────────────────────────────────────────────
  let kpis: { icon: React.ReactNode; label: string; value: string; warning: boolean }[] = [];
  let matSummary: { nome: string; categoria: string; total: number; devolvidas: number; ativas: number }[] = [];

  if (recordType === "saidas") {
    const totalSaidas = saidaRows.length;
    const totalDevolvidas = saidaRows.filter((l) => l.status === "devolvido").length;
    const totalAtivas = saidaRows.filter((l) => l.status === "ativo").length;
    const militaresUnicos = new Set(saidaRows.map((l) => l.military?.matricula).filter(Boolean)).size;
    const taxaDevolucao = totalSaidas > 0 ? Math.round((totalDevolvidas / totalSaidas) * 100) : 0;
    kpis = [
      { icon: <Package className="size-5" />, label: "Total saídas", value: String(totalSaidas), warning: false },
      { icon: <RotateCcw className="size-5" />, label: "Devolvidas", value: String(totalDevolvidas), warning: false },
      { icon: <AlertTriangle className="size-5" />, label: "Em aberto", value: String(totalAtivas), warning: totalAtivas > 0 },
      { icon: <TrendingUp className="size-5" />, label: "Taxa devolução", value: `${taxaDevolucao}%`, warning: false },
      { icon: <Users className="size-5" />, label: "Usuários distintos", value: String(militaresUnicos), warning: false },
    ];

    const matMap: Record<string, { nome: string; categoria: string; total: number; devolvidas: number; ativas: number }> = {};
    saidaRows.forEach((l) => {
      const key = l.material_type?.nome ?? "—";
      if (!matMap[key]) matMap[key] = { nome: key, categoria: l.material_type?.categoria ?? "—", total: 0, devolvidas: 0, ativas: 0 };
      matMap[key].total++;
      if (l.status === "devolvido") matMap[key].devolvidas++;
      if (l.status === "ativo") matMap[key].ativas++;
    });
    matSummary = Object.values(matMap).sort((a, b) => b.total - a.total);
  } else if (recordType === "cautelas") {
    const total = cautelaRows.length;
    const devolvidas = cautelaRows.filter((c) => c.status === "devolvida" || c.status === "substituida").length;
    const ativas = cautelaRows.filter((c) => c.status === "ativa").length;
    const militaresUnicos = new Set(cautelaRows.map((c) => c.militar?.matricula).filter(Boolean)).size;
    const taxa = total > 0 ? Math.round((devolvidas / total) * 100) : 0;
    kpis = [
      { icon: <Package className="size-5" />, label: "Total cautelas", value: String(total), warning: false },
      { icon: <RotateCcw className="size-5" />, label: "Devolvidas", value: String(devolvidas), warning: false },
      { icon: <AlertTriangle className="size-5" />, label: "Ativas", value: String(ativas), warning: ativas > 0 },
      { icon: <TrendingUp className="size-5" />, label: "Taxa devolução", value: `${taxa}%`, warning: false },
      { icon: <Users className="size-5" />, label: "Usuários distintos", value: String(militaresUnicos), warning: false },
    ];
  } else {
    const total = livroRows.length;
    const pendentes = livroRows.filter((e) => e.is_pending && !e.resolved_at).length;
    const manuais = livroRows.filter((e) => e.event_type === "evento_manual").length;
    const autoresUnicos = new Set(livroRows.map((e) => e.actor?.matricula).filter(Boolean)).size;
    kpis = [
      { icon: <ClipboardList className="size-5" />, label: "Total eventos", value: String(total), warning: false },
      { icon: <AlertTriangle className="size-5" />, label: "Pendências abertas", value: String(pendentes), warning: pendentes > 0 },
      { icon: <Clock className="size-5" />, label: "Eventos manuais", value: String(manuais), warning: false },
      { icon: <Users className="size-5" />, label: "Autores distintos", value: String(autoresUnicos), warning: false },
    ];
  }

  const fromLabel = new Date(`${from}T12:00:00`).toLocaleDateString("pt-BR");
  const toLabel = new Date(`${to}T12:00:00`).toLocaleDateString("pt-BR");

  return (
    <div className="space-y-6">
      {/* Preserva impressão nativa (Ctrl+P) sem sidebar/nav — o export em PDF
          selecionável agora é feito via GridPdfButton dentro da tabela detalhada. */}
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          nav, aside, header, [data-sidebar], [data-bottom-nav] { display: none !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Relatórios</h2>
          <p className="text-muted-foreground text-sm mt-1">
            {fromLabel} → {toLabel}
            {statusFilter && ` · ${statusFilter}`}
          </p>
        </div>
        {recordType === "saidas" && <RelatorioExportButtons tipo="saidas" rows={saidaRows} title="Relatorio_APMCB_Saidas" />}
        {recordType === "cautelas" && <RelatorioExportButtons tipo="cautelas" rows={cautelaRows} title="Relatorio_APMCB_Cautelas" />}
        {recordType === "livro" && <RelatorioExportButtons tipo="livro" rows={livroRows} title="Relatorio_APMCB_Livro" />}
      </div>

      <RelatorioFilterPanel basePath="/admin/relatorios" materiais={materiais ?? []} postos={postos} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((kpi, i) => {
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

      {recordType === "saidas" && (
        <RelatorioDetailTable
          tipo="saidas"
          rows={saidaRows}
          printTargetId={PRINT_TARGET_ID}
          reportTitle="RELATÓRIO DE SAÍDAS"
          armeiroName={userName}
        />
      )}
      {recordType === "cautelas" && (
        <RelatorioDetailTable
          tipo="cautelas"
          rows={cautelaRows}
          printTargetId={PRINT_TARGET_ID}
          reportTitle="RELATÓRIO DE CAUTELAS"
          armeiroName={userName}
        />
      )}
      {recordType === "livro" && (
        <RelatorioDetailTable
          tipo="livro"
          rows={livroRows}
          printTargetId={PRINT_TARGET_ID}
          reportTitle="RELATÓRIO — LIVRO DE SERVIÇO"
          armeiroName={userName}
        />
      )}

      {recordType === "saidas" && matSummary.length > 0 && (
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

      {recordType === "saidas" && arsenalRequests.length > 0 && (
        <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold">Solicitações de Almoxarifado — Armeiros</h3>
            <span className="text-xs text-muted-foreground">{arsenalRequests.length} registros</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Armeiro</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Detalhes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Aprovado por</TableHead>
                <TableHead className="hidden md:table-cell">Nota</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {arsenalRequests.map((r: any) => {
                const requestor = Array.isArray(r.requestor) ? r.requestor[0] : r.requestor;
                const reviewer = Array.isArray(r.reviewer) ? r.reviewer[0] : r.reviewer;
                const isAdjust = r.type === "stock_adjustment";
                const items = isAdjust ? null : (r.payload?.items as { nome: string; quantidade_total: number }[] | undefined);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleDateString("pt-BR")}
                    </TableCell>
                    <TableCell>
                      <p className="text-sm font-medium">{requestor?.nome_completo ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground font-mono">{requestor?.matricula ?? ""}</p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {isAdjust ? "Ajuste" : "Adição"}
                    </TableCell>
                    <TableCell className="text-xs max-w-45 truncate">
                      {isAdjust
                        ? `${r.payload?.material_nome ?? "—"}: ${r.payload?.quantidade_atual ?? "—"} → ${r.payload?.new_quantity ?? "—"}`
                        : items?.map((i: any) => `${i.nome} (${i.quantidade_total})`).join(", ") ?? "—"
                      }
                    </TableCell>
                    <TableCell>
                      <span className={
                        r.status === "aprovado"
                          ? "badge-success text-[10px] font-semibold rounded-full px-2 py-0.5"
                          : r.status === "pendente"
                          ? "badge-warning text-[10px] font-semibold rounded-full px-2 py-0.5"
                          : "badge-danger text-[10px] font-semibold rounded-full px-2 py-0.5"
                      }>
                        {r.status === "aprovado" ? "Aprovado" : r.status === "pendente" ? "Pendente" : "Rejeitado"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {reviewer?.nome_completo ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-37.5 truncate">
                      {r.admin_note ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
