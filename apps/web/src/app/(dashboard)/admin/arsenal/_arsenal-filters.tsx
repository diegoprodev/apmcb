"use client";

import { useState, useMemo } from "react";
import { Filter, LayoutGrid, Table2, ChevronDown, Package } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { MaterialRowActions } from "./_arsenal-actions";
import type { MaterialCategoryProfile } from "@/lib/material-metadata";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridSortHead } from "@/components/shared/grid-sort-head";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { useGridState } from "@/components/shared/use-grid-state";
import { cn } from "@/lib/utils";

type MaterialRow = {
  id: string;
  category_id?: string | null;
  nome: string;
  categoria: string;
  categoria_slug?: string | null;
  descricao?: string | null;
  calibre?: string | null;
  has_serial_numbers?: boolean | null;
  requires_validity?: boolean | null;
  requires_vehicle_fields?: boolean | null;
  validity_alert_days?: number[] | null;
  vehicle_plate?: string | null;
  vehicle_color?: string | null;
  vehicle_year?: number | null;
  vehicle_model?: string | null;
  quantidade_total: number;
  quantidade_disponivel: number;
  quantidade_armada: number;
  photo_url?: string | null;
  /** Signed URL resolvida server-side para exibição (bucket material-photos é privado). */
  photo_display_url?: string | null;
};

