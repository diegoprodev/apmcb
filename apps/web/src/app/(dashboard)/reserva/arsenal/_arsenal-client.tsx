"use client";

import { useState, useMemo } from "react";
import { Package, SlidersHorizontal, LayoutGrid, List } from "lucide-react";
import { MaterialDetailSheet, type MaterialItem } from "@/components/arsenal/material-detail-sheet";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridSortHead } from "@/components/shared/grid-sort-head";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { FilterGroupLabel } from "@/components/shared/filter-field";
import { useGridState } from "@/components/shared/use-grid-state";
import { cn } from "@/lib/utils";

const CATEGORIA_LABEL: Record<string, string> = {
  arma: "Arma", farda: "Farda", acessorio: "Acessório",
  equipamento: "Equipamento", outro: "Outro",
};

type StockFilter = "all" | "ok" | "baixo" | "esgotado";
type ViewMode = "grade" | "lista";

function getStatus(m: MaterialItem) {
  const pct = m.quantidade_total > 0
    ? (m.quantidade_disponivel / m.quantidade_total) * 100 : 0;
  if (m.quantidade_disponivel === 0) return "esgotado";
  if (pct <= 20) return "baixo";
  return "ok";
}

type MaterialItemFlat = MaterialItem & { id: string };

export function ArsenalClient({
  items,
  canRequest,
  canManageDirectly,
}: {
  items: MaterialItem[];
  canRequest: boolean;
  canManageDirectly: boolean;
}) {
  const [catFilter, setCatFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [selected, setSelected] = useState<MaterialItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("grade");

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(items.map((m) => m.categoria)))],
    [items]
  );

  const grid = useGridState<MaterialItemFlat>(items as MaterialItemFlat[], {
    searchFields: ["nome", "categoria"],
    defaultSort: { field: "nome", dir: "asc" },
  });

  const { searchText, setSearchText, sortField, sortDir, toggleSort, processedData } = grid;

  const filtered = useMemo(() => {
    return processedData.filter((m) => {
      if (catFilter !== "all" && m.categoria !== catFilter) return false;
      if (stockFilter !== "all" && getStatus(m) !== stockFilter) return false;
      return true;
    });
  }, [processedData, catFilter, stockFilter]);

  const grouped = useMemo(() =>
    filtered.reduce<Record<string, MaterialItem[]>>((acc, m) => {
      const cat = m.categoria ?? "outro";
      acc[cat] = acc[cat] ?? [];
      acc[cat].push(m);
      return acc;
    }, {}),
  [filtered]);

  const hasActiveFilters = catFilter !== "all" || stockFilter !== "all";

  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <GridSearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder="Buscar material..."
          className="flex-1"
        />
        <div className="flex items-center gap-2 shrink-0">
          <GridPdfButton printTargetId="arsenal-armeiro-print" label="PDF" />
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button type="button" onClick={() => setViewMode("grade")}
              className={cn("px-2.5 py-2 transition-colors", viewMode === "grade" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <LayoutGrid className="size-4" />
            </button>
            <button type="button" onClick={() => setViewMode("lista")}
              className={cn("px-2.5 py-2 transition-colors", viewMode === "lista" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <List className="size-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors cursor-pointer",
              hasActiveFilters ? "border-primary bg-primary/5 text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted/60"
            )}
          >
            <SlidersHorizontal className="size-4" />
            Filtros
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
          </button>
        </div>
      </div>

      {/* Expanded filters */}
      {filtersOpen && (
        <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3">
          <div className="flex flex-wrap gap-1.5 items-center">
            <FilterGroupLabel
              label="Categoria:"
              tooltip="Filtra os materiais exibidos pela categoria cadastrada no almoxarifado."
              className="mr-1"
            />
            {categories.map((cat) => (
              <button key={cat} type="button" onClick={() => setCatFilter(cat)}
                className={cn("text-xs px-2.5 py-1 rounded-full border font-medium transition-colors cursor-pointer",
                  catFilter === cat ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white dark:bg-card text-muted-foreground hover:bg-primary/10 hover:border-primary/40")}>
                {cat === "all" ? "Todas" : CATEGORIA_LABEL[cat] ?? cat}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 items-center">
            <FilterGroupLabel
              label="Estoque:"
              tooltip="Filtra pela situação do estoque: Regular (acima de 20% disponível), Baixo (20% ou menos) ou Esgotado (nenhuma unidade disponível)."
              className="mr-1"
            />
            {(["all", "ok", "baixo", "esgotado"] as StockFilter[]).map((s) => (
              <button key={s} type="button" onClick={() => setStockFilter(s)}
                className={cn("text-xs px-2.5 py-1 rounded-full border font-medium transition-colors cursor-pointer",
                  stockFilter === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white dark:bg-card text-muted-foreground hover:bg-primary/10 hover:border-primary/40")}>
                {s === "all" ? "Todos" : s === "ok" ? "Regular" : s === "baixo" ? "Baixo" : "Esgotado"}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <button type="button" onClick={() => { setCatFilter("all"); setStockFilter("all"); }}
              className="text-xs text-destructive hover:underline cursor-pointer ml-auto">
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {(searchText || hasActiveFilters) && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "material encontrado" : "materiais encontrados"}
        </p>
      )}

      {/* Lista mode */}
      {viewMode === "lista" ? (
        <div id="arsenal-armeiro-print" className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Nenhum material encontrado</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <GridSortHead<MaterialItemFlat> field="nome" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Material" className="pl-5" />
                  <GridSortHead<MaterialItemFlat> field="categoria" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Categoria" className="hidden sm:table-cell" />
                  <GridSortHead<MaterialItemFlat> field="quantidade_disponivel" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Disponível" />
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Em Uso</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground pr-5">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const status = getStatus(m);
                  return (
                    <tr key={m.id} onClick={() => setSelected(m)} className="border-b border-border/60 hover:bg-primary/5 transition-colors cursor-pointer" data-testid="arsenal-material-row">
                      <td className="px-4 py-3 pl-5">
                        <div className="flex items-center gap-2">
                          <div className="size-7 rounded-lg bg-primary/8 flex items-center justify-center shrink-0 overflow-hidden">
                            {m.photo_display_url ? <img src={m.photo_display_url} alt="" className="h-full w-full object-cover" /> : <Package className="size-3.5 text-primary" />}
                          </div>
                          <span className="font-medium truncate">{m.nome}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground capitalize">{CATEGORIA_LABEL[m.categoria] ?? m.categoria}</td>
                      <td className="px-4 py-3 font-semibold tabular-nums text-emerald-700">{m.quantidade_disponivel}</td>
                      <td className="px-4 py-3 tabular-nums text-amber-700">{m.quantidade_armada ?? 0}</td>
                      <td className="px-4 py-3 pr-5">
                        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full",
                          status === "esgotado" ? "bg-destructive/10 text-destructive" :
                          status === "baixo" ? "bg-amber-50 text-amber-700" :
                          "bg-emerald-50 text-emerald-700")}>
                          {status === "esgotado" ? "Crítico" : status === "baixo" ? "Baixo" : "Regular"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        /* Grade mode — grouped cards */
        Object.keys(grouped).length === 0 ? (
          <div className="rounded-2xl bg-card p-10 text-center text-muted-foreground text-sm" style={{ boxShadow: "var(--shadow-card)" }}>
            Nenhum material encontrado
          </div>
        ) : (
          <div className="space-y-3" id="arsenal-armeiro-print">
            {Object.entries(grouped).map(([cat, itens]) => (
              <div key={cat} className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{CATEGORIA_LABEL[cat] ?? cat}</h3>
                  <span className="text-xs text-muted-foreground">{itens.length} item{itens.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="divide-y divide-border/60">
                  {itens.map((m) => {
                    const pct = m.quantidade_total > 0 ? Math.round((m.quantidade_disponivel / m.quantidade_total) * 100) : 0;
                    const status = getStatus(m);
                    const dotColor = status === "esgotado" ? "bg-destructive" : status === "baixo" ? "bg-amber-500" : "bg-emerald-500";
                    const numColor = status === "esgotado" ? "text-destructive" : status === "baixo" ? "text-amber-600" : "text-emerald-600";
                    return (
                      <button key={m.id} type="button" onClick={() => setSelected(m)}
                        data-testid="arsenal-material-row"
                        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-primary/5 transition-colors cursor-pointer text-left">
                        <div className="relative shrink-0">
                          <div className="size-10 overflow-hidden rounded-xl border border-border bg-muted/40 flex items-center justify-center text-muted-foreground">
                            {m.photo_display_url ? <img src={m.photo_display_url} alt="" className="h-full w-full object-cover" /> : <Package className="size-4" />}
                          </div>
                          <span className={cn("absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card", dotColor)} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{m.nome}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-20">
                              <div className={cn("h-full rounded-full", dotColor)} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="text-[11px] text-muted-foreground">{pct}%</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold">
                            <span className={numColor}>{m.quantidade_disponivel}</span>
                            <span className="text-muted-foreground font-normal text-xs"> / {m.quantidade_total}</span>
                          </p>
                          {m.quantidade_armada > 0 && (
                            <p className="text-[10px] text-muted-foreground">{m.quantidade_armada} em uso</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      <MaterialDetailSheet
        material={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        canRequest={canRequest}
        canManageDirectly={canManageDirectly}
      />
    </>
  );
}
