"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AddMaterialRequestForm } from "@/components/arsenal/material-detail-sheet";

export function AddMaterialRequestButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
        <Plus className="size-4" />
        Adicionar Material
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl px-4 pb-8 pt-6 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <SheetHeader className="mb-4 text-left">
              <SheetTitle className="text-base">Solicitar adicao de material</SheetTitle>
            </SheetHeader>
            <AddMaterialRequestForm onClose={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
