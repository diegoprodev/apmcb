"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, UserX } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  user: { id: string; nome_completo: string; registration_status: string; activeCount: number } | null;
  currentUserId: string;
}

export function DeactivateUserDialog({ open, onClose, user, currentUserId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const isSelf = user?.id === currentUserId;
  const isAlreadyInactive = user?.registration_status === "inactive";
  const hasActiveItems = (user?.activeCount ?? 0) > 0;
  const canDeactivate = !isSelf && !isAlreadyInactive && !hasActiveItems;

  async function handleDeactivate() {
    if (!user || !canDeactivate) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({ registration_status: "inactive" })
        .eq("id", user.id);
      if (error) throw error;
      toast.success(`${user.nome_completo} desativado`);
      onClose();
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro ao desativar usuário";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  function getBlockReason() {
    if (isSelf) return "Não é possível desativar sua própria conta.";
    if (isAlreadyInactive) return "Este usuário já está inativo.";
    if (hasActiveItems) return `Este usuário tem ${user?.activeCount} saída(s) ativa(s). Registre as devoluções antes de desativar.`;
    return null;
  }

  const blockReason = getBlockReason();

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserX className="size-5 text-destructive" />
            Desativar Usuário
          </DialogTitle>
        </DialogHeader>

        {blockReason ? (
          <p className="text-sm text-muted-foreground">{blockReason}</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Desativar <strong>{user?.nome_completo}</strong>? O usuário perderá acesso ao sistema.
            Esta ação pode ser revertida editando o status.
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            {blockReason ? "Fechar" : "Cancelar"}
          </Button>
          {canDeactivate && (
            <Button variant="destructive" onClick={handleDeactivate} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
              Desativar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
