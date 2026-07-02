"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Loader2, ChevronLeft, Package, Plus, X,
  Fingerprint, KeyRound, ShieldCheck, AlertCircle, MapPin,
} from "lucide-react";
import Link from "next/link";
import { LOCAIS_ARMAMENTO } from "@/lib/locais-armamento";
import { ComboBox } from "@/components/shared/combobox";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface Militar {
  id: string;
  nome_completo: string;
  nome_de_guerra: string | null;
  matricula: string;
  posto: string | null;
  registration_status?: string | null;
}

interface Material {
  id: string;
  nome: string;
  categoria: string;
  quantidade_disponivel: number;
  quantidade_total: number;
}

type LineItem = { key: string; material: Material | null; quantidade: number };

function militarLabel(m: Militar) {
  const nome = m.nome_de_guerra ?? m.nome_completo;
  return m.posto ? `${m.posto} ${nome}` : nome;
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
  const [items, setItems] = useState<LineItem[]>([
    { key: crypto.randomUUID(), material: null, quantidade: 1 },
  ]);
  const [notas, setNotas] = useState("");
  const [local, setLocal] = useState("");
  const [loading, setLoading] = useState(false);

  // verification state
  const [verifMode, setVerifMode] = useState<VerifMode>("biometria");
  const [verified, setVerified] = useState(false);
  const [verifLoading, setVerifLoading] = useState(false);
  const [verifError, setVerifError] = useState("");
  const [totpCode, setTotpCode] = useState("");

  // IDs já selecionados em outras linhas (para excluir do combobox de cada linha)
  const selectedIds = new Set(items.map((i) => i.material?.id).filter(Boolean));

  function addItem() {
    setItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), material: null, quantidade: 1 },
    ]);
  }

  function removeItem(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  function updateMaterial(key: string, material: Material | null) {
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, material, quantidade: 1 } : i))
    );
  }

  function updateQtd(key: string, delta: number | null, direct?: number) {
    setItems((prev) =>
      prev.map((i) => {
        if (i.key !== key) return i;
        const max = i.material?.quantidade_disponivel ?? 1;
        if (direct !== undefined) {
          return { ...i, quantidade: Math.min(max, Math.max(1, direct)) };
        }
        return { ...i, quantidade: Math.min(max, Math.max(1, i.quantidade + (delta ?? 0))) };
      })
    );
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

  const isImpedido = militar?.registration_status === "impedimento_administrativo";
  const allItemsHaveMaterial = items.every((i) => i.material !== null);
  const allItemsHaveStock = items.every(
    (i) => i.material && i.quantidade >= 1 && i.quantidade <= i.material.quantidade_disponivel
  );
  const canSubmit = !!militar && !isImpedido && allItemsHaveMaterial && allItemsHaveStock && verified;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!militar) { toast.error("Selecione o militar"); return; }
    if (!allItemsHaveMaterial) { toast.error("Selecione o material em todas as linhas"); return; }
    if (!allItemsHaveStock) { toast.error("Quantidade inválida em um dos materiais"); return; }
    if (!verified) { toast.error("Verifique a identidade do militar antes de registrar"); return; }

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const movementId = items.length > 1 ? crypto.randomUUID() : null;
      // Sequential submission with rollback: if any request fails, DELETE the ones that succeeded
      const createdIds: string[] = [];
      for (const item of items) {
        const res = await fetch(`${BFF_URL}/api/lendings`, {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({
            material_type_id: item.material!.id,
            military_id: militar!.id,
            quantidade: item.quantidade,
            notes: notas || undefined,
            auth_mode: verifMode,
            movement_id: movementId ?? undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          // Rollback: delete already-created lendings
          await Promise.allSettled(
            createdIds.map((id) =>
              fetch(`${BFF_URL}/api/lendings/${id}`, {
                method: "DELETE",
                credentials: "include",
                headers,
              })
            )
          );
          throw new Error(data.error ?? "Erro ao registrar saída");
        }
        const created = await res.json().catch(() => ({})) as { id?: string };
        if (created.id) createdIds.push(created.id);
      }
      const total = items.length;
      toast.success(
        total === 1
          ? "Saída registrada com sucesso"
          : `${total} materiais registrados com sucesso`
      );
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
            getLabel={militarLabel}
            getSecondary={(m) => `Mat. ${m.matricula}`}
          />
        </div>

        {/* Impedimento alert */}
        {isImpedido && (
          <div className="flex items-start gap-2.5 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-3">
            <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">Impedimento Administrativo</p>
              <p className="text-xs text-destructive/90 mt-0.5">
                Este militar está impedido de retirar armamento. Para dúvidas, o militar deve procurar o
                Departamento de Pessoas de sua unidade.
              </p>
            </div>
          </div>
        )}

        {/* Materiais — múltiplos */}
        <div className="space-y-3">
          <Label>
            Materiais
            <span className="ml-1.5 text-xs text-muted-foreground font-normal">
              ({items.length} {items.length === 1 ? "item" : "itens"})
            </span>
          </Label>

          {items.map((item, idx) => {
            // Materiais disponíveis para esta linha = todos exceto os selecionados nas OUTRAS linhas
            const available = materiais.filter(
              (m) => !selectedIds.has(m.id) || m.id === item.material?.id
            );
            const max = item.material?.quantidade_disponivel ?? 1;
            const overStock = item.material && item.quantidade > item.material.quantidade_disponivel;

            return (
              <div key={item.key} className="rounded-xl border border-border p-3 space-y-2.5 bg-background">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground w-5 shrink-0">
                    {idx + 1}.
                  </span>
                  <div className="flex-1 min-w-0">
                    <ComboBox<Material>
                      items={available}
                      selected={item.material}
                      onSelect={(m) => updateMaterial(item.key, m)}
                      placeholder="Buscar material pelo nome..."
                      getLabel={(m) => m.nome}
                      getSecondary={(m) =>
                        m.quantidade_disponivel > 0
                          ? `${m.quantidade_disponivel} disponíveis`
                          : "Sem estoque"
                      }
                    />
                  </div>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(item.key)}
                      className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 cursor-pointer"
                      title="Remover linha"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                </div>

                {item.material && (
                  <div className="flex items-center gap-4 pl-7">
                    {/* info strip */}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Package className="size-3" />
                      <span className="capitalize">{item.material.categoria}</span>
                      <span className={item.material.quantidade_disponivel > 0 ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>
                        {item.material.quantidade_disponivel} disponíveis
                      </span>
                    </div>

                    {/* Quantity stepper */}
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateQtd(item.key, -1)}
                        disabled={item.quantidade <= 1}
                        className="size-7 rounded-lg border border-input bg-background flex items-center justify-center text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        −
                      </button>
                      <Input
                        type="number"
                        min={1}
                        max={max}
                        value={item.quantidade}
                        onChange={(e) => updateQtd(item.key, null, Number(e.target.value))}
                        className="w-14 text-center text-sm font-semibold h-7 px-1"
                      />
                      <button
                        type="button"
                        onClick={() => updateQtd(item.key, 1)}
                        disabled={item.quantidade >= max || item.material.quantidade_disponivel === 0}
                        className="size-7 rounded-lg border border-input bg-background flex items-center justify-center text-sm font-medium hover:bg-muted transition-colors disabled:opacity-40 cursor-pointer"
                      >
                        +
                      </button>
                      <span className="text-[11px] text-muted-foreground">máx. {max}</span>
                    </div>
                  </div>
                )}

                {overStock && (
                  <p className="text-xs text-destructive pl-7">
                    Estoque insuficiente — máx. {item.material?.quantidade_disponivel}
                  </p>
                )}
              </div>
            );
          })}

          {/* Botão + adicionar */}
          <button
            type="button"
            onClick={addItem}
            className="flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium transition-colors cursor-pointer"
          >
            <Plus className="size-4" />
            Adicionar material
          </button>
        </div>

        {/* Local de saída */}
        <div className="space-y-1.5">
          <Label htmlFor="local" className="flex items-center gap-1.5">
            <MapPin className="size-3.5" />
            Local de saída (opcional)
          </Label>
          <select
            id="local"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
          >
            <option value="">Selecionar local...</option>
            {LOCAIS_ARMAMENTO.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
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

      {/* Verificação de Identidade */}
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
          disabled={loading || !canSubmit}
          className="flex-1 h-12 text-base"
        >
          {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          {items.length === 1 ? "Registrar Saída" : `Registrar ${items.length} Saídas`}
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
