"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, CheckCircle2, XCircle, Package, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CancelRequestDialog } from "@/components/ssa/cancel-request-dialog";
import { bffFetch } from "@/lib/bff-client";
import { ApiError, friendlyApiError } from "@/lib/api-error";
import type { Status, RequestItem } from "@/types/ssa";

interface Props {
  id: string;
  status: Status;
  items: RequestItem[];
  requested_at: string;
  approved_at?: string | null;
  expires_at?: string | null;
  denial_reason?: string | null;
  cancellation_reason?: string | null;
  armeiro_nota?: string | null;
  /** Trigger element(s). Omit for fully-controlled usage (see `open`/`onOpenChange`) — e.g.
   * a shared instance opened from a `<table>` row, where wrapping the row itself would
   * produce invalid HTML nesting (div > tr). */
  children?: React.ReactNode;
  /** Controlled mode: when provided, the sheet's open state is driven externally instead
   * of by clicking `children`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const STATUS_CONFIG: Record<Status, { label: string; icon: React.ReactNode; color: string }> = {
  pendente:  { label: "Aguardando aprovação",      icon: <Clock className="size-4 animate-pulse" />,    color: "text-amber-700" },
  aprovado:  { label: "Aprovado — retire o material", icon: <CheckCircle2 className="size-4" />,         color: "text-emerald-700" },
  rejeitado: { label: "Não aprovado",              icon: <XCircle className="size-4" />,                color: "text-red-700" },
  retirado:  { label: "Material retirado",         icon: <Package className="size-4" />,                color: "text-blue-700" },
  expirado:  { label: "Prazo encerrado",           icon: <Ban className="size-4" />,                    color: "text-muted-foreground" },
  cancelado: { label: "Cancelado",                 icon: <Ban className="size-4" />,                    color: "text-muted-foreground" },
};

// timeZone explícito: sem isso, SSR (edge runtime, UTC) e o browser do
// usuário (America/Recife) produzem strings diferentes → hydration mismatch
// (React error #418).
function fmt(iso: string, opts?: Intl.DateTimeFormatOptions) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    ...opts,
    timeZone: "America/Recife",
  });
}

export function SolicitacaoDetailSheet({
  id, status, items, requested_at, approved_at, expires_at, denial_reason, cancellation_reason, armeiro_nota, children,
  open: controlledOpen, onOpenChange: controlledOnOpenChange,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen;
  const [cancelOpen, setCancelOpen] = useState(false);
  const suppressRestoreRef = useRef(false);
  const router = useRouter();
  const cfg = STATUS_CONFIG[status];

  // Same endpoint, validation (>=10 chars) and cancellable-status set as
  // SolicitacaoStatusCard's own cancel flow (RR-08 in ssa.ts) — this sheet
  // used to call the legacy DELETE /requests/:id with no minimum-length
  // check, a second divergent cancel path for the same request that let a
  // 1-character reason through where the card enforced 10. Unifying on
  // PATCH .../cancel here removes that gap instead of just adding a new
  // call site for it. Reason/validation/loading/error now live in the
  // shared CancelRequestDialog — this component only performs the request.
  async function handleCancelConfirm(reason: string) {
    const { ok, status, data } = await bffFetch("PATCH", `/api/ssa/requests/${id}/cancel`, {
      cancellation_reason: reason,
    });
    if (!ok) {
      console.error("[ssa] falha ao cancelar solicitação", { status, error: data.error });
      throw new ApiError(friendlyApiError(status, data.error, "Erro ao cancelar. Tente novamente."), status);
    }
    // Achado de code review: Sheet devolve o foco pro elemento que abriu
    // (o card/linha desta solicitação) ao fechar. Mas cancelar tira a
    // solicitação da view filtrada, e o `router.refresh()` a seguir
    // desmonta esse mesmo card pouco depois de receber o foco de volta —
    // suppressRestoreRef avisa o Sheet pra pular a restauração nesta
    // fechada específica, evitando focar algo que está prestes a sumir.
    suppressRestoreRef.current = true;
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen} suppressRestoreRef={suppressRestoreRef}>
        {children && (
          <SheetTrigger asChild>
            {/* No onClick here — SheetTrigger's asChild clones this div and merges its
                own onClick (calls onOpenChange(true)); adding a second one fired it twice
                per click. Keyboard support added separately: onKeyDown only, guarded by
                target===currentTarget so Enter/Space on a nested interactive element
                (e.g. the card's own "Cancelar solicitação" button, which stops
                propagation on click but not on keydown) doesn't also toggle this sheet. */}
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setOpen(true);
                }
              }}
              className="cursor-pointer"
            >
              {children}
            </div>
          </SheetTrigger>
        )}
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl p-6">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-base">Detalhes da Solicitação</SheetTitle>
          </SheetHeader>

          {/* Status */}
          <div className={`flex items-center gap-2 font-semibold text-sm mb-4 ${cfg.color}`}>
            {cfg.icon}
            {cfg.label}
          </div>

          {/* ID + dates */}
          <div className="space-y-1 text-xs text-muted-foreground mb-5">
            <p className="font-mono">#{id.slice(0, 8).toUpperCase()}</p>
            <p>Solicitado em {fmt(requested_at)}</p>
            {approved_at && <p>Aprovado em {fmt(approved_at)}</p>}
            {expires_at && status === "aprovado" && (
              <p className="text-emerald-700 font-medium">⏱ Retirar até {fmt(expires_at)}</p>
            )}
          </div>

          {/* Items */}
          <div className="mb-5">
            <p className="text-xs font-semibold text-foreground mb-2">Materiais solicitados</p>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
                  <span className="text-sm">{item.material_nome_snapshot}</span>
                  <span className="text-xs text-muted-foreground font-medium">×{item.requested_quantity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Armeiro note on approved */}
          {armeiro_nota && status === "aprovado" && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2 mb-5">
              <p className="text-xs font-semibold text-emerald-700 mb-1">Mensagem do armeiro</p>
              <p className="text-xs text-emerald-800">{armeiro_nota}</p>
            </div>
          )}

          {/* Denial reason */}
          {denial_reason && status === "rejeitado" && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 mb-5">
              <p className="text-xs font-semibold text-red-700 mb-1">Motivo da rejeição</p>
              <p className="text-xs text-red-800">{denial_reason}</p>
            </div>
          )}

          {/* Cancellation reason — separate DB column from denial_reason (BUG: previously
              this section reused denial_reason for cancelado, which is always null for
              cancelled requests since armeiro rejection and self-cancellation write to
              different columns). */}
          {cancellation_reason && status === "cancelado" && (
            <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 mb-5">
              <p className="text-xs font-semibold text-red-700 mb-1">Motivo do cancelamento</p>
              <p className="text-xs text-red-800">{cancellation_reason}</p>
            </div>
          )}

          {/* Cancel action — pendente or aprovado, matching SolicitacaoStatusCard's
              cancellableStatuses (table mode has no card, so this sheet is the only
              place to cancel from there; it must offer the same statuses). */}
          {(status === "pendente" || status === "aprovado") && (
            <Button
              variant="outline"
              className="w-full border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => setCancelOpen(true)}
            >
              Cancelar solicitação
            </Button>
          )}
        </SheetContent>
      </Sheet>

      {/* Cancel confirm dialog */}
      <CancelRequestDialog open={cancelOpen} onOpenChange={setCancelOpen} onConfirm={handleCancelConfirm} />
    </>
  );
}
