"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ReturnButton({ saidaId, materialNome }: { saidaId: string; materialNome: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleReturn() {
    setLoading(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("lendings")
        .update({ status: "devolvido", returned_at: new Date().toISOString() })
        .eq("id", saidaId);

      if (error) throw error;
      toast.success(`${materialNome} devolvido com sucesso`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      toast.error("Erro ao registrar devolução");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="h-7 text-xs">
        <RotateCcw className="size-3 mr-1" />
        Devolver
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar Devolução</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Confirmar devolução de <strong>{materialNome}</strong> ao arsenal?
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancelar</Button>
            <Button onClick={handleReturn} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
