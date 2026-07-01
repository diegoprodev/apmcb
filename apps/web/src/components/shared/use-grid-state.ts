"use client";

import { useMemo, useState, useCallback } from "react";

export type SortDir = "asc" | "desc";

export interface GridStateOptions<T> {
  searchFields: (keyof T)[];
  defaultSort?: { field: keyof T; dir: SortDir };
}

export interface GridState<T> {
  searchText: string;
  setSearchText: (v: string) => void;
  sortField: keyof T | null;
  sortDir: SortDir;
  toggleSort: (field: keyof T) => void;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  processedData: T[];
}

export function useGridState<T extends { id: string }>(
  data: T[],
  options: GridStateOptions<T>
): GridState<T> {
  const { searchFields, defaultSort } = options;

  const [searchText, setSearchText] = useState("");
  const [sortField, setSortField] = useState<keyof T | null>(defaultSort?.field ?? null);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSort?.dir ?? "asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSort = useCallback((field: keyof T) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return field;
      }
      setSortDir("asc");
      return field;
    });
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const processedData = useMemo(() => {
    const q = searchText.toLowerCase().trim();

    let result = q
      ? data.filter((item) =>
          searchFields.some((field) => {
            const val = item[field];
            return typeof val === "string" && val.toLowerCase().includes(q);
          })
        )
      : data;

    if (sortField) {
      result = [...result].sort((a, b) => {
        const av = a[sortField];
        const bv = b[sortField];
        const cmp =
          typeof av === "string" && typeof bv === "string"
            ? av.localeCompare(bv, "pt-BR")
            : (av as number) - (bv as number);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [data, searchText, searchFields, sortField, sortDir]);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(processedData.map((d) => d.id)));
  }, [processedData]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  return {
    searchText, setSearchText,
    sortField, sortDir, toggleSort,
    selectedIds, toggleSelect, selectAll, clearSelection,
    processedData,
  };
}
