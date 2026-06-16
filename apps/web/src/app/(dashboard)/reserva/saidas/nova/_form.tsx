"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, ChevronLeft, Search, X, Package } from "lucide-react";
import Link from "next/link";

interface Militar {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string;
}

interface Material {
  id: string;
  nome: string;
  categoria: string;
  quantidade_disponivel: number;
  quantidade_total: number;
}

function ComboBox<T extends { id: string }>({
  items,
  selected,
  onSelect,
  placeholder,
  getLabel,
  getSecondary,
  disabled,
}: {
  items: T[];
  selected: T | null;
  onSelect: (item: T | null) => void;
  placeholder: string;
  getLabel: (item: T) => string;
  getSecondary?: (item: T) => string;
  disabled?: boolean;
}) {
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
          <button type="button" onClick={handleClear} className="text-muted-foreground hover:text-foreground shrink-0">
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
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          {results.map((item) => (
            <button
              key={item.id}
              type="button"
              className="w-full px-4 py-2.5 text-left hover:bg-muted/60 transition-colors flex items-center justify-between gap-2"
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
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg px-4 py-3 text-sm text-muted-foreground">
          Nenhum resultado para "{query}"
        </div>
      )}
    </div>
  );
}

export function NovaSaidaForm({
  militares,
  materiais,
  masterId,
}: {
  militares: Militar[];
  materiais: Material[];
  masterId: string;
}) {
  const router = useRouter();
  const [militar, setMilitar] = useState<Militar | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [quantidade, setQuantidade] = useState(1);
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(false);

  const maxQtd = material?.quantidade_disponivel ?? 1;

  function handleMaterialSelect(m: Material | null) {
    setMaterial(m);
    setQuantidade(1);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!militar || !material) {
      toast.error("Selecione o militar e o material");
      return;
    }
    if (quantidade < 1 || quantidade > maxQtd) {
      toast.error(`Quantidade deve ser entre 1 e ${maxQtd}`);
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("lendings").insert({
        material_type_id: material.id,
        military_id: militar.id,
        master_id: masterId,
        quantidade,
        notes: notas || null,
        status: "ativo",
        issued_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success("Saída registrada com sucesso");
      router.push("/reserva/saidas");
      router.refresh();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao registrar saída";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Link
        href="/reserva/saidas"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        Voltar para saídas
      </Link>

      <div className="rounded-2xl bg-card p-5 space-y-5" style={{ boxShadow: "var(--shadow-card)" }}>

        {/* Militar */}
        <div className="space-y-1.5">
          <Label>Militar</Label>
          <ComboBox<Militar>
            items={militares}
            selected={militar}
            onSelect={setMilitar}
            placeholder="Buscar por nome ou matrícula..."
            getLabel={(m) => `${m.posto} ${m.nome_completo}`}
            getSecondary={(m) => `Mat. ${m.matricula}`}
          />
        </div>

        {/* Material */}
        <div className="space-y-1.5">
          <Label>Material</Label>
          <ComboBox<Material>
            items={materiais}
            selected={material}
            onSelect={handleMaterialSelect}
            placeholder="Buscar material pelo nome..."
            getLabel={(m) => m.nome}
            getSecondary={(m) =>
              m.quantidade_disponivel > 0
                ? `${m.quantidade_disponivel} disponíveis`
                : "Sem estoque"
            }
          />
          {material && (
            <div className="flex items-center gap-2 text-xs pt-0.5">
              <Package className="size-3 text-muted-foreground" />
              <span className="capitalize text-muted-foreground">{material.categoria}</span>
              <span className={material.quantidade_disponivel > 0 ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>
                {material.quantidade_disponivel} disponíveis
              </span>
              <span className="text-muted-foreground">/ {material.quantidade_total} total</span>
            </div>
          )}
        </div>

        {/* Quantidade */}
        <div className="space-y-1.5">
          <Label htmlFor="quantidade">Quantidade</Label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setQuantidade((q) => Math.max(1, q - 1))}
              className="size-10 rounded-xl border border-input bg-background flex items-center justify-center text-lg font-medium hover:bg-muted transition-colors"
              disabled={quantidade <= 1}
            >
              −
            </button>
            <Input
              id="quantidade"
              type="number"
              min={1}
              max={maxQtd}
              value={quantidade}
              onChange={(e) => setQuantidade(Math.min(maxQtd, Math.max(1, Number(e.target.value))))}
              className="w-20 text-center text-lg font-semibold"
              required
            />
            <button
              type="button"
              onClick={() => setQuantidade((q) => Math.min(maxQtd, q + 1))}
              className="size-10 rounded-xl border border-input bg-background flex items-center justify-center text-lg font-medium hover:bg-muted transition-colors"
              disabled={quantidade >= maxQtd || !material}
            >
              +
            </button>
            {material && (
              <span className="text-xs text-muted-foreground">máx. {maxQtd}</span>
            )}
          </div>
        </div>

        {/* Notas */}
        <div className="space-y-1.5">
          <Label htmlFor="notas">Observações (opcional)</Label>
          <Input
            id="notas"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Ex: Para cerimônia do dia 15..."
            maxLength={300}
          />
        </div>
      </div>

      {/* Actions — solid background, no transparency */}
      <div className="flex gap-3 pb-6">
        <Button
          type="submit"
          disabled={loading || !militar || !material || material.quantidade_disponivel === 0}
          className="flex-1 h-12 text-base"
        >
          {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          Registrar Saída
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={loading}
          className="h-12"
        >
          Cancelar
        </Button>
      </div>
    </form>
  );
}
