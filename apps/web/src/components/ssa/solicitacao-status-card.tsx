"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, CheckCircle2, XCircle, Package, Ban, ChevronRight, X, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

type Status = "pendente" | "aprovado" | "rejeitado" | "retirado" | "expirado" | "cancelado";

interface Item {
  material_nome_snapshot: string;
  requested_quantity: number;
}

interface Props {
  id: string;
  status: Status;
  items: Item[];
  requested_at: string;
  expires_at?: string | null;
  denial_reason?: string | null;
  cancellation_reason?: string | null;
  armeiro_nota?: string | null;
  approved_at?: string | null;
}

const STATUS_CONFIG: Record<
  Status,
  { label: string; icon: React.ReactNode; badgeClass: string }
> = {
  pendente: {
    label: "Aguardando aprovação",
    icon: <Clock className="size-3 animate-pulse" />,
    badgeClass: "bg-amber-500/10 text-amber-700 border border-amber-500/30",
  },
  aprovado: {
    label: "Aprovado — retire o material",
    icon: <CheckCircle2 className="size-3" />,
    badgeClass: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/30",
  },
  rejeitado: {
    label: "Não aprovado",
    icon: <XCircle className="size-3" />,
    badgeClass: "bg-red-500/10 text-red-700 border border-red-500/30",
  },
  retirado: {
    label: "Material retirado",
    icon: <Package className="size-3" />,
    badgeClass: "bg-blue-500/10 text-blue-700 border border-blue-500/30",
  },
  expirado: {
    label: "Prazo encerrado",
    icon: <Ban className="size-3" />,
    badgeClass: "bg-muted/60 text-muted-foreground border border-border",
  },
  cancelado: {
    label: "Cancelado",
    icon: <Ban className="size-3" />,
    badgeClass: "bg-muted/40 text-muted-foreground border border-border",
  },
};

// timeZone explícito: sem isso, SSR (edge runtime, UTC) e o browser do
// usuário (America/Recife) produzem strings diferentes → hydration mismatch
// (React error #418).
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Recife" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Recife",
  });
}

const cancellableStatuses: Status[] = ["pendente", "aprovado"];

export function SolicitacaoStatusCard({
  id,
  status,
  items,
  requested_at,
  expires_at,
  denial_reason,
  cancellation_reason,
  armeiro_nota,
}: Props) {
  const router = useRouter();
  const cfg = STATUS_CONFIG[status];
  const materialSummary = items
    .slice(0, 2)
    .map((i) => `${i.material_nome_snapshot} ×${i.requested_quantity}`)
    .join(", ");
  const extra = items.length > 2 ? ` +${items.length - 2}` : "";

  // Cancel dialog state
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const cancelValid = cancelReason.trim().length >= 10;

  async function handleCancel() {
    if (!cancelValid) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const extraHeaders: HeadersInit = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const res = await fetch(`${BFF_URL}/api/ssa/requests/${id}/cancel`, {
        method: "PATCH",
        credentials: "include",
        headers: new Headers({
          "Content-Type": "application/json",
          ...Object.fromEntries(new Headers(csrfHeaders()).entries()),
          ...Object.fromEntries(new Headers(extraHeaders).entries()),
        }),
        body: JSON.stringify({ cancellation_reason: cancelReason.trim() }),
      });

      const body = await res.json() as { error?: string };
      if (!res.ok) {
        setCancelError(body.error ?? "Erro ao cancelar solicitação.");
        return;
      }

      setCancelOpen(false);
      router.refresh();
    } catch {
      setCancelError("Sem conexão com o servidor.");
    } finally {
      setCancelling(false);
    }
  }

  const canCancel = cancellableStatuses.includes(status);

  return (
    <>
      <div
        role="article"
        className="rounded-2xl border border-border/40 bg-card p-4 flex flex-col gap-2 transition-colors hover:bg-muted/30"
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        {/* Status badge */}
        <div className={`inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.badgeClass}`}>
          {cfg.icon}
          {cfg.label}
        </div>

        <p className="text-sm font-medium text-foreground truncate">
          {materialSummary}
          {extra && <span className="text-muted-foreground text-xs">{extra}</span>}
        </p>

        <div className="flex items-center justify-between">
          <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
            Solicitado em {formatDate(requested_at)} às {formatTime(requested_at)}
          </p>
          <ChevronRight className="size-3.5 text-muted-foreground" />
        </div>

        {/* Countdown for approved */}
        {status === "aprovado" && expires_at && (
          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-[11px] text-emerald-700 font-medium" suppressHydrationWarning>
            ⏱ Retirar até {formatTime(expires_at)} hoje
          </div>
        )}

        {/* Armeiro note on approved */}
        {status === "aprovado" && armeiro_nota && (
          <div className="rounded-lg bg-muted px-2 py-1 text-[11px] text-muted-foreground">
            💬 {armeiro_nota.slice(0, 100)}{armeiro_nota.length > 100 ? "…" : ""}
          </div>
        )}

        {/* Denial reason */}
        {status === "rejeitado" && denial_reason && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-2 py-1 text-[11px] text-red-700">
            Motivo: {denial_reason.slice(0, 80)}{denial_reason.length > 80 ? "…" : ""}
          </div>
        )}

        {/* Cancellation reason */}
        {status === "cancelado" && cancellation_reason && (
          <div className="rounded-lg bg-muted/40 border border-border px-2 py-1 text-[11px] text-muted-foreground">
            Motivo: {cancellation_reason.slice(0, 80)}{cancellation_reason.length > 80 ? "…" : ""}
          </div>
        )}

        {/* Cancel button for active requests (RR-08) */}
        {canCancel && (
          <button
            type="button"
            data-testid="btn-cancelar-solicitacao"
            onClick={(e) => { e.stopPropagation(); setCancelOpen(true); }}
            className="mt-1 self-start flex items-center gap-1.5 text-[11px] font-medium text-destructive hover:text-destructive/80 transition-colors cursor-pointer"
          >
            <X className="size-3" />
            Cancelar solicitação
          </button>
        )}

        {/* Short ID */}
        <p className="text-[10px] text-muted-foreground/60 font-mono">
          #{id.slice(0, 8).toUpperCase()}
        </p>
      </div>

      {/* Cancel Dialog */}
      <Dialog open={cancelOpen} onOpenChange={(v) => { setCancelOpen(v); if (!v) { setCancelReason(""); setCancelError(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Cancelar Solicitação</DialogTitle>
            <DialogDescription>
              Informe o motivo do cancelamento. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label>
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Textarea
              data-testid="ssa-cancel-reason"
              placeholder="Ex: Mudança de escala, dispensado do serviço..."
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              maxLength={300}
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">
              {cancelReason.length}/300 · mínimo 10 caracteres
            </p>
          </div>

          {cancelError && (
            <p className="text-sm text-destructive">{cancelError}</p>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelling}>
              Voltar
            </Button>
            <Button
              data-testid="btn-confirm-cancel"
              variant="destructive"
              disabled={!cancelValid || cancelling}
              onClick={handleCancel}
            >
              {cancelling ? <Loader2 className="size-4 animate-spin" /> : "Confirmar cancelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
