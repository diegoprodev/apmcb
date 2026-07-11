"use client";

import { useMemo, useState } from "react";
import {
  Archive, ChevronDown, Download, FileQuestion, Filter, LayoutGrid,
  Lock, MapPin, Search, ShieldAlert, Table2, Truck, Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridSortHead } from "@/components/shared/grid-sort-head";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { GridRowCheckbox, GridSelectAll } from "@/components/shared/grid-row-checkbox";
import { FilterGroupLabel } from "@/components/shared/filter-field";
import { useGridState } from "@/components/shared/use-grid-state";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";
import type { ManutencaoRow } from "@/lib/material-items-manutencao";
import { STATUS_BADGE_CLASS, STATUS_LABEL, type ManutencaoStatus } from "@/lib/material-item-status";

const CONDICAO_LABEL: Record<string, string> = {
  novo: "Novo",
  bom: "Bom",
  regular: "Regular",
  ruim: "Ruim",
  inapto: "Inapto",
};

const CONDICAO_BADGE: Record<string, string> = {
  novo: "badge-success",
  bom: "badge-success",
  regular: "badge-warning",
  ruim: "badge-danger",
  inapto: "badge-danger",
};

const TIPO_IDENTIFICADOR_LABEL: Record<string, string> = {
  numero_serie: "Nº de série",
  patrimonio: "Patrimônio",
  tombo: "Tombo",
  prefixo: "Prefixo",
  placa: "Placa",
  imei: "IMEI",
  interno: "Interno",
};

// Cada aba agora agrupa mais de um status_operacional (ex: Administrativo =
// em_pericia + bloqueado + em_transito + aguardando_baixa) — por isso, ao
// contrário do design original com só manutencao/extraviado, o status
// específico de cada linha precisa ficar visível (StatusBadge), não só a aba.
const STATUS_ICON: Record<ManutencaoStatus, LucideIcon> = {
  avariado: Wrench,
  manutencao: Wrench,
  extraviado: FileQuestion,
  furtado: ShieldAlert,
  em_pericia: Search,
  bloqueado: Lock,
  em_transito: Truck,
  aguardando_baixa: Archive,
};

