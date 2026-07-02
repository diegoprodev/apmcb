"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X } from "lucide-react";

interface ComboBoxProps<T extends { id: string }> {
  items: T[];
  selected: T | null;
  onSelect: (item: T | null) => void;
  placeholder: string;
  getLabel: (item: T) => string;
  getSecondary?: (item: T) => string;
  disabled?: boolean;
}

export function ComboBox<T extends { id: string }>({
  items,
  selected,
  onSelect,
  placeholder,
  getLabel,
  getSecondary,
  disabled,
}: ComboBoxProps<T>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const results =
    query.trim().length >= 1
      ? items
          .filter((item) => {
            const label = getLabel(item).toLowerCase();
            const sec = getSecondary?.(item)?.toLowerCase() ?? "";
            const q = query.toLowerCase();
            return label.includes(q) || sec.includes(q);
          })
          .slice(0, 8)
      : [];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(item: T) {
    onSelect(item);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleClear() {
    onSelect(null);
    setQuery("");
    inputRef.current?.focus();
  }

  if (selected) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-primary bg-primary/5 px-3 py-2.5 gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{getLabel(selected)}</p>
          {getSecondary && (
            <p className="text-xs text-muted-foreground">{getSecondary(selected)}</p>
          )}
        </div>
        {!disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-xl border border-input bg-background pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors placeholder:text-muted-foreground disabled:opacity-50"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      {open && results.length > 0 && (
        <div
          className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden"
          style={{ backgroundColor: "hsl(var(--card))" }}
        >
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className="w-full px-4 py-2.5 text-left hover:bg-muted/60 transition-colors flex items-center justify-between gap-2 cursor-pointer"
              onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
            >
              <span className="text-sm font-medium truncate">{getLabel(item)}</span>
              {getSecondary && (
                <span className="text-xs text-muted-foreground shrink-0">{getSecondary(item)}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {open && query.trim().length >= 1 && results.length === 0 && (
        <div
          className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg px-4 py-3 text-sm text-muted-foreground"
          style={{ backgroundColor: "hsl(var(--card))" }}
        >
          Nenhum resultado para &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}
