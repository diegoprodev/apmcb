"use client";

import { useEffect, useMemo, useState } from "react";

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

  // Achado de code review (uso em reserva/arsenal/_arsenal-client.tsx):
  // sem isso, um item selecionado que sai de `rows` por qualquer motivo que
  // não seja o consumidor limpar a seleção manualmente (ex.: uma ação como
  // "Desativar material" removendo o próprio item selecionado da lista via
  // router.refresh()) deixava um id "fantasma" em selectedIds — o contador
  // de seleção exibido (selectedIds.size) ficava maior que o que realmente
  // seria exportado/agido, sem nenhum aviso. Remove da seleção qualquer id
  // que não existe mais em `rows`, sempre que `rows` mudar — preserva a
  // seleção dos ids que continuam válidos, só descarta os que sumiram.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const validIds = new Set(rows.map((r) => r.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

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
