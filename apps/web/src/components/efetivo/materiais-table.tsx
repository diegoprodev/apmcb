"use client";

import { Package } from "lucide-react";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridSortHead } from "@/components/shared/grid-sort-head";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { useGridState } from "@/components/shared/use-grid-state";
import { ReportarOcorrenciaSheet } from "@/components/efetivo/reportar-ocorrencia-sheet";

type LendingItem = {
  id: string;
  status_legacy: string;
  issued_at: string;
  quantidade: number;
  local: string | null;
  material_nome: string;
  material_categoria: string;
};

export function MateriaisTable({ lendings }: { lendings: LendingItem[] }) {
  const grid = useGridState<LendingItem>(lendings, {
    searchFields: ["material_nome", "material_categoria"],
    defaultSort: { field: "issued_at", dir: "desc" },
  });

  const { searchText, setSearchText, sortField, sortDir, toggleSort, processedData } = grid;

  if (lendings.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
        <Package className="size-10 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">Nenhum material em uso</p>
        <p className="text-xs text-muted-foreground mt-1">
          Requisite materiais para vê-los aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <GridSearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder="Buscar por material..."
          className="flex-1"
        />
        <GridPdfButton printTargetId="efetivo-materiais-print" label="PDF" />
      </div>

      <div id="efetivo-materiais-print" className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
        {processedData.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nenhum material encontrado</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <GridSortHead<LendingItem> field="material_nome" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Material" className="pl-5" />
                  <GridSortHead<LendingItem> field="material_categoria" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Categoria" className="hidden sm:table-cell" />
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Qtd</th>
                  <GridSortHead<LendingItem> field="issued_at" currentSort={{ field: sortField, dir: sortDir }} onSort={toggleSort} label="Data Saída" />
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 pr-5 text-right text-xs font-medium text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {processedData.map((lending) => (
                  <tr key={lending.id} className="border-b border-border/60 hover:bg-muted/40 transition-colors">
                    <td className="px-4 py-3 pl-5">
                      <div className="flex items-center gap-2">
                        <div className="size-7 rounded-lg bg-primary/8 flex items-center justify-center shrink-0">
                          <Package className="size-3.5 text-primary" />
                        </div>
                        <span className="font-medium">{lending.material_nome}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-muted-foreground capitalize">{lending.material_categoria}</td>
                    <td className="px-4 py-3 tabular-nums">{lending.quantidade}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {new Date(lending.issued_at).toLocaleDateString("pt-BR")}
                      {lending.local ? ` · ${lending.local}` : ""}
                    </td>
                    <td className="px-4 py-3">
                      <span className="badge-in-use text-[10px] font-semibold tracking-wide rounded-full px-2 py-0.5">
                        Ativo
                      </span>
                    </td>
                    <td className="px-4 py-3 pr-5 text-right">
                      <ReportarOcorrenciaSheet lendingId={lending.id} materialNome={lending.material_nome}>
                        <span className="text-[10px] text-amber-600 font-medium hover:underline flex items-center justify-end gap-0.5 cursor-pointer">
                          ⚠ Reportar
                        </span>
                      </ReportarOcorrenciaSheet>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
