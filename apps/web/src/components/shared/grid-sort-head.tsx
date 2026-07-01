"use client";

import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortDir } from "./use-grid-state";

interface GridSortHeadProps<T> {
  field: keyof T;
  currentSort: { field: keyof T | null; dir: SortDir };
  onSort: (field: keyof T) => void;
  label: string;
  className?: string;
}

export function GridSortHead<T>({ field, currentSort, onSort, label, className }: GridSortHeadProps<T>) {
  const active = currentSort.field === field;
  const Icon = active ? (currentSort.dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <th
      className={cn(
        "px-4 py-2.5 text-left text-xs font-medium text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap",
        active && "text-foreground",
        className
      )}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <Icon className="size-3.5 shrink-0" />
      </span>
    </th>
  );
}
