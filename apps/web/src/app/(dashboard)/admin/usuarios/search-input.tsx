"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useRef, useCallback, useEffect } from "react";
import { Search, Loader2, X } from "lucide-react";

interface ProfileHit {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
}

export function SearchInput({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [value, setValue] = useState(defaultValue ?? "");
  const [suggestions, setSuggestions] = useState<ProfileHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const navigateWithQuery = useCallback(
    (q: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (q.trim()) {
        params.set("q", q.trim());
      } else {
        params.delete("q");
      }
      router.replace(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setValue(q);

      if (timerRef.current) clearTimeout(timerRef.current);

      if (q.trim().length < 2) {
        setSuggestions([]);
        setOpen(false);
        setLoading(false);
        if (!q.trim()) {
          navigateWithQuery("");
        }
        return;
      }

      setLoading(true);
      timerRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/admin/search-profiles?q=${encodeURIComponent(q.trim())}`);
          const data = await res.json();
          const hits: ProfileHit[] = Array.isArray(data) ? data : [];
          setSuggestions(hits);
          setOpen(hits.length > 0);
        } catch {
          setSuggestions([]);
          setOpen(false);
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    [navigateWithQuery]
  );

  const handleSelect = useCallback(
    (hit: ProfileHit) => {
      const q = hit.nome_completo;
      setValue(q);
      setSuggestions([]);
      setOpen(false);
      navigateWithQuery(q);
    },
    [navigateWithQuery]
  );

  const handleClear = useCallback(() => {
    setValue("");
    setSuggestions([]);
    setOpen(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    navigateWithQuery("");
  }, [navigateWithQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        if (timerRef.current) clearTimeout(timerRef.current);
        setOpen(false);
        navigateWithQuery(value);
      }
      if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [value, navigateWithQuery]
  );

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative">
        {loading ? (
          <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground animate-spin pointer-events-none" />
        ) : (
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
        )}
        <input
          type="search"
          placeholder="Buscar por nome ou matrícula..."
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          className="w-full sm:w-72 pl-9 pr-8 py-2 text-sm rounded-xl border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition-shadow"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Limpar busca"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {open && suggestions.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((hit) => (
            <button
              key={hit.id}
              type="button"
              onMouseDown={(e) => {
                // Prevent input blur before click fires
                e.preventDefault();
                handleSelect(hit);
              }}
              className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0"
            >
              <p className="text-sm font-medium truncate">{hit.nome_completo}</p>
              <p className="text-xs text-muted-foreground">
                {hit.posto ? `${hit.posto} · ` : ""}
                {hit.matricula}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
