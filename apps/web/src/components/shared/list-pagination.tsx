"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

// Paginação padrão de listas (DESIGN.md / guardrails §tabelas): 10/20/30/50 por página,
// intervalo "x–y de N" e anterior/próxima. Controlado — quem usa guarda page/pageSize.
export const PAGE_SIZE_OPTIONS = [10, 20, 30, 50] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export function ListPagination({
  page, pageSize, total, onPageChange, onPageSizeChange, disabled = false, testIdPrefix = "pg",
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = "inline-flex h-8 items-center gap-1 rounded-lg border border-border bg-card px-3 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-40 disabled:pointer-events-none";
  return (
    <nav aria-label="Paginação" className="mt-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-xs text-muted-foreground">
      <span data-testid={`${testIdPrefix}-range`}>{total === 0 ? "0 registros" : `${from}–${to} de ${total}`}</span>
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          Por página
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
            disabled={disabled}
            data-testid={`${testIdPrefix}-size`}
            className="h-8 rounded-lg border border-border bg-card px-2 text-xs text-foreground"
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span aria-live="polite">Página {Math.min(page, pages)} de {pages}</span>
        <div className="flex gap-1.5">
          <button type="button" className={btn} disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Página anterior" data-testid={`${testIdPrefix}-prev`}>
            <ChevronLeft className="size-3.5" /> Anterior
          </button>
          <button type="button" className={btn} disabled={disabled || page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Próxima página" data-testid={`${testIdPrefix}-next`}>
            Próxima <ChevronRight className="size-3.5" />
          </button>
        </div>
      </div>
    </nav>
  );
}
