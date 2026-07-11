"use client";

import { useMemo, useState } from "react";

/**
 * Estado de paginação "Ver mais" (10 → 20 → 30, padrão de
 * apps/(dashboard)/admin/arsenal/_arsenal-filters.tsx) + seleção via checkbox
 * escopada aos itens exibidos — mesmo padrão usado no botão de seleção do
 * ArsenalTable. Extraído para reuso entre as três tabelas de relatório
 * (saídas / cautelas / livro de serviço).
 */
export function usePaginatedSelection<T extends { id: string }>(rows: T[]) {
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showLimitMenu, setShowLimitMenu] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const displayed = useMemo(() => rows.slice(0, displayLimit), [rows, displayLimit]);
  const hasMore = rows.length > displayLimit;

  const allDisplayedSel = displayed.length > 0 && displayed.every((r) => selectedIds.has(r.id));
  const someDisplayedSel = displayed.some((r) => selectedIds.has(r.id));

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

  function clearSelection() {
    setSelectedIds(new Set());
  }

  return {
    displayLimit, setDisplayLimit,
    showLimitMenu, setShowLimitMenu,
    displayed, hasMore,
    selectedIds, toggleItem, toggleAll, clearSelection,
    allDisplayedSel, someDisplayedSel,
  };
}