function ConditionBadge({ condicao }: { condicao: string }) {
  return (
    <span className={cn("text-[11px] font-semibold px-2.5 py-0.5 rounded-full", CONDICAO_BADGE[condicao] ?? "badge-neutral")}>
      {CONDICAO_LABEL[condicao] ?? condicao}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const key = status as ManutencaoStatus;
  return (
    <span className={cn("text-[11px] font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap", STATUS_BADGE_CLASS[key] ?? "badge-neutral")}>
      {STATUS_LABEL[key] ?? status}
    </span>
  );
}

function exportSelectedCSV(rows: ManutencaoRow[], filenameTag: string) {
  const headers = [
    "Identificador", "Tipo Identificador", "Material", "Categoria", "Condicao",
    "Status", "Reserva", "Ultima Movimentacao", "Descricao",
  ];
  const body = rows.map((r) => [
    r.identificador_principal,
    TIPO_IDENTIFICADOR_LABEL[r.tipo_identificador] ?? r.tipo_identificador,
    r.material_nome,
    r.material_categoria,
    CONDICAO_LABEL[r.condicao] ?? r.condicao,
    STATUS_LABEL[r.status_operacional] ?? r.status_operacional,
    r.reserve_nome ?? "",
    formatDate(r.last_movement_at),
    r.descricao_adicional ?? "",
  ]);
  const csv = [headers, ...body]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `manutencao_${filenameTag}_${new Date().toISOString().split("T")[0]}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ManutencaoCard({
  row,
  showReserve,
  selected,
  onToggle,
}: {
  row: ManutencaoRow;
  showReserve: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}) {
  const status = row.status_operacional as ManutencaoStatus;
  const StatusIcon = STATUS_ICON[status] ?? Wrench;
  const iconBadgeClass = STATUS_BADGE_CLASS[status] ?? "badge-neutral";

  return (
    <div
      data-testid="manutencao-card"
      data-group-key={row.id}
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
          onChange={() => onToggle(row.id)}
          className="size-4 rounded accent-primary mt-0.5 shrink-0"
          aria-label={`Selecionar ${row.identificador_principal}`}
        />
        <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", iconBadgeClass)}>
          <StatusIcon className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{row.identificador_principal}</p>
              <p className="text-xs text-muted-foreground truncate">
                {row.material_nome} · <span className="capitalize">{row.material_categoria}</span>
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <StatusBadge status={row.status_operacional} />
              <ConditionBadge condicao={row.condicao} />
            </div>
          </div>
          {row.descricao_adicional && (
            <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{row.descricao_adicional}</p>
          )}
          <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            {showReserve && row.reserve_nome && (
              <span className="inline-flex items-center gap-1 truncate">
                <MapPin className="size-3 shrink-0" />
                {row.reserve_nome}
              </span>
            )}
            <span className="ml-auto shrink-0">
              {formatDate(row.last_movement_at, { day: "2-digit", month: "short", year: "numeric" })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ManutencaoClientProps {
  rows: ManutencaoRow[];
  /** Somente admin_global: presença desta lista habilita o filtro "Reserva". */
  reserves?: { id: string; nome: string; acronym: string }[];
  /** Usado no filename do CSV e no título do relatório PDF. */
  activeTabLabel: string;
}

export function ManutencaoClient({ rows, reserves = [], activeTabLabel }: ManutencaoClientProps) {
  const showReserveFilter = reserves.length > 0;
  const [categoria, setCategoria] = useState("todas");
  const [reservaFiltro, setReservaFiltro] = useState("todas");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  const categorias = useMemo(() => [...new Set(rows.map((r) => r.material_categoria))].sort(), [rows]);

  const grid = useGridState<ManutencaoRow>(rows, {
    searchFields: ["identificador_principal", "material_nome"],
    defaultSort: { field: "last_movement_at", dir: "desc" },
  });
  const { searchText, setSearchText, sortField, sortDir, toggleSort, processedData } = grid;

  const filtered = useMemo(() => {
    let result = processedData;
    if (categoria !== "todas") result = result.filter((r) => r.material_categoria === categoria);
    if (showReserveFilter && reservaFiltro !== "todas") result = result.filter((r) => r.reserve_id === reservaFiltro);
    return result;
  }, [processedData, categoria, reservaFiltro, showReserveFilter]);

  const displayed = useMemo(() => filtered.slice(0, displayLimit), [filtered, displayLimit]);
  const hasMore = filtered.length > displayLimit;

  const someSelected = selectedIds.size > 0;
  const allDisplayedSel = displayed.length > 0 && displayed.every((r) => selectedIds.has(r.id));
  const someDisplayedSel = displayed.some((r) => selectedIds.has(r.id));
  const selectedGroupKeys = useMemo(() => [...selectedIds], [selectedIds]);
  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds]);

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
      if (allDisplayedSel) displayed.forEach((r) => next.delete(r.id));
      else displayed.forEach((r) => next.add(r.id));
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
          placeholder="Buscar por identificador ou material..."
          className="flex-1"
          data-testid="manutencao-search"
        />
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <GridPdfButton
            printTargetId="manutencao-print"
            label="PDF"
            disabled={!someSelected}
            selectedCount={selectedIds.size}
            selectedGroupKeys={someSelected ? selectedGroupKeys : undefined}
            selectedData={someSelected ? selectedRows : undefined}
            reportTitle="MATERIAIS EM TRIAGEM"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!someSelected}
            onClick={() => exportSelectedCSV(selectedRows, activeTabLabel)}
            data-testid="manutencao-csv-button"
          >
            <Download className="size-4" />
            CSV
            {someSelected && (
              <span className="ml-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold px-1.5 py-0.5">
                {selectedIds.size}
              </span>
            )}
          </Button>
          {showReserveFilter && (
            <>
              <FilterGroupLabel label="Reserva" tooltip="Filtra os itens em triagem por reserva de armamento. Disponível apenas para Admin Global." />
              <Select value={reservaFiltro} onValueChange={(v) => setReservaFiltro(v ?? "todas")}>
                <SelectTrigger className="w-40" data-testid="manutencao-reserva-filter">
                  <SelectValue placeholder="Todas as reservas" />
                </SelectTrigger>
                <SelectContent className="bg-background">
                  <SelectItem value="todas">Todas as reservas</SelectItem>
                  {reserves.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <FilterGroupLabel
            icon={<Filter className="size-4" />}
            label="Categoria"
            tooltip="Filtra os itens em triagem pela categoria do material cadastrado."
          />
          <Select value={categoria} onValueChange={(v) => setCategoria(v ?? "todas")}>
            <SelectTrigger className="w-40" data-testid="manutencao-categoria-filter">
              <SelectValue placeholder="Todas categorias" />
            </SelectTrigger>
            <SelectContent className="bg-background">
              <SelectItem value="todas">Todas categorias</SelectItem>
              {categorias.map((c) => (
                <SelectItem key={c} value={c} className="capitalize">
                  {c}
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

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-card p-12 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Wrench className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {rows.length === 0 ? "Nenhum item nesta situação" : "Nenhum item encontrado"}
          </p>
          {rows.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">Tente ajustar os filtros</p>
          )}
        </div>
      ) : viewMode === "cards" ? (
        <div id="manutencao-print" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {displayed.map((r) => (
            <ManutencaoCard
              key={r.id}
              row={r}
              showReserve={showReserveFilter}
              selected={selectedIds.has(r.id)}
              onToggle={toggleItem}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <Table id="manutencao-print">
            <thead>
              <tr className="border-b border-border">
                <GridSelectAll checked={allDisplayedSel} indeterminate={someDisplayedSel && !allDisplayedSel} onChange={toggleAll} />
                <GridSortHead<ManutencaoRow> field="identificador_principal" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Identificador" className="pl-2" />
                <GridSortHead<ManutencaoRow> field="material_nome" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Material" />
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">Categoria</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Condição</th>
                {showReserveFilter && (
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">Reserva</th>
                )}
                <GridSortHead<ManutencaoRow> field="last_movement_at" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Última mov." />
                <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">Descrição</th>
              </tr>
            </thead>
            <TableBody>
              {displayed.map((r) => (
                <TableRow
                  key={r.id}
                  data-testid="manutencao-row"
                  data-group-key={r.id}
                  className={cn("border-b border-border/60 hover:bg-muted/40 transition-colors", selectedIds.has(r.id) && "bg-primary/5")}
                >
                  <GridRowCheckbox checked={selectedIds.has(r.id)} onChange={() => toggleItem(r.id)} />
                  <TableCell className="pl-2 py-3">
                    <p className="text-sm font-medium text-foreground">{r.identificador_principal}</p>
                    <p className="text-[11px] text-muted-foreground">{TIPO_IDENTIFICADOR_LABEL[r.tipo_identificador] ?? r.tipo_identificador}</p>
                  </TableCell>
                  <TableCell className="py-3">
                    <span className="text-sm text-foreground">{r.material_nome}</span>
                  </TableCell>
                  <TableCell className="py-3 hidden sm:table-cell">
                    <span className="text-sm text-muted-foreground capitalize">{r.material_categoria}</span>
                  </TableCell>
                  <TableCell className="py-3">
                    <StatusBadge status={r.status_operacional} />
                  </TableCell>
                  <TableCell className="py-3">
                    <ConditionBadge condicao={r.condicao} />
                  </TableCell>
                  {showReserveFilter && (
                    <TableCell className="py-3 hidden md:table-cell">
                      <span className="text-sm text-muted-foreground">{r.reserve_nome ?? "—"}</span>
                    </TableCell>
                  )}
                  <TableCell className="py-3">
                    <span className="text-sm text-muted-foreground">
                      {formatDate(r.last_movement_at, { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 hidden lg:table-cell">
                    <span className="text-sm text-muted-foreground line-clamp-1">{r.descricao_adicional ?? "—"}</span>
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
