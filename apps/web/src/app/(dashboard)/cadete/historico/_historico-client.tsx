"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Package, Tag, Hash, ArrowUpRight, ArrowDownLeft, Shield, Building2,
  CircleDot, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal,
  FileDown, X, Loader2, ChevronDown,
} from "lucide-react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Lending {
  id: string;
  status_legacy: string;
  issued_at: string | null;
  returned_at: string | null;
  quantidade: number | null;
  material_type: { id: string; nome: string; categoria: string } | null;
  master: { nome_completo: string; posto?: string | null } | null;
  reserve: { id: string; nome: string } | null;
}

interface FilterOptions {
  reservas:   { id: string; nome: string }[];
  categorias: string[];
  materiais:  { id: string; nome: string }[];
}

type SortField = "material" | "categoria" | "reserva" | "armeiro" | "issued_at" | "returned_at" | "status" | "quantidade";
type SortDir   = "asc" | "desc";

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  ativo:     { label: "Ativo",     className: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  devolvido: { label: "Devolvido", className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  perdido:   { label: "Perdido",   className: "bg-red-500/10 text-red-700 border-red-500/30" },
};

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString("pt-BR") : "—";
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
  return sortDir === "asc"
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
}

function ColumnHeader({
  field, label, icon, align = "left", sortField, sortDir, onSort,
}: {
  field: SortField; label: string; icon: React.ReactNode; align?: string;
  sortField: SortField; sortDir: SortDir; onSort: (f: SortField) => void;
}) {
  const active = field === sortField;
  return (
    <th className={`px-3 py-3 text-${align}`}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors
          ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
      >
        {icon}
        {label}
        <SortIcon field={field} sortField={sortField} sortDir={sortDir} />
      </button>
    </th>
  );
}

function extractStr(val: unknown): string {
  if (typeof val === "string") return val.toLowerCase();
  return "";
}

function sortLendings(lendings: Lending[], field: SortField, dir: SortDir): Lending[] {
  return [...lendings].sort((a, b) => {
    let av = "", bv = "";
    if (field === "material")   { av = extractStr(a.material_type?.nome);   bv = extractStr(b.material_type?.nome);   }
    if (field === "categoria")  { av = extractStr(a.material_type?.categoria); bv = extractStr(b.material_type?.categoria); }
    if (field === "reserva")    { av = extractStr(a.reserve?.nome);          bv = extractStr(b.reserve?.nome);          }
    if (field === "armeiro")    { av = extractStr(a.master?.nome_completo);  bv = extractStr(b.master?.nome_completo);  }
    if (field === "issued_at")  { av = a.issued_at ?? ""; bv = b.issued_at ?? ""; }
    if (field === "returned_at"){ av = a.returned_at ?? ""; bv = b.returned_at ?? ""; }
    if (field === "status")     { av = a.status_legacy; bv = b.status_legacy; }
    if (field === "quantidade") { return dir === "asc" ? (a.quantidade ?? 0) - (b.quantidade ?? 0) : (b.quantidade ?? 0) - (a.quantidade ?? 0); }
    const cmp = av.localeCompare(bv, "pt-BR");
    return dir === "asc" ? cmp : -cmp;
  });
}

