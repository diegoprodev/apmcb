"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Users } from "lucide-react";
import { formatDateTime } from "@/lib/format-date";

export interface ReserveShiftActiveArmeiro {
  nome_completo: string;
  matricula: string;
  posto?: string | null;
}

interface ReserveShiftActiveDialogProps {
  open: boolean;
  onCancel: () => void;
  armeiro: ReserveShiftActiveArmeiro | null;
  startedAt?: string | null;
}

/**
 * Mostrado quando o BFF rejeita a abertura de turno com
 * { error: "RESERVE_SHIFT_ACTIVE" } — a reserva selecionada já tem um turno
 * ativo com outro armeiro (o arsenal físico é único por reserva, então dois
 * armeiros não podem estar "de plantão" ao mesmo tempo na mesma sala).
 */
export function ReserveShiftActiveDialog({ open, onCancel, armeiro, startedAt }: ReserveShiftActiveDialogProps) {
  const armeiroLabel = armeiro
    ? [armeiro.posto, armeiro.nome_completo].filter(Boolean).join(" ")
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-sm" data-testid="reserve-shift-active-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            Reserva já tem turno ativo
          </DialogTitle>
          <DialogDescription>
            {armeiroLabel ? (
              <>
                O turno desta reserva já está sendo conduzido por{" "}
                <strong className="text-foreground">{armeiroLabel}</strong>
                {armeiro?.matricula ? ` (mat. ${armeiro.matricula})` : ""}
                {startedAt ? `, desde ${formatDateTime(startedAt)}` : ""}. Aguarde o
                encerramento do turno atual antes de assumi-lo.
              </>
            ) : (
              "Esta reserva já possui um turno ativo com outro armeiro. Aguarde o encerramento antes de assumir."
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onCancel} data-testid="reserve-shift-active-confirm">Entendi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
