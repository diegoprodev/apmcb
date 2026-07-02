"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaterialDialog } from "./_material-dialog";
import { DeleteMaterialDialog } from "./_delete-dialog";
import type { MaterialCategoryProfile } from "@/lib/material-metadata";

interface Material {
  id: string;
  category_id?: string | null;
  nome: string;
  categoria: string;
  categoria_slug?: string | null;
  quantidade_total: number;
  quantidade_em_uso: number;
  descricao?: string | null;
  calibre?: string | null;
  has_serial_numbers?: boolean | null;
  requires_validity?: boolean | null;
  requires_vehicle_fields?: boolean | null;
  validity_alert_days?: number[] | null;
  vehicle_plate?: string | null;
  vehicle_color?: string | null;
  vehicle_year?: number | null;
  vehicle_model?: string | null;
  photo_url?: string | null;
}

export function AddMaterialButton({ categories = [] }: { categories?: MaterialCategoryProfile[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" className="gap-1.5">
        <Plus className="size-4" />
        Adicionar Material
      </Button>
      <MaterialDialog open={open} onClose={() => setOpen(false)} material={null} categories={categories} />
    </>
  );
}

export function MaterialRowActions({ material, categories = [] }: { material: Material; categories?: MaterialCategoryProfile[] }) {
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
        categories={categories}
      />
      <DeleteMaterialDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        material={material}
      />
    </>
  );
}
