"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Loader2, ChevronLeft, Search, X, Package,
  Fingerprint, KeyRound, ShieldCheck, AlertCircle,
} from "lucide-react";
import Link from "next/link";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

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
          <button type="button" onClick={handleClear} className="text-muted-foreground hover:text-foreground shrink-0 cursor-pointer">
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
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg overflow-hidden"
             style={{ backgroundColor: "hsl(var(--card))" }}>
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
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-card shadow-lg px-4 py-3 text-sm text-muted-foreground"
             style={{ backgroundColor: "hsl(var(--card))" }}>
          Nenhum resultado para &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}

type VerifMode = "biometria" | "totp";

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

  // verification state
  const [verifMode, setVerifMode] = useState<VerifMode>("biometria");
  const [verified, setVerified] = useState(false);
  const [verifLoading, setVerifLoading] = useState(false);
  const [verifError, setVerifError] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const maxQtd = material?.quantidade_disponivel ?? 1;

  function handleMaterialSelect(m: Material | null) {
    setMaterial(m);
    setQuantidade(1);
  }

  // Reset verification when military changes
  function handleMilitarSelect(m: Militar | null) {
    setMilitar(m);
    setVerified(false);
    setVerifError("");
    setTotpCode("");
  }

  async function getAuthHeaders(): Promise<Record<string, string>> {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) headers["Authorization"] = `Bearer ${session.access_token}`;
    return headers;
  }

  async function handleBiometria() {
    setVerifLoading(true);
    setVerifError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BFF_URL}/biometric/identify`, {
        method: "POST",
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setVerifError((data as { error?: string }).error ?? "Falha na leitura biométrica. Tente novamente.");
        return;
      }
      const data = await res.json() as { found: boolean; profile?: { id: string; nome_completo?: string } };
      if (!data.found || !data.profile) {
        setVerifError("Biometria não reconhecida. Verifique o cadastro do militar.");
        return;
      }
      if (militar && data.profile.id !== militar.id) {
        setVerifError(`Biometria reconhecida como outro militar. Confirme a identidade.`);
        return;
      }
      setVerified(true);
      toast.success("Identidade verificada por biometria");
    } catch {
      setVerifError("Erro de conexão com o leitor biométrico.");
    } finally {
      setVerifLoading(false);
    }
  }

  async function handleTOTP() {
    if (totpCode.length !== 6) {
      setVerifError("O código deve ter 6 dígitos.");
      return;
    }
    if (!militar) {
      setVerifError("Selecione o militar primeiro.");
      return;
    }
    setVerifLoading(true);
    setVerifError("");
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(`${BFF_URL}/api/totp/validate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ military_id: militar.id, token: totpCode }),
      });
      const data = await res.json() as { valid?: boolean; error?: string };
      if (!res.ok) {
        setVerifError(data.error ?? "Erro ao verificar código.");
        return;
      }
      if (!data.valid) {
        setVerifError("Código inválido ou expirado. O militar deve informar o código atual do app.");
        return;
      }
      setVerified(true);
      toast.success("Identidade verificada por código TOTP");
    } catch {
      setVerifError("Erro de conexão. Tente novamente.");
    } finally {
      setVerifLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!militar || !material) {
      toast.error("Selecione o militar e o material");
      return;
    }
    if (!verified) {
      toast.error("Verifique a identidade do militar antes de registrar");
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
            onSelect={handleMilitarSelect}
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
              className="size-10 rounded-xl border border-input bg-background flex items-center justify-center text-lg font-medium hover:bg-muted transition-colors cursor-pointer"
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
              className="size-10 rounded-xl border border-input bg-background flex items-center justify-center text-lg font-medium hover:bg-muted transition-colors cursor-pointer"
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

      {/* Verificação de Identidade — obrigatória */}
      <div className="rounded-2xl bg-card p-5 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Verificar identidade do militar</p>
            <p className="text-xs text-muted-foreground mt-0.5">Obrigatório antes de registrar</p>
          </div>
          {verified && (
            <span className="flex items-center gap-1.5 text-emerald-700 text-xs font-semibold bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              <ShieldCheck className="size-3.5" />
              Verificado
            </span>
          )}
        </div>

        {/* Mode selector */}
        <div className="grid grid-cols-2 gap-2">
          {(["biometria", "totp"] as VerifMode[]).map((mode) => {
            const Icon = mode === "biometria" ? Fingerprint : KeyRound;
            const label = mode === "biometria" ? "Biometria" : "Código TOTP";
            return (
              <button
                key={mode}
                type="button"
                onClick={() => { setVerifMode(mode); setVerified(false); setVerifError(""); setTotpCode(""); }}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer ${
                  verifMode === mode
                    ? "border-primary bg-primary/5 text-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/60"
                }`}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>

        {/* Biometria action */}
        {verifMode === "biometria" && !verified && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Peça ao militar para apoiar o dedo no leitor biométrico e clique em Capturar.
            </p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleBiometria}
              disabled={verifLoading || !militar}
            >
              {verifLoading ? (
                <Loader2 className="size-4 animate-spin mr-2" />
              ) : (
                <Fingerprint className="size-4 mr-2" />
              )}
              {verifLoading ? "Aguardando biometria..." : "Capturar biometria"}
            </Button>
          </div>
        )}

        {/* TOTP action */}
        {verifMode === "totp" && !verified && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Peça ao militar o código de 6 dígitos exibido no app dele.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={totpCode}
                onChange={(e) => { setTotpCode(e.target.value.replace(/\D/g, "")); setVerifError(""); }}
                placeholder="000000"
                className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-center text-xl font-mono tracking-widest outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                disabled={verifLoading || !militar}
              />
              <Button
                type="button"
                onClick={handleTOTP}
                disabled={verifLoading || totpCode.length !== 6 || !militar}
              >
                {verifLoading ? <Loader2 className="size-4 animate-spin" /> : "Verificar"}
              </Button>
            </div>
          </div>
        )}

        {/* Error */}
        {verifError && (
          <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/5 border border-destructive/20 rounded-xl px-3 py-2">
            <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
            {verifError}
          </div>
        )}

        {/* Verified state */}
        {verified && (
          <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
            <ShieldCheck className="size-4 shrink-0" />
            <span>
              Identidade confirmada via {verifMode === "biometria" ? "biometria" : "código TOTP"}.
              {" "}Prossiga com o registro.
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pb-6">
        <Button
          type="submit"
          disabled={loading || !militar || !material || material.quantidade_disponivel === 0 || !verified}
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
