"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BellRing, Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import { ApiError, friendlyApiError } from "@/lib/api-error";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

// AVU-04/AVU-05 (docs/enterprise/specs/alertas-vencimento-unificado-enterprise.md):
// material_validity_alert_dias_padrao só aceita este conjunto fechado — mesmo
// CHECK constraint de material_validity_alert_events no banco (achado CRÍTICO
// de code review: um valor fora disso aborta o cron de validade inteiro,
// silenciosamente, todo dia).
const MATERIAL_DIAS_PERMITIDOS = [90, 180, 365] as const;

interface Props {
  reserveId: string;
  initialCautelaDias: number[];
  initialMaterialDias: number[];
}

function DiasChips({
  dias, onRemove, disabled,
}: { dias: number[]; onRemove: (d: number) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {dias.length === 0 && <span className="text-xs text-muted-foreground italic">Nenhum dia configurado</span>}
      {dias.map((d) => (
        <span key={d} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary text-xs font-medium px-2.5 py-1">
          {d} {d === 1 ? "dia" : "dias"}
          <button type="button" onClick={() => onRemove(d)} disabled={disabled} aria-label={`Remover ${d} dias`} className="hover:opacity-70">
            <X className="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

export function ReserveAlertSettingsCard({ reserveId, initialCautelaDias, initialMaterialDias }: Props) {
  const [cautelaDias, setCautelaDias] = useState<number[]>(initialCautelaDias);
  const [materialDias, setMaterialDias] = useState<number[]>(initialMaterialDias);
  const [novoCautelaDia, setNovoCautelaDia] = useState("");
  const [saving, setSaving] = useState(false);

  async function salvar(payload: Record<string, number[]>) {
    setSaving(true);
    try {
      const res = await fetch(`${BFF_URL}/api/reserves/${reserveId}/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        console.error("[reserve-alert-settings] falha ao salvar", { status: res.status, error: err.error });
        throw new ApiError(friendlyApiError(res.status, err.error, "Falha ao salvar"), res.status);
      }
      toast.success("Configuração de alertas salva");
    } catch (e: unknown) {
      toast.error(e instanceof ApiError ? e.message : "Erro de conexão. Tente novamente.");
      throw e;
    } finally {
      setSaving(false);
    }
  }

  async function addCautelaDia() {
    const n = Number(novoCautelaDia);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      toast.error("Informe um número inteiro entre 1 e 365");
      return;
    }
    if (cautelaDias.includes(n)) { setNovoCautelaDia(""); return; }
    const next = [...cautelaDias, n].sort((a, b) => b - a);
    const previous = cautelaDias;
    setCautelaDias(next);
    setNovoCautelaDia("");
    try {
      await salvar({ cautela_alert_dias_antes: next });
    } catch {
      setCautelaDias(previous);
    }
  }

  async function removeCautelaDia(d: number) {
    if (cautelaDias.length === 1) {
      toast.error("Mantenha ao menos 1 dia configurado");
      return;
    }
    const next = cautelaDias.filter((x) => x !== d);
    const previous = cautelaDias;
    setCautelaDias(next);
    try {
      await salvar({ cautela_alert_dias_antes: next });
    } catch {
      setCautelaDias(previous);
    }
  }

  async function toggleMaterialDia(d: number) {
    const hasDia = materialDias.includes(d);
    if (hasDia && materialDias.length === 1) {
      toast.error("Mantenha ao menos 1 marco configurado");
      return;
    }
    const next = hasDia ? materialDias.filter((x) => x !== d) : [...materialDias, d].sort((a, b) => b - a);
    const previous = materialDias;
    setMaterialDias(next);
    try {
      await salvar({ material_validity_alert_dias_padrao: next });
    } catch {
      setMaterialDias(previous);
    }
  }

  return (
    <div className="rounded-2xl bg-card p-5 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center gap-2">
        <BellRing className="size-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">Alertas de Vencimento</h3>
        {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground ml-auto" />}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          Cautela — avisar quantos dias antes do prazo de devolução vencer
        </p>
        <DiasChips dias={cautelaDias} onRemove={removeCautelaDia} disabled={saving} />
        <div className="flex gap-1.5">
          <Input
            type="number" min={1} max={365} value={novoCautelaDia}
            onChange={(e) => setNovoCautelaDia(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void addCautelaDia(); } }}
            placeholder="Ex: 15" className="h-8 text-sm max-w-28"
            disabled={saving}
          />
          <Button size="sm" variant="outline" onClick={addCautelaDia} disabled={saving} className="h-8 px-2.5">
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-2 pt-1 border-t border-border/50">
        <p className="text-xs font-medium text-muted-foreground">
          Validade de material — marcos padrão (usados quando o material não tem configuração própria)
        </p>
        <div className="flex flex-wrap gap-1.5">
          {MATERIAL_DIAS_PERMITIDOS.map((d) => {
            const active = materialDias.includes(d);
            return (
              <Button
                key={d} size="sm" variant={active ? "default" : "outline"}
                onClick={() => toggleMaterialDia(d)} disabled={saving}
                className="h-7 px-2.5 text-xs"
              >
                {d} dias
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
