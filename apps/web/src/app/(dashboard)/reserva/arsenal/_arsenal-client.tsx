"use client";

import { useState, useMemo } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { MaterialDetailSheet, type MaterialItem } from "@/components/arsenal/material-detail-sheet";

const CATEGORIA_LABEL: Record<string, string> = {
  arma: "Arma", farda: "Farda", acessorio: "Acessório",
  equipamento: "Equipamento", outro: "Outro",
};

type StockFilter = "all" | "ok" | "baixo" | "esgotado";

function getStatus(m: MaterialItem) {
  const pct = m.quantidade_total > 0
    ? (m.quantidade_disponivel / m.quantidade_total) * 100 : 0;
  if (m.quantidade_disponivel === 0) return "esgotado";
  if (pct <= 20) return "baixo";
  return "ok";
}

export function ArsenalClient({
  items,
  canRequest,
}: {
  items: MaterialItem[];
  canRequest: boolean;
}) {
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [selected, setSelected] = useState<MaterialItem | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(items.map((m) => m.categoria)))],
    [items]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return items.filter((m) => {
      if (q && !m.nome.toLowerCase().includes(q) && !m.categoria.toLowerCase().includes(q)) return false;
      if (catFilter !== "all" && m.categoria !== catFilter) return false;
      if (stockFilter !== "all" && getStatus(m) !== stockFilter) return false;
      return true;
    });
  }, [items, search, catFilter, stockFilter]);

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
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar material..."
            className="w-full rounded-xl border border-input bg-card pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer">
              <X className="size-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
            hasActiveFilters
              ? "border-primary bg-primary/5 text-primary"
              : "border-border bg-card text-muted-foreground hover:bg-muted/60"
          }`}
        >
          <SlidersHorizontal className="size-4" />
          Filtros
          {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
        </button>
      </div>

      {/* Expanded filters */}
      {filtersOpen && (
        <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-3">
          {/* Category */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-muted-foreground font-medium mr-1">Categoria:</span>
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCatFilter(cat)}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors cursor-pointer ${
                  catFilter === cat
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {cat === "all" ? "Todas" : CATEGORIA_LABEL[cat] ?? cat}
              </button>
            ))}
          </div>

          {/* Stock status */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs text-muted-foreground font-medium mr-1">Estoque:</span>
            {(["all", "ok", "baixo", "esgotado"] as StockFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStockFilter(s)}
                className={`text-xs px-2.5 py-1 rounded-full border font-medium transition-colors cursor-pointer ${
                  stockFilter === s
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/60"
                }`}
              >
                {s === "all" ? "Todos" : s === "ok" ? "Regular" : s === "baixo" ? "Baixo" : "Esgotado"}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => { setCatFilter("all"); setStockFilter("all"); }}
              className="text-xs text-destructive hover:underline cursor-pointer ml-auto"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}

      {/* Result count */}
      {(search || hasActiveFilters) && (
        <p className="text-xs text-muted-foreground">
          {filtered.length} {filtered.length === 1 ? "material encontrado" : "materiais encontrados"}
        </p>
      )}

      {/* Grouped list */}
      {Object.keys(grouped).length === 0 ? (
        <div className="rounded-2xl bg-card p-10 text-center text-muted-foreground text-sm"
          style={{ boxShadow: "var(--shadow-card)" }}>
          Nenhum material encontrado
          {(search || hasActiveFilters) && (
            <button type="button" onClick={() => { setSearch(""); setCatFilter("all"); setStockFilter("all"); }}
              className="mt-2 block w-full text-xs text-primary hover:underline cursor-pointer">
              Limpar filtros
            </button>
          )}
        </div>
      ) : (
        Object.entries(grouped).map(([cat, itens]) => (
          <div key={cat} className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold">{CATEGORIA_LABEL[cat] ?? cat}</h3>
              <span className="text-xs text-muted-foreground">{itens.length} item{itens.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="divide-y divide-border/60">
              {itens.map((m) => {
                const pct = m.quantidade_total > 0
                  ? Math.round((m.quantidade_disponivel / m.quantidade_total) * 100) : 0;
                const status = getStatus(m);
                const dotColor = status === "esgotado" ? "bg-destructive" : status === "baixo" ? "bg-amber-500" : "bg-emerald-500";
                const numColor = status === "esgotado" ? "text-destructive" : status === "baixo" ? "text-amber-600" : "text-emerald-600";

                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelected(m)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-primary/5 transition-colors cursor-pointer text-left"
                  >
                    <div className={`size-2 rounded-full shrink-0 ${dotColor}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{m.nome}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-20">
                          <div className={`h-full rounded-full ${dotColor}`} style={{ width: `${pct}%` }} />
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
        ))
      )}

      <MaterialDetailSheet
        material={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
        canRequest={canRequest}
      />
    </>
  );
}
