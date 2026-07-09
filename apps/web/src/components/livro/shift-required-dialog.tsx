"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";
import Link from "next/link";

interface ShiftRequiredDialogProps {
  open: boolean;
  onCancel: () => void;
}

/**
 * Mostrado quando o BFF rejeita uma movimentação com { error: "SHIFT_REQUIRED" }.
 * Armeiro precisa abrir um turno no Livro Digital antes de cautelar/dar saída.
 */
export function ShiftRequiredDialog({ open, onCancel }: ShiftRequiredDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Turno não iniciado
          </DialogTitle>
          <DialogDescription>
            Inicie um turno no Livro Digital de Serviço antes de registrar movimentações de material.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Link href="/reserva/livro">
            <Button data-testid="btn-ir-para-livro">
              <BookOpen className="h-4 w-4 mr-1" />
              Ir para o Livro Digital
            </Button>
          </Link>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
