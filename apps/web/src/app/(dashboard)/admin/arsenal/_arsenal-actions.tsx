"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaterialDialog } from "./_material-dialog";
import { DeleteMaterialDialog } from "./_delete-dialog";

interface Material {
  id: string;
  nome: string;
  categoria: string;
  quantidade_total: number;
  quantidade_em_uso: number;
}

export function AddMaterialButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
        <Plus className="size-4" />
        Adicionar Material
      </Button>
      <MaterialDialog open={open} onClose={() => setOpen(false)} material={null} />
    </>
  );
}

export function MaterialRowActions({ material }: { material: Material }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <>
      <div className="flex items-center gap-1 justify-end">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => setEditOpen(true)}
          title="Editar"
        >
          <Pencil className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={() => setDeleteOpen(true)}
          title="Remover"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      <MaterialDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        material={material}
      />
      <DeleteMaterialDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        material={material}
      />
    </>
  );
}
