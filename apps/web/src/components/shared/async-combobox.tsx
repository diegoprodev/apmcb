"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { Search, X, Loader2 } from "lucide-react";
import { useClickOutside } from "./use-click-outside";

interface AsyncComboBoxProps<T extends { id: string }> {
  selected: T | null;
  onSelect: (item: T | null) => void;
  /** Busca assíncrona — chamada com debounce a partir de `minChars` caracteres. */
  onSearch: (query: string) => Promise<T[]>;
  placeholder: string;
  getLabel: (item: T) => string;
  getSecondary?: (item: T) => string;
  disabled?: boolean;
  /** Mínimo de caracteres para disparar a busca. Default: 2. */
  minChars?: number;
  /** Debounce em ms. Default: 300. */
  debounceMs?: number;
  testId?: string;
}

/**
 * Mesma API visual/UX do ComboBox (apps/web/src/components/shared/combobox.tsx),
 * mas em vez de filtrar um array pré-carregado, dispara `onSearch` com debounce —
 * usado para listas grandes (10k+ registros) onde carregar tudo client-side não escala.
 */
const DROPDOWN_MAX_HEIGHT = 256; // equivalente ao antigo max-h-64
const DROPDOWN_MIN_HEIGHT = 120;
const DROPDOWN_CLIP_MARGIN = 8;

/**
 * Achado real (Playwright, viewport 1280x620 — MNT16): o painel é
 * `position: absolute` dentro do `DialogContent` (que tem `overflow-y-auto`
 * pra caber em notebooks 14"). Com `max-h-64` fixo, se o input já estiver
 * perto do fim do dialog o painel ultrapassa a borda — e como ele soma à
 * área rolável do dialog, some atrás do rodapé sticky em vez de flutuar
 * por cima. Mede o espaço real contra o ancestral rolável mais próximo
 * (ou a janela, na ausência de um) e reduz a altura ou inverte pra cima.
 */
function findScrollClip(el: HTMLElement): { top: number; bottom: number } {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    if (/(auto|scroll)/.test(window.getComputedStyle(node).overflowY)) {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    }
    node = node.parentElement;
  }
  return { top: 0, bottom: window.innerHeight };
}

export function AsyncComboBox<T extends { id: string }>({
  selected,
  onSelect,
  onSearch,
  placeholder,
  getLabel,
  getSecondary,
  disabled,
  minChars = 2,
  debounceMs = 300,
  testId,
}: AsyncComboBoxProps<T>) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<T[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);
  const [placement, setPlacement] = useState<{ side: "bottom" | "top"; maxHeight: number }>({
    side: "bottom",
    maxHeight: DROPDOWN_MAX_HEIGHT,
  });

  useClickOutside(containerRef, () => setOpen(false));

  useLayoutEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    function recompute() {
      if (!container) return;
      const inputRect = container.getBoundingClientRect();
      const clip = findScrollClip(container);
      const clipBottom = Math.min(clip.bottom, window.innerHeight) - DROPDOWN_CLIP_MARGIN;
      const clipTop = Math.max(clip.top, 0) + DROPDOWN_CLIP_MARGIN;
      const spaceBelow = clipBottom - inputRect.bottom;
      const spaceAbove = inputRect.top - clipTop;

      if (spaceBelow >= DROPDOWN_MIN_HEIGHT || spaceBelow >= spaceAbove) {
        setPlacement({ side: "bottom", maxHeight: Math.max(0, Math.min(DROPDOWN_MAX_HEIGHT, spaceBelow)) });
      } else {
        setPlacement({ side: "top", maxHeight: Math.max(0, Math.min(DROPDOWN_MAX_HEIGHT, spaceAbove)) });
      }
    }

    recompute();
    window.addEventListener("resize", recompute);
    window.addEventListener("scroll", recompute, true);
    return () => {
      window.removeEventListener("resize", recompute);
      window.removeEventListener("scroll", recompute, true);
    };
  }, [open, results.length, loading]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < minChars) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      onSearch(trimmed)
        .then((items) => {
          if (seq === requestSeq.current) setResults(items);
        })
        .catch(() => {
          if (seq === requestSeq.current) setResults([]);
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, debounceMs);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, minChars, debounceMs]);

  function handleSelect(item: T) {
    onSelect(item);
    setQuery("");
    setResults([]);
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleClear() {
    onSelect(null);
    setQuery("");
    setResults([]);
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

  const trimmed = query.trim();
  const showDropdown = open && trimmed.length > 0;
  const placementClass = placement.side === "bottom" ? "top-full mt-1" : "bottom-full mb-1";

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          data-testid={testId}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full rounded-xl border border-input bg-background pl-9 pr-9 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors placeholder:text-muted-foreground disabled:opacity-50"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin" />
        )}
      </div>
      {showDropdown && trimmed.length < minChars && (
        <div
          className={`absolute z-50 w-full rounded-xl border border-border bg-card shadow-lg px-4 py-3 text-sm text-muted-foreground ${placementClass}`}
          style={{ backgroundColor: "hsl(var(--card))" }}
        >
          Digite ao menos {minChars} caracteres...
        </div>
      )}
      {showDropdown && trimmed.length >= minChars && !loading && results.length > 0 && (
        <div
          data-testid={testId ? `${testId}-results` : undefined}
          className={`absolute z-50 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden overflow-y-auto ${placementClass}`}
          style={{ backgroundColor: "hsl(var(--card))", maxHeight: placement.maxHeight }}
        >
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={testId ? `${testId}-option` : undefined}
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
      {showDropdown && trimmed.length >= minChars && !loading && results.length === 0 && (
        <div
          className={`absolute z-50 w-full rounded-xl border border-border bg-card shadow-lg px-4 py-3 text-sm text-muted-foreground ${placementClass}`}
          style={{ backgroundColor: "hsl(var(--card))" }}
        >
          Nenhum resultado para &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}
