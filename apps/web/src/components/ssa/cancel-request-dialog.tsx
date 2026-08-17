"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const MIN_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 300;

interface CancelRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Perform the cancellation. Throw (or reject) with an Error to show its
   * message inline and keep the dialog open with the reason preserved —
   * this is how both call sites report a failed BFF response. Resolving
   * closes the dialog and clears the reason. */
  onConfirm: (reason: string) => Promise<void>;
}

/**
 * Shared cancel-confirmation dialog for SSA requests — extracted from
 * SolicitacaoStatusCard and SolicitacaoDetailSheet, which each hand-rolled
 * ~50 lines of an equivalent reason/validation/error UI (one via the real
 * Dialog primitive, the other via a hand-rolled `fixed inset-0` overlay).
 * Reason/validation/loading/error state lives entirely in here — call sites
 * only decide what "confirm" does.
 */
export function CancelRequestDialog({ open, onOpenChange, onConfirm }: CancelRequestDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const valid = reason.trim().length >= MIN_REASON_LENGTH;

  function resetAndClose() {
    onOpenChange(false);
    setReason("");
    setError(null);
  }

  function handleDialogOpenChange(next: boolean) {
    if (loading) return;
    if (!next) { resetAndClose(); return; }
    onOpenChange(next);
  }

  async function handleConfirm() {
    if (!valid) {
      setError(`Informe o motivo do cancelamento (mínimo ${MIN_REASON_LENGTH} caracteres).`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onConfirm(reason.trim());
      resetAndClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao cancelar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
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
            value={reason}
            onChange={(e) => { setReason(e.target.value); setError(null); }}
            maxLength={MAX_REASON_LENGTH}
            rows={3}
            disabled={loading}
            className="resize-none"
          />
          <p className="text-xs text-muted-foreground text-right">
            {reason.length}/{MAX_REASON_LENGTH} · mínimo {MIN_REASON_LENGTH} caracteres
          </p>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={resetAndClose} disabled={loading}>
            Voltar
          </Button>
          <Button
            data-testid="btn-confirm-cancel"
            variant="destructive"
            disabled={!valid || loading}
            onClick={handleConfirm}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Confirmar cancelamento"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