const CATEGORIA_LABELS: Record<string, string> = {
  arma:        "Arma",
  colete:      "Colete",
  radio:       "Radio",
  veiculo:     "Veiculo",
  equipamento: "Equipamento",
  farda:       "Fardamento",
  acessorio:   "Acessório",
  outro:       "Outro",
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

function AvailabilityBar({ total, emUso }: { total: number; emUso: number }) {
  const pct = total > 0 ? Math.round((emUso / total) * 100) : 0;
  const color = pct >= 100 ? "#DC2626" : pct >= 75 ? "#D97706" : "#1B3A8C";
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

function MaterialCard({
  material,
  categories,
  selected,
  onToggle,
}: {
  material: MaterialRow;
  categories: MaterialCategoryProfile[];
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div
      data-testid="arsenal-card"
      data-item-key={material.id}
      className={cn(
        "rounded-2xl bg-card overflow-hidden transition-all",
        selected && "ring-2 ring-primary"
      )}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="p-4 flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(material.id)}
          className="size-4 rounded accent-primary mt-0.5 shrink-0"
          aria-label={`Selecionar ${material.nome}`}
        />
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
          style={{ backgroundColor: "rgba(27,58,140,0.08)", color: "#1B3A8C" }}
        >
          {material.photo_display_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={material.photo_display_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <Package className="size-4" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold truncate">{material.nome}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {CATEGORIA_LABELS[material.categoria] ?? material.categoria}
              </p>
            </div>
            <StockStatusBadge disponivel={material.quantidade_disponivel} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-lg font-bold tabular-nums">{material.quantidade_total}</p>
              <p className="text-[10px] text-muted-foreground">Total</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums" style={{ color: "#166634" }}>{material.quantidade_disponivel}</p>
              <p className="text-[10px] text-muted-foreground">Disponível</p>
            </div>
            <div>
              <p className="text-lg font-bold tabular-nums" style={{ color: "#92400E" }}>{material.quantidade_armada ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Em uso</p>
            </div>
          </div>
          <div className="mt-2">
            <AvailabilityBar total={material.quantidade_total} emUso={material.quantidade_armada ?? 0} />
          </div>
        </div>
      </div>
      <div className="border-t border-border px-4 py-2 flex justify-end">
        <MaterialRowActions material={{
          id: material.id,
          category_id: material.category_id ?? null,
          nome: material.nome,
          categoria: material.categoria,
          categoria_slug: material.categoria_slug ?? null,
          quantidade_total: material.quantidade_total,
          quantidade_em_uso: material.quantidade_armada ?? 0,
          descricao: material.descricao ?? null,
          calibre: material.calibre ?? null,
          has_serial_numbers: material.has_serial_numbers ?? false,
          requires_validity: material.requires_validity ?? false,
          requires_vehicle_fields: material.requires_vehicle_fields ?? false,
          validity_alert_days: material.validity_alert_days ?? [],
          vehicle_plate: material.vehicle_plate ?? null,
          vehicle_color: material.vehicle_color ?? null,
          vehicle_year: material.vehicle_year ?? null,
          vehicle_model: material.vehicle_model ?? null,
          photo_url: material.photo_url ?? null,
          photo_display_url: material.photo_display_url ?? null,
        }} categories={categories} />
      </div>
    </div>
  );
}

export function ArsenalTable({ rows, categories }: { rows: MaterialRow[]; categories: MaterialCategoryProfile[] }) {
  const [categoria, setCategoria] = useState("todas");
  const [stockFilter, setStockFilter] = useState("todos");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  const categorias = useMemo(() => {
    const unique = [...new Set(rows.map((r) => r.categoria))].sort();
    return unique;
  }, [rows]);

  const grid = useGridState<MaterialRow>(rows, {
    searchFields: ["nome", "categoria"],
    defaultSort: { field: "nome", dir: "asc" },
  });

  const { searchText, setSearchText, sortField, sortDir, toggleSort, processedData } = grid;

  const filtered = useMemo(() => {
    let result = processedData;
    if (categoria !== "todas") result = result.filter((m) => m.categoria === categoria);
    if (stockFilter === "disponivel") result = result.filter((m) => m.quantidade_disponivel > 0);
    else if (stockFilter === "em_uso") result = result.filter((m) => (m.quantidade_armada ?? 0) > 0);
    else if (stockFilter === "sem_estoque") result = result.filter((m) => m.quantidade_disponivel === 0);
    return result;
  }, [processedData, categoria, stockFilter]);

  const displayed = useMemo(() => filtered.slice(0, displayLimit), [filtered, displayLimit]);
  const hasMore = filtered.length > displayLimit;

  const someSelected = selectedIds.size > 0;
  const allDisplayedSel = displayed.length > 0 && displayed.every((m) => selectedIds.has(m.id));
  const someDisplayedSel = displayed.some((m) => selectedIds.has(m.id));

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allDisplayedSel) displayed.forEach((m) => next.delete(m.id));
      else displayed.forEach((m) => next.add(m.id));
      return next;
    });
  }

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 p-4 border border-border rounded-2xl bg-card" style={{ boxShadow: "var(--shadow-card)" }}>
        <GridSearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder="Buscar material..."
          className="flex-1"
          data-testid="arsenal-search"
        />
        <div className="flex items-center gap-2 shrink-0">
          <GridPdfButton
            printTargetId="admin-arsenal-print"
            label="PDF"
            disabled={!someSelected}
            selectedCount={selectedIds.size}
          />
          <Filter className="size-4 text-muted-foreground" />
          <Select value={categoria} onValueChange={(v) => setCategoria(v ?? "todas")}>
            <SelectTrigger className="w-44" data-testid="arsenal-categoria-filter">
              <SelectValue placeholder="Todas categorias" />
            </SelectTrigger>
            <SelectContent className="bg-background">
              <SelectItem value="todas">Todas categorias</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORIA_LABELS[c] ?? c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* View toggle */}
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button type="button" onClick={() => setViewMode("cards")} title="Ver em cards"
              className={cn("px-3 py-2 transition-colors", viewMode === "cards" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <LayoutGrid className="size-4" />
            </button>
            <button type="button" onClick={() => setViewMode("table")} title="Ver em grade"
              className={cn("px-3 py-2 transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <Table2 className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 flex-wrap">
        {(["todos", "disponivel", "em_uso", "sem_estoque"] as const).map((s) => {
          const labels: Record<string, string> = { todos: "Todos", disponivel: "Disponível", em_uso: "Em uso", sem_estoque: "Sem estoque" };
          return (
            <button key={s} type="button" onClick={() => setStockFilter(s)}
              className={cn("text-xs px-3 py-1.5 rounded-full border font-medium transition-colors",
                stockFilter === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white dark:bg-card text-muted-foreground hover:bg-primary/10 hover:border-primary/40")}>
              {labels[s]}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-card p-12 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {rows.length === 0 ? "Nenhum material cadastrado" : "Nenhum material encontrado"}
          </p>
          {rows.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">Tente ajustar os filtros</p>
          )}
        </div>
      ) : viewMode === "cards" ? (
        <div id="admin-arsenal-print" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayed.map((m) => (
            <MaterialCard
              key={m.id}
              material={m}
              categories={categories}
              selected={selectedIds.has(m.id)}
              onToggle={toggleItem}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <Table id="admin-arsenal-print">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={allDisplayedSel}
                    ref={(el) => { if (el) el.indeterminate = someDisplayedSel && !allDisplayedSel; }}
                    onChange={toggleAll}
                    className="size-4 rounded accent-primary"
                    aria-label="Selecionar todos"
                  />
                </th>
                <GridSortHead<MaterialRow> field="nome" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Material" className="pl-2" />
                <GridSortHead<MaterialRow> field="categoria" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Categoria" className="hidden sm:table-cell" />
                <GridSortHead<MaterialRow> field="quantidade_total" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Total" />
                <GridSortHead<MaterialRow> field="quantidade_disponivel" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Disponível" />
                <GridSortHead<MaterialRow> field="quantidade_armada" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Em uso" />
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Ocupação</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 pr-5 text-right text-xs font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <TableBody>
              {displayed.map((m) => (
                <TableRow
                  key={m.id}
                  className={cn("border-b border-border/60 hover:bg-muted/40 transition-colors", selectedIds.has(m.id) && "bg-primary/5")}
                  data-testid="arsenal-row"
                >
                  <TableCell className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(m.id)}
                      onChange={() => toggleItem(m.id)}
                      className="size-4 rounded accent-primary"
                      aria-label={`Selecionar ${m.nome}`}
                    />
                  </TableCell>
                  <TableCell className="pl-2 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
                        style={{ backgroundColor: "rgba(27,58,140,0.08)", color: "#1B3A8C" }}
                      >
                        {m.photo_display_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.photo_display_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <Package className="size-3.5" />
                        )}
                      </div>
                      <span className="text-sm font-medium text-foreground">{m.nome}</span>
                    </div>
                  </TableCell>
                  <TableCell className="py-3 hidden sm:table-cell">
                    <span className="text-sm text-muted-foreground">
                      {CATEGORIA_LABELS[m.categoria] ?? m.categoria}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <span className="text-sm font-medium tabular-nums">{m.quantidade_total}</span>
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <span className="text-sm font-semibold tabular-nums" style={{ color: "#166534" }}>
                      {m.quantidade_disponivel}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 text-right">
                    <span className="text-sm font-semibold tabular-nums" style={{ color: "#92400E" }}>
                      {m.quantidade_armada ?? 0}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 hidden md:table-cell">
                    <AvailabilityBar total={m.quantidade_total} emUso={m.quantidade_armada ?? 0} />
                  </TableCell>
                  <TableCell className="py-3">
                    <StockStatusBadge disponivel={m.quantidade_disponivel} />
                  </TableCell>
                  <TableCell className="pr-5 py-3">
                    <MaterialRowActions material={{
                      id: m.id,
                      category_id: m.category_id ?? null,
                      nome: m.nome,
                      categoria: m.categoria,
                      categoria_slug: m.categoria_slug ?? null,
                      quantidade_total: m.quantidade_total,
                      quantidade_em_uso: m.quantidade_armada ?? 0,
                      descricao: m.descricao ?? null,
                      calibre: m.calibre ?? null,
                      has_serial_numbers: m.has_serial_numbers ?? false,
                      requires_validity: m.requires_validity ?? false,
                      requires_vehicle_fields: m.requires_vehicle_fields ?? false,
                      validity_alert_days: m.validity_alert_days ?? [],
                      vehicle_plate: m.vehicle_plate ?? null,
                      vehicle_color: m.vehicle_color ?? null,
                      vehicle_year: m.vehicle_year ?? null,
                      vehicle_model: m.vehicle_model ?? null,
                      photo_url: m.photo_url ?? null,
                      photo_display_url: m.photo_display_url ?? null,
                    }} categories={categories} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Ver mais */}
      {hasMore && (
        <div className="relative flex justify-end">
          <button
            data-testid="btn-ver-mais"
            type="button"
            onClick={() => setShowLimitMenu((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/60 transition-colors"
          >
            <ChevronDown className="size-4" />
            Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute right-0 bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-40">
              {[20, 30].map((n) => (
                <button
                  key={n}
                  data-testid={`btn-limit-${n}`}
                  type="button"
                  onClick={() => { setShowLimitMenu(false); setDisplayLimit(n); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors"
                >
                  Mostrar {n} registros
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
