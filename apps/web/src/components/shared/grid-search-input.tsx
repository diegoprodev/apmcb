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
        // onInput (não onChange) — achado real de produção investigado ao
        // vivo (2026-08-16): num dos consumidores deste componente
        // (_manutencao-client.tsx, atrás de um fluxo que abre/fecha o dialog
        // de "Registrar ocorrência" antes de navegar de volta pra cá), o
        // React deixava de disparar o onChange sintético para ESTE input
        // depois dessa sequência — confirmado via log direto no handler:
        // o evento nativo "input" sempre chega (onInput), mas "onChange"
        // simplesmente não disparava mais, mesmo com o valor do DOM correto
        // (confirmado via .inputValue()). onInput é o evento nativo de
        // verdade por trás do que React normalmente encaminha como
        // onChange para <input type="text">, então não há perda de
        // comportamento — só maior robustez contra esse caso específico.
        onInput={(e) => onChange((e.target as HTMLInputElement).value)}
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