export function HistoricoClient() {
  const [token, setToken]               = useState<string>();
  const [lendings, setLendings]         = useState<Lending[]>([]);
  const [options, setOptions]           = useState<FilterOptions>({ reservas: [], categorias: [], materiais: [] });
  const [loading, setLoading]           = useState(true);
  const [exporting, setExporting]       = useState(false);
  const [showFilters, setShowFilters]   = useState(false);

  // Filtros
  const [fReserva,   setFReserva]   = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fStatus,    setFStatus]    = useState("");
  const [fFrom,      setFFrom]      = useState("");
  const [fTo,        setFTo]        = useState("");

  // Ordenação
  const [sortField, setSortField] = useState<SortField>("issued_at");
  const [sortDir,   setSortDir]   = useState<SortDir>("desc");

  useEffect(() => {
    const sb = createClient();
    sb.auth.getSession().then(({ data }) => setToken(data.session?.access_token));
  }, []);

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (fReserva)   p.set("reserve_id", fReserva);
    if (fCategoria) p.set("categoria", fCategoria);
    if (fStatus)    p.set("status", fStatus);
    if (fFrom)      p.set("from", fFrom);
    if (fTo)        p.set("to", fTo);
    return p.toString();
  }, [fReserva, fCategoria, fStatus, fFrom, fTo]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = buildParams();
      const res = await fetch(`${BFF_URL}/api/usuario/historico${params ? "?" + params : ""}`, {
        headers: { ...csrfHeaders(), Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro ao carregar histórico");
      const json = await res.json() as { lendings: Lending[]; reservas: FilterOptions["reservas"]; categorias: string[]; materiais: FilterOptions["materiais"] };
      setLendings(json.lendings ?? []);
      setOptions({ reservas: json.reservas ?? [], categorias: json.categorias ?? [], materiais: json.materiais ?? [] });
    } catch {
      toast.error("Falha ao carregar histórico de saídas");
    } finally {
      setLoading(false);
    }
  }, [token, buildParams]);

  useEffect(() => {
    if (token) fetchData();
  }, [token, fetchData]);

  const sorted = useMemo(() => sortLendings(lendings, sortField, sortDir), [lendings, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (field === sortField) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  function clearFilters() {
    setFReserva(""); setFCategoria(""); setFStatus(""); setFFrom(""); setFTo("");
  }

  const hasFilters = !!(fReserva || fCategoria || fStatus || fFrom || fTo);

  async function exportPdf() {
    if (!token) return;
    setExporting(true);
    try {
      const params = buildParams();
      const res = await fetch(`${BFF_URL}/api/usuario/historico/pdf${params ? "?" + params : ""}`, {
        headers: { ...csrfHeaders(), Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro ao gerar PDF");
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `historico-saidas-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Falha ao exportar PDF");
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Carregando histórico...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="historico-ready">

      {/* ── Barra de ações ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Button
            variant={showFilters ? "default" : "outline"}
            size="sm"
            onClick={() => setShowFilters((v) => !v)}
            data-testid="btn-filtros"
          >
            <SlidersHorizontal className="h-4 w-4 mr-1.5" />
            Filtros
            {hasFilters && (
              <Badge className="ml-1.5 bg-primary/20 text-primary text-[10px] px-1.5 py-0">
                {[fReserva, fCategoria, fStatus, fFrom, fTo].filter(Boolean).length}
              </Badge>
            )}
            <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${showFilters ? "rotate-180" : ""}`} />
          </Button>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
              <X className="h-3.5 w-3.5 mr-1" />
              Limpar
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {sorted.length} registro{sorted.length !== 1 ? "s" : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={exportPdf}
            disabled={exporting || sorted.length === 0}
            data-testid="btn-exportar-pdf"
          >
            {exporting
              ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              : <FileDown className="h-4 w-4 mr-1.5" />}
            Exportar PDF
          </Button>
        </div>
      </div>

      {/* ── Painel de filtros (colapsável — Lei de Hick) ───────────────── */}
      {showFilters && (
        <div className="rounded-xl border bg-card p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" style={{ boxShadow: "var(--shadow-card)" }}>
          {/* Reserva */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Building2 className="h-3 w-3" /> Reserva
            </label>
            <div className="relative">
              <select
                className="w-full h-9 appearance-none rounded-lg border border-input bg-background px-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                value={fReserva}
                onChange={(e) => setFReserva(e.target.value)}
                data-testid="filter-reserva"
              >
                <option value="">Todas</option>
                {options.reservas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* Categoria */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Tag className="h-3 w-3" /> Categoria
            </label>
            <div className="relative">
              <select
                className="w-full h-9 appearance-none rounded-lg border border-input bg-background px-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                value={fCategoria}
                onChange={(e) => setFCategoria(e.target.value)}
                data-testid="filter-categoria"
              >
                <option value="">Todas</option>
                {options.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* Status */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <CircleDot className="h-3 w-3" /> Status
            </label>
            <div className="relative">
              <select
                className="w-full h-9 appearance-none rounded-lg border border-input bg-background px-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
                value={fStatus}
                onChange={(e) => setFStatus(e.target.value)}
                data-testid="filter-status"
              >
                <option value="">Todos</option>
                <option value="ativo">Ativo</option>
                <option value="devolvido">Devolvido</option>
                <option value="perdido">Perdido</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </div>

          {/* Data início */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3" /> De
            </label>
            <input
              type="date"
              className="w-full h-9 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
              value={fFrom}
              onChange={(e) => setFFrom(e.target.value)}
              data-testid="filter-from"
            />
          </div>

          {/* Data fim */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <ArrowDownLeft className="h-3 w-3" /> Até
            </label>
            <input
              type="date"
              className="w-full h-9 rounded-lg border border-input bg-background px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50"
              value={fTo}
              onChange={(e) => setFTo(e.target.value)}
              data-testid="filter-to"
            />
          </div>

          <div className="sm:col-span-2 lg:col-span-5 flex justify-end pt-1">
            <Button size="sm" onClick={fetchData}>Aplicar filtros</Button>
          </div>
        </div>
      )}

      {/* ── Tabela ──────────────────────────────────────────────────────── */}
      {sorted.length === 0 ? (
        <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">
            {hasFilters ? "Nenhum registro para os filtros aplicados" : "Nenhuma saída registrada"}
          </p>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="historico-table">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <ColumnHeader field="material"    label="Material"   icon={<Package   className="h-3.5 w-3.5" />} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <ColumnHeader field="categoria"   label="Categoria"  icon={<Tag       className="h-3.5 w-3.5" />} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <ColumnHeader field="reserva"     label="Reserva"    icon={<Building2 className="h-3.5 w-3.5" />} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <ColumnHeader field="armeiro"     label="Armeiro"    icon={<Shield    className="h-3.5 w-3.5" />} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <ColumnHeader field="issued_at"   label="Saída"      icon={<ArrowUpRight  className="h-3.5 w-3.5" />} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <ColumnHeader field="returned_at" label="Devolução"  icon={<ArrowDownLeft className="h-3.5 w-3.5" />} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <ColumnHeader field="status"      label="Status"     icon={<CircleDot className="h-3.5 w-3.5" />} sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  <ColumnHeader field="quantidade"  label="Qtd"        icon={<Hash      className="h-3.5 w-3.5" />} align="center" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, idx) => {
                  const statusConfig = STATUS_LABELS[row.status_legacy] ?? { label: row.status_legacy, className: "bg-gray-500/10 text-gray-700 border-gray-500/30" };
                  return (
                    <tr
                      key={row.id}
                      className={`transition-colors hover:bg-muted/30 ${idx < sorted.length - 1 ? "border-b border-border" : ""}`}
                    >
                      <td className="px-3 py-3 font-medium text-foreground">
                        {row.material_type?.nome ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-sm">
                        {row.material_type?.categoria ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-sm">
                        {row.reserve?.nome ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-sm">
                        {row.master
                          ? [row.master.posto, row.master.nome_completo.split(" ")[0]].filter(Boolean).join(" ")
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-sm tabular-nums">
                        {fmtDate(row.issued_at)}
                      </td>
                      <td className="px-3 py-3 text-muted-foreground text-sm tabular-nums">
                        {fmtDate(row.returned_at)}
                      </td>
                      <td className="px-3 py-3">
                        <Badge className={`text-[10px] font-semibold px-2 py-0.5 ${statusConfig.className}`}>
                          {statusConfig.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-center text-muted-foreground tabular-nums">
                        {row.quantidade ?? 1}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
