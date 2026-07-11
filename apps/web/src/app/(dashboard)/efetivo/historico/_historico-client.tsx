"use client";

import { useState, useEffect, useMemo, useCallback, Fragment } from "react";
import { bffFetch } from "@/lib/bff-client";
import { csrfHeaders } from "@/lib/csrf";
import { APP_TIMEZONE } from "@/lib/format-date";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterField } from "@/components/shared/filter-field";
import { cn } from "@/lib/utils";
import {
  Package, Tag, Hash, ArrowUpRight, ArrowDownLeft, Shield, Building2,
  CircleDot, ArrowUpDown, ArrowUp, ArrowDown, SlidersHorizontal,
  FileDown, X, Loader2, ChevronDown, Search, LayoutGrid, Table2,
  CheckCircle2, Clock,
} from "lucide-react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Lending {
  id: string;
  status_legacy: string;
  issued_at: string | null;
  returned_at: string | null;
  quantidade: number | null;
  movement_id: string | null;
  material_type: { id: string; nome: string; categoria: string } | null;
  master: { nome_completo: string; posto?: string | null } | null;
  reserve: { id: string; nome: string } | null;
}

interface HistoricoGroup {
  key: string;
  movement_id: string | null;
  issued_at: string | null;
  reserve: { id: string; nome: string } | null;
  master: { nome_completo: string; posto?: string | null } | null;
  items: Lending[];
  hasActive: boolean;
  activeCount: number;
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

// timeZone explícito em todas as formatações desta função: sem isso, SSR
// (edge runtime, UTC) e o browser do usuário (America/Recife) produzem
// strings diferentes → hydration mismatch (React error #418).
function fmtDate(d: string | null) {
  if (!d) return <span>—</span>;
  const dt = new Date(d);
  return (
    <span>
      {dt.toLocaleDateString("pt-BR", { timeZone: APP_TIMEZONE })}
      <span className="block text-xs text-muted-foreground/70">
        {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: APP_TIMEZONE })}
      </span>
    </span>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  return (
    dt.toLocaleDateString("pt-BR", { timeZone: APP_TIMEZONE }) +
    " · " +
    dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: APP_TIMEZONE })
  );
}

