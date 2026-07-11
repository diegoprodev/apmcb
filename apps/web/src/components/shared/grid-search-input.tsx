"use client";

import { Search, X } from "lucide-react";

interface GridSearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** Selector estável para E2E (Playwright getByTestId) — repassado direto ao <input>. */
  "data-testid"?: string;
}

export function GridSearchInput({ value, onChange, placeholder = "Buscar...", className, "data-testid": testId }: GridSearchInputProps) {
  return (
    <div className={`relative ${className ?? ""}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        data-testid={testId}
        className="w-full rounded-xl border border-input bg-white dark:bg-card pl-9 pr-9 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
