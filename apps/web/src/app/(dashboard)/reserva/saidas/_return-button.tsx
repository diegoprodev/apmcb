"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export function ReturnButton({ saidaId, materialNome }: { saidaId: string; materialNome: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleReturn() {
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/lendings/${saidaId}/return`, {
        method: "PATCH",
        credentials: "include",
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "Erro ao registrar devolução");
      }
      toast.success(`${materialNome} devolvido com sucesso`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      console.error("[return-button] falha ao registrar devolução", e);
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
            Confirmar devolução de <strong>{materialNome}</strong> ao almoxarifado?
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