function groupByMovement(lendings: Lending[]): HistoricoGroup[] {
  const map = new Map<string, HistoricoGroup>();
  for (const l of lendings) {
    const key = l.movement_id ?? l.issued_at ?? l.id;
    if (!map.has(key)) {
      map.set(key, {
        key,
        movement_id: l.movement_id,
        issued_at: l.issued_at,
        reserve: l.reserve,
        master: l.master,
        items: [],
        hasActive: false,
        activeCount: 0,
      });
    }
    map.get(key)!.items.push(l);
  }
  return Array.from(map.values()).map((g) => ({
    ...g,
    activeCount: g.items.filter((i) => i.status_legacy === "ativo").length,
    hasActive:   g.items.some((i) => i.status_legacy === "ativo"),
  }));
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

function matchesSearch(row: Lending, term: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  return (
    (row.material_type?.nome?.toLowerCase().includes(t) ?? false) ||
    (row.material_type?.categoria?.toLowerCase().includes(t) ?? false) ||
    (row.reserve?.nome?.toLowerCase().includes(t) ?? false) ||
    (row.master?.nome_completo?.toLowerCase().includes(t) ?? false)
  );
}

// ── HistoricoCardView ────────────────────────────────────────────────────────

function HistoricoCardView({
  groups,
  hasMore,
  showLimitMenu,
  setShowLimitMenu,
  onLoadMore,
  selectedIds,
  onToggleItem,
  onToggleGroup,
}: {
  groups: HistoricoGroup[];
  hasMore: boolean;
  showLimitMenu: boolean;
  setShowLimitMenu: (v: boolean) => void;
  onLoadMore: (n: number) => void;
  selectedIds: Set<string>;
  onToggleItem: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const allGroupSelected = group.items.every((i) => selectedIds.has(i.id));
        const groupIds = group.items.map((i) => i.id);
        return (
          <div
            key={group.key}
            className="rounded-2xl bg-card overflow-hidden"
            style={{ boxShadow: "var(--shadow-card)" }}
            data-testid="historico-group"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <input
                type="checkbox"
                checked={allGroupSelected}
                onChange={() => onToggleGroup(groupIds)}
                className="h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0"
                aria-label="Selecionar grupo"
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs text-muted-foreground font-mono"
                  data-testid="group-datetime"
                >
                  {formatDateTime(group.issued_at)}
                </p>
                <p className="text-sm font-medium truncate" data-testid="group-reserva">
                  {group.reserve?.nome ?? "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Armeiro: {group.master?.nome_completo?.split(" ")[0] ?? "—"}
                </p>
              </div>
              <div className="shrink-0" data-testid="group-status-badge">
                {group.hasActive ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                    <Clock className="size-3" />
                    {group.activeCount} ativo{group.activeCount !== 1 ? "s" : ""}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="size-3" /> Devolvido
                  </span>
                )}
              </div>
            </div>

            {/* Items */}
            <div className="divide-y divide-border">
              {group.items.map((item) => {
                const isSelected = selectedIds.has(item.id);
                return (
                  <div
                    key={item.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors",
                      isSelected ? "bg-primary/5" : "hover:bg-muted/20"
                    )}
                    onClick={() => onToggleItem(item.id)}
                    data-testid="historico-item"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleItem(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer shrink-0"
                      aria-label={`Selecionar ${item.material_type?.nome ?? "item"}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.material_type?.nome ?? "—"}</p>
                      <p className="text-xs text-muted-foreground capitalize">{item.material_type?.categoria ?? "—"}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-muted-foreground font-mono">×{item.quantidade ?? 1}</span>
                      <span className={cn(
                        "text-[11px] font-medium px-1.5 py-0.5 rounded",
                        item.status_legacy === "ativo"
                          ? "text-amber-700 bg-amber-50"
                          : item.status_legacy === "perdido"
                          ? "text-red-700 bg-red-50"
                          : "text-emerald-700 bg-emerald-50"
                      )}>
                        {STATUS_LABELS[item.status_legacy]?.label ?? item.status_legacy}
                      </span>
                      {item.returned_at && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(item.returned_at).toLocaleDateString("pt-BR", { timeZone: APP_TIMEZONE })}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* "Ver mais" */}
      {hasMore && (
        <div className="flex justify-end pt-1">
          <div className="relative">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowLimitMenu(!showLimitMenu)}
              data-testid="btn-ver-mais"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 mr-1 transition-transform", showLimitMenu && "rotate-180")} />
              Ver mais
            </Button>
            {showLimitMenu && (
              <div className="absolute right-0 top-full mt-1 z-10 bg-card rounded-xl border border-border shadow-lg py-1 min-w-[130px]">
                {[20, 30].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onLoadMore(n)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-primary/10 transition-colors"
                    data-testid={`btn-limit-${n}`}
                  >
                    {n} grupos
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── HistoricoClient (main component) ────────────────────────────────────────

export function HistoricoClient() {
  const [lendings, setLendings]         = useState<Lending[]>([]);
  const [options, setOptions]           = useState<FilterOptions>({ reservas: [], categorias: [], materiais: [] });
  const [loading, setLoading]           = useState(true);
  const [exporting, setExporting]       = useState(false);
  const [showFilters, setShowFilters]   = useState(false);

  // Vista
  const [viewMode, setViewMode]         = useState<"cards" | "table">("cards");
  const [limit, setLimit]               = useState<number>(10);
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  // Busca livre
  const [searchTerm, setSearchTerm] = useState("");

  // Filtros
  const [fReserva,   setFReserva]   = useState("");
  const [fCategoria, setFCategoria] = useState("");
  const [fStatus,    setFStatus]    = useState("");
  const [fFrom,      setFFrom]      = useState("");
  const [fTo,        setFTo]        = useState("");

  // Ordenação (só relevante no modo tabela)
  const [sortField, setSortField] = useState<SortField>("issued_at");
  const [sortDir,   setSortDir]   = useState<SortDir>("desc");

  // Seleção para PDF
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const buildParams = useCallback(() => {
    const p = new URLSearchParams();
    if (fReserva)   p.set("reserve_id", fReserva);
    if (fCategoria) p.set("categoria", fCategoria);
    if (fStatus)    p.set("status", fStatus);
    if (fFrom)      p.set("from", fFrom);
    if (fTo)        p.set("to", fTo);
    if (viewMode === "cards") p.set("limit", String(limit));
    return p.toString();
  }, [fReserva, fCategoria, fStatus, fFrom, fTo, viewMode, limit]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams();
      const res = await bffFetch("GET", `/api/usuario/historico${params ? "?" + params : ""}`);
      if (!res.ok) throw new Error("Erro ao carregar histórico");
      const json = res.data as { lendings: Lending[]; reservas: FilterOptions["reservas"]; categorias: string[]; materiais: FilterOptions["materiais"] };
      setLendings(json.lendings ?? []);
      setOptions({ reservas: json.reservas ?? [], categorias: json.categorias ?? [], materiais: json.materiais ?? [] });
      setSelectedIds(new Set());
    } catch {
      toast.error("Falha ao carregar histórico de saídas");
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sorted = useMemo(() => sortLendings(lendings, sortField, sortDir), [lendings, sortField, sortDir]);
  const filtered = useMemo(() => sorted.filter((r) => matchesSearch(r, searchTerm)), [sorted, searchTerm]);

  // Grupos para vista cards
  const groups = useMemo(() => groupByMovement(filtered), [filtered]);
  const hasMore = viewMode === "cards" && lendings.length === limit;

  function handleSort(field: SortField) {
    if (field === sortField) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("asc"); }
  }

  function clearFilters() {
    setFReserva(""); setFCategoria(""); setFStatus(""); setFFrom(""); setFTo("");
  }

  const hasFilters = !!(fReserva || fCategoria || fStatus || fFrom || fTo);

  // Seleção
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => selectedIds.has(r.id));
  const someSelected = selectedIds.size > 0;

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)));
    }
  }

  function toggleRow(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleGroup(ids: string[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSel = ids.every((id) => next.has(id));
      ids.forEach((id) => allSel ? next.delete(id) : next.add(id));
      return next;
    });
  }

  async function exportPdf() {
    if (selectedIds.size === 0) return;
    setExporting(true);
    try {
      const ids = Array.from(selectedIds).join(",");
      const res = await fetch(`${BFF_URL}/api/usuario/historico/pdf?ids=${encodeURIComponent(ids)}`, {
        headers: csrfHeaders(),
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

      {/* ── Busca livre ──────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar por material, categoria, reserva ou armeiro…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full h-10 rounded-xl border border-input bg-white dark:bg-card pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          data-testid="input-busca"
        />
        {searchTerm && (
          <button
            type="button"
            onClick={() => setSearchTerm("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

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

          {/* Toggle card/grade */}
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => { setViewMode("cards"); setShowLimitMenu(false); }}
              title="Ver em cards agrupados"
              className={cn(
                "px-3 py-2 transition-colors",
                viewMode === "cards"
                  ? "bg-primary text-primary-foreground"
                  : "bg-white dark:bg-card text-muted-foreground hover:bg-primary/10"
              )}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("table")}
              title="Ver em grade"
              className={cn(
                "px-3 py-2 transition-colors",
                viewMode === "table"
                  ? "bg-primary text-primary-foreground"
                  : "bg-white dark:bg-card text-muted-foreground hover:bg-primary/10"
              )}
            >
              <Table2 className="size-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {filtered.length} registro{filtered.length !== 1 ? "s" : ""}
            {someSelected && ` · ${selectedIds.size} selecionado${selectedIds.size !== 1 ? "s" : ""}`}
          </span>
          <Button
            variant={someSelected ? "default" : "outline"}
            size="sm"
            onClick={exportPdf}
            disabled={exporting || !someSelected}
            data-testid="btn-exportar-pdf"
          >
            {exporting
              ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              : <FileDown className="h-4 w-4 mr-1.5" />}
            {someSelected ? `Exportar PDF (${selectedIds.size})` : "Exportar PDF"}
          </Button>
        </div>
      </div>

      {/* ── Painel de filtros (colapsável) ─────────────────────────────── */}
      {showFilters && (
        <div className="rounded-xl border bg-muted/30 p-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5" style={{ boxShadow: "var(--shadow-card)" }}>
          <FilterField
            icon={<Building2 className="h-3 w-3" />}
            label="Reserva"
            tooltip="Filtra pela reserva de armamento onde a saída foi registrada."
          >
            <div className="relative">
              <select
                className="w-full h-9 appearance-none rounded-lg border border-input bg-white dark:bg-card px-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={fReserva}
                onChange={(e) => setFReserva(e.target.value)}
                data-testid="filter-reserva"
              >
                <option value="">Todas</option>
                {options.reservas.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </FilterField>

          <FilterField
            icon={<Tag className="h-3 w-3" />}
            label="Categoria"
            tooltip="Filtra pelo tipo de material cadastrado no almoxarifado."
          >
            <div className="relative">
              <select
                className="w-full h-9 appearance-none rounded-lg border border-input bg-white dark:bg-card px-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={fCategoria}
                onChange={(e) => setFCategoria(e.target.value)}
                data-testid="filter-categoria"
              >
                <option value="">Todas</option>
                {options.categorias.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            </div>
          </FilterField>

          <FilterField
            icon={<CircleDot className="h-3 w-3" />}
            label="Status"
            tooltip="Filtra pelo status atual da saída: ativa, devolvida ou perdida."
          >
            <div className="relative">
              <select
                className="w-full h-9 appearance-none rounded-lg border border-input bg-white dark:bg-card px-2.5 pr-7 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
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
          </FilterField>

          <FilterField
            icon={<ArrowUpRight className="h-3 w-3" />}
            label="De"
            tooltip="Filtra saídas a partir desta data, inclusive."
          >
            <input
              type="date"
              className="w-full h-9 rounded-lg border border-input bg-white dark:bg-card px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={fFrom}
              onChange={(e) => setFFrom(e.target.value)}
              data-testid="filter-from"
            />
          </FilterField>

          <FilterField
            icon={<ArrowDownLeft className="h-3 w-3" />}
            label="Até"
            tooltip="Filtra saídas até esta data, inclusive."
          >
            <input
              type="date"
              className="w-full h-9 rounded-lg border border-input bg-white dark:bg-card px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={fTo}
              onChange={(e) => setFTo(e.target.value)}
              data-testid="filter-to"
            />
          </FilterField>

          <div className="sm:col-span-2 lg:col-span-5 flex justify-end pt-1">
            <Button size="sm" onClick={fetchData}>Aplicar filtros</Button>
          </div>
        </div>
      )}

      {/* ── Conteúdo ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">
            {searchTerm || hasFilters ? "Nenhum registro para os filtros aplicados" : "Nenhuma saída registrada"}
          </p>
          {(searchTerm || hasFilters) && (
            <button
              type="button"
              onClick={() => { clearFilters(); setSearchTerm(""); }}
              className="mt-2 text-xs text-primary hover:underline"
            >
              Limpar busca e filtros
            </button>
          )}
        </div>
      ) : viewMode === "cards" ? (
        <HistoricoCardView
          groups={groups}
          hasMore={hasMore}
          showLimitMenu={showLimitMenu}
          setShowLimitMenu={setShowLimitMenu}
          onLoadMore={(n) => { setLimit(n); setShowLimitMenu(false); }}
          selectedIds={selectedIds}
          onToggleItem={toggleRow}
          onToggleGroup={toggleGroup}
        />
      ) : (
        <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="historico-table">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {/* Checkbox select-all */}
                  <th className="px-3 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                      aria-label="Selecionar todos"
                      data-testid="checkbox-all"
                    />
                  </th>
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
                {groups.map((group) => {
                  const groupIds = group.items.map((i) => i.id);
                  const groupSel = groupIds.every((id) => selectedIds.has(id));
                  return (
                    <Fragment key={group.key}>
                      {/* Group separator row */}
                      <tr className="bg-muted/20 border-t border-border">
                        <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={groupSel}
                            onChange={() => toggleGroup(groupIds)}
                            className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                          />
                        </td>
                        <td colSpan={8} className="px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{formatDateTime(group.issued_at)}</span>
                            {group.reserve?.nome && (
                              <span className="font-semibold text-foreground">{group.reserve.nome}</span>
                            )}
                            {group.master && (
                              <span>Armeiro: {[group.master.posto, group.master.nome_completo.split(" ")[0]].filter(Boolean).join(" ")}</span>
                            )}
                            {group.hasActive && (
                              <span className="ml-auto inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0 text-[10px] font-semibold text-amber-700">
                                {group.activeCount} ativo{group.activeCount !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      {/* Item rows */}
                      {group.items.map((row) => {
                        const statusConfig = STATUS_LABELS[row.status_legacy] ?? { label: row.status_legacy, className: "bg-gray-500/10 text-gray-700 border-gray-500/30" };
                        const isSelected = selectedIds.has(row.id);
                        return (
                          <tr
                            key={row.id}
                            onClick={() => toggleRow(row.id)}
                            className={`border-t border-border/40 transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : "hover:bg-muted/30"}`}
                          >
                            <td className="px-3 py-3 pl-8" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleRow(row.id)}
                                className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                                aria-label={`Selecionar ${row.material_type?.nome ?? "item"}`}
                              />
                            </td>
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
                    </Fragment>
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
