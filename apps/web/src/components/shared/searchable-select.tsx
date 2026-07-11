"use client";

import { useState, useRef, useMemo } from "react";
import { Search, ChevronDown } from "lucide-react";
import { useClickOutside } from "./use-click-outside";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  /** "" representa a opção "todos" */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  allLabel?: string;
  className?: string;
  disabled?: boolean;
  testId?: string;
}

/**
 * Variante do ComboBox (apps/web/src/components/shared/combobox.tsx) adaptada
 * para o papel de um <Select> pesquisável: mantém o trigger com o valor atual
 * (como um select nativo) e mostra um campo de busca fixo no topo da lista de
 * opções quando aberto. Não existe componente shadcn `command.tsx` no projeto
 * — este componente cobre a mesma necessidade sem trazer uma dependência nova.
 * Indicado para listas pequenas (dezenas de itens) já carregadas em memória.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Todos",
  allLabel = "Todos",
  className,
  disabled,
  testId,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => { setOpen(false); setQuery(""); });

  const selectedOption = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function select(v: string) {
    onChange(v);
    setOpen(false);
    setQuery("");
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-testid={testId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full h-9 items-center justify-between gap-1.5 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className={cn("truncate text-left", !selectedOption && "text-muted-foreground")}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className="size-4 text-muted-foreground shrink-0" />
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 w-full min-w-48 rounded-xl border border-border bg-card shadow-lg overflow-hidden"
          style={{ backgroundColor: "hsl(var(--card))" }}
        >
          <div className="relative border-b border-border p-2">
            <Search className="absolute left-4.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar..."
              className="w-full rounded-lg border border-input bg-background pl-7 pr-2 py-1.5 text-xs outline-none focus:border-primary"
            />
          </div>
          <div role="listbox" className="max-h-56 overflow-y-auto">
            <button
              type="button"
              role="option"
              aria-selected={value === ""}
              onClick={() => select("")}
              className={cn(
                "w-full px-3 py-2 text-left text-sm hover:bg-muted/60 transition-colors",
                value === "" && "bg-primary/10 font-medium"
              )}
            >
              {allLabel}
            </button>
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">Nenhum resultado</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={value === o.value}
                  onClick={() => select(o.value)}
                  className={cn(
                    "w-full px-3 py-2 text-left text-sm hover:bg-muted/60 transition-colors truncate",
                    value === o.value && "bg-primary/10 font-medium"
                  )}
                >
                  {o.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
