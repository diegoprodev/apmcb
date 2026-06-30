"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { csrfHeaders } from "@/lib/csrf";
import { createClient } from "@/lib/supabase/client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface Props {
  lendingId: string;
  materialNome: string;
  children: React.ReactNode;
}

export function ReportarOcorrenciaSheet({ lendingId, materialNome, children }: Props) {
  const [open, setOpen] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  function reset() {
    setTitulo("");
    setDescricao("");
    setLoading(false);
    setDone(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (titulo.trim().length < 5 || descricao.trim().length < 10) return;

    setLoading(true);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const authHeader: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const res = await fetch(`${BFF_URL}/api/ocorrencias`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeader, ...csrfHeaders() },
        body: JSON.stringify({
          lending_id: lendingId,
          material_nome_snapshot: materialNome,
          titulo: titulo.trim(),
          descricao: descricao.trim(),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error((body as { error?: string }).error ?? "Erro ao enviar ocorrência.");
        return;
      }

      setDone(true);
      toast.success("Ocorrência reportada. A Reserva de Armamento foi notificada.");
    } catch {
      toast.error("Sem conexão com o servidor.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) setTimeout(reset, 300); }}>
      <span onClick={() => setOpen(true)} className="cursor-pointer">{children}</span>

      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" />
            Reportar Ocorrência
          </SheetTitle>
          <SheetDescription className="text-xs">
            Material: <strong>{materialNome}</strong>
          </SheetDescription>
        </SheetHeader>

        {done ? (
          <div className="text-center space-y-4 py-8">
            <div className="size-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle2 className="size-7 text-emerald-600" />
            </div>
            <div>
              <p className="font-semibold">Ocorrência enviada!</p>
              <p className="text-sm text-muted-foreground mt-1">
                A Reserva de Armamento foi notificada e irá analisar o problema.
              </p>
            </div>
            <Button className="w-full" onClick={() => setOpen(false)}>Fechar</Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="occ-titulo">Título do problema</Label>
              <Input
                id="occ-titulo"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex: Armamento com defeito no mecanismo"
                maxLength={150}
                required
              />
              <p className="text-xs text-muted-foreground">{titulo.length}/150</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="occ-desc">Descrição detalhada</Label>
              <textarea
                id="occ-desc"
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                placeholder="Descreva o problema com detalhes: o que aconteceu, quando, como identificou..."
                maxLength={2000}
                rows={5}
                required
                className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors resize-none"
              />
              <p className="text-xs text-muted-foreground">{descricao.length}/2000</p>
            </div>

            <div className="flex gap-3 pb-4">
              <Button
                type="submit"
                disabled={loading || titulo.trim().length < 5 || descricao.trim().length < 10}
                className="flex-1"
              >
                {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <AlertTriangle className="size-4 mr-2" />}
                Enviar Ocorrência
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
