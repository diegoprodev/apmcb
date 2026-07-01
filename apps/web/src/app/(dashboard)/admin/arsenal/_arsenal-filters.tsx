"use client";

import { useState, useMemo } from "react";
import { Filter } from "lucide-react";
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
import { Package } from "lucide-react";
import { MaterialRowActions } from "./_arsenal-actions";
import type { MaterialCategoryProfile } from "@/lib/material-metadata";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridSortHead } from "@/components/shared/grid-sort-head";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { useGridState } from "@/components/shared/use-grid-state";

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

export function ArsenalTable({ rows, categories }: { rows: MaterialRow[]; categories: MaterialCategoryProfile[] }) {
  const [categoria, setCategoria] = useState("todas");

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
    if (categoria !== "todas") return processedData.filter((m) => m.categoria === categoria);
    return processedData;
  }, [processedData, categoria]);

  return (
    <div
      className="rounded-2xl bg-card overflow-hidden"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-border">
        <GridSearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder="Buscar material..."
          className="flex-1"
        />
        <div className="flex items-center gap-2 shrink-0">
          <GridPdfButton printTargetId="admin-arsenal-print" label="PDF" />
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
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="p-12 text-center">
          <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm font-medium text-muted-foreground">
            {rows.length === 0 ? "Nenhum material cadastrado" : "Nenhum material encontrado"}
          </p>
          {rows.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">Tente ajustar os filtros</p>
          )}
        </div>
      ) : (
        <Table id="admin-arsenal-print">
          <thead>
            <tr className="border-b border-border">
              <GridSortHead<MaterialRow> field="nome" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Material" className="pl-5" />
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
            {filtered.map((m) => (
              <TableRow
                key={m.id}
                className="border-b border-border/60 hover:bg-muted/40 transition-colors"
                data-testid="arsenal-row"
              >
                <TableCell className="pl-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
                      style={{ backgroundColor: "rgba(27,58,140,0.08)", color: "#1B3A8C" }}
                    >
                      {m.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.photo_url} alt="" className="h-full w-full object-cover" />
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
                  }} categories={categories} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
