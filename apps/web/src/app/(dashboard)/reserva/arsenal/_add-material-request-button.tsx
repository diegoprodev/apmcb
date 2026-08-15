"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddMaterialRequestForm } from "@/components/arsenal/material-detail-sheet";

export function AddMaterialRequestButton() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!mounted} size="sm" className="gap-1.5">
        <Plus className="size-4" />
        Adicionar Material
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* sm:max-w-6xl (não max-w-6xl puro): o DialogContent base define
            sm:max-w-sm — um max-w-6xl sem prefixo perde pro sm:max-w-sm em
            QUALQUER tela ≥640px (a media query do breakpoint sempre vence a
            regra sem prefixo no CSS gerado pelo Tailwind, mesmo com
            tailwind-merge, já que modificadores diferentes não são
            deduplicados). Achado real: o modal de "Solicitar adição de
            material" ficava preso em 384px (sm:max-w-sm) em qualquer
            desktop, por isso os grids sm:/lg: internos do formulário nunca
            tinham espaço pra ativar — cramped em qualquer tela normal. */}
        <DialogContent className="max-h-[92dvh] sm:max-w-6xl overflow-y-auto p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>Solicitar adicao de material</DialogTitle>
          </DialogHeader>
          <AddMaterialRequestForm onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
