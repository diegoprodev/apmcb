"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Props {
  reserveId: string;
  reserveNome: string;
  initialValue: boolean;
}

export function ReserveRemoteAccessToggle({ reserveId, reserveNome, initialValue }: Props) {
  const [enabled, setEnabled] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  async function toggle() {
    const next = !enabled;
    setSaving(true);
    try {
      const res = await fetch(`${BFF_URL}/api/reserves/${reserveId}/settings`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ allow_remote_requests: next }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Falha ao salvar");
      }
      setEnabled(next);
      toast.success(next
        ? "Acesso remoto habilitado — externos podem requisitar materiais desta reserva."
        : "Acesso remoto desabilitado — apenas membros desta reserva podem requisitar."
      );
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar configuração.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl bg-card p-5 space-y-3" style={{ boxShadow: "var(--shadow-card)" }}>
      <div className="flex items-center gap-2">
        {enabled
          ? <Wifi className="size-4 text-primary" />
          : <WifiOff className="size-4 text-muted-foreground" />
        }
        <h3 className="text-sm font-semibold text-foreground">Acesso Remoto (SSA)</h3>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5 flex-1">
          <p className="text-sm font-medium">
            {enabled ? "Habilitado" : "Desabilitado"}
          </p>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? `Usuários de outras unidades podem requisitar materiais de ${reserveNome}.`
              : `Apenas membros de ${reserveNome} podem fazer solicitações remotas.`
            }
          </p>
        </div>
        <Button
          variant={enabled ? "default" : "outline"}
          size="sm"
          onClick={toggle}
          disabled={saving}
          aria-label="Alternar acesso remoto SSA"
          className="shrink-0 min-w-25"
        >
          {saving
            ? <Loader2 className="size-4 animate-spin" />
            : enabled
              ? <><Wifi className="size-3.5 mr-1.5" />Ativo</>
              : <><WifiOff className="size-3.5 mr-1.5" />Inativo</>
          }
        </Button>
      </div>
    </div>
  );
}
