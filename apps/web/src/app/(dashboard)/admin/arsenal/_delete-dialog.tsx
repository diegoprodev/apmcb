"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  material: { id: string; nome: string; quantidade_em_uso: number } | null;
}

export function DeleteMaterialDialog({ open, onClose, material }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const hasActiveUse = (material?.quantidade_em_uso ?? 0) > 0;

  async function handleDelete() {
    if (!material || hasActiveUse) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/almoxarifado?id=${material.id}`, { method: "DELETE" });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Erro ao remover material");
      toast.success(`${material.nome} removido do almoxarifado`);
      onClose();
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao remover material";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Remover Material
          </DialogTitle>
        </DialogHeader>

        {hasActiveUse ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <strong>{material?.nome}</strong> não pode ser removido pois possui{" "}
              <strong>{material?.quantidade_em_uso}</strong> unidade(s) em saída ativa.
            </p>
            <p className="text-xs text-muted-foreground">
              Aguarde todas as devoluções antes de remover este material.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Confirmar remoção de <strong>{material?.nome}</strong> do almoxarifado?
            Esta ação não pode ser desfeita.
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {hasActiveUse ? "Fechar" : "Cancelar"}
          </Button>
          {!hasActiveUse && (
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
              Remover
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
