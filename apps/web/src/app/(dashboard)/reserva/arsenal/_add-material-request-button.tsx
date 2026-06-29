"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AddMaterialRequestForm } from "@/components/arsenal/material-detail-sheet";

export function AddMaterialRequestButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
        <Plus className="size-4" />
        Adicionar Material
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] max-w-6xl overflow-y-auto p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>Solicitar adicao de material</DialogTitle>
          </DialogHeader>
          <AddMaterialRequestForm onClose={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}
