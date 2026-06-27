"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, ClipboardList, Loader2, CheckCircle2, AlertTriangle, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Campaign {
  id: string;
  nome: string;
  descricao?: string;
  status: string;
  prazo_inicio?: string;
  prazo_fim: string;
  created_at: string;
  reserve_ids?: string[] | null;
  document_hash?: string;
}

const STATUS_MAP: Record<string, { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  planejado:    { label: "Planejado",    icon: <Clock className="size-3" />,         variant: "secondary" },
  em_andamento: { label: "Em andamento", icon: <Loader2 className="size-3" />,       variant: "default" },
  em_revisao:   { label: "Em revisão",   icon: <AlertTriangle className="size-3" />, variant: "outline" },
  concluido:    { label: "Concluído",    icon: <CheckCircle2 className="size-3" />,  variant: "default" },
  cancelado:    { label: "Cancelado",    icon: <XCircle className="size-3" />,       variant: "destructive" },
};

export default function InventarioPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ nome: "", descricao: "", prazo_fim: "" });
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/inventory/campaigns`, { credentials: "include" });
      if (!res.ok) { toast.error("Falha ao carregar campanhas"); return; }
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!form.nome || !form.prazo_fim) { toast.error("Nome e prazo final são obrigatórios"); return; }
    setSubmitting(true);
    try {
      const res = await fetch(`${BFF_URL}/api/inventory/campaigns`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ nome: form.nome, descricao: form.descricao || undefined, prazo_fim: new Date(form.prazo_fim).toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao criar campanha"); return; }
      toast.success("Campanha criada");
      setDialogOpen(false);
      setForm({ nome: "", descricao: "", prazo_fim: "" });
      load();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStart(id: string) {
    const res = await fetch(`${BFF_URL}/api/inventory/campaigns/${id}/start`, {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error ?? "Erro ao iniciar"); return; }
    toast.success(`Campanha iniciada — ${data.reserve_checks} reservas, ${data.items_created} itens`);
    load();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">Inventário Periódico</h1>
        </div>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="size-4 mr-1" />
          Nova campanha
        </Button>
      </div>

      {/* Lista de campanhas */}
      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <ClipboardList className="size-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhuma campanha de inventário criada.</p>
          <p className="text-xs mt-1">Crie a primeira campanha para iniciar o controle físico.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c) => {
            const st = STATUS_MAP[c.status] ?? { label: c.status, icon: null, variant: "secondary" as const };
            const prazo = new Date(c.prazo_fim).toLocaleDateString("pt-BR");
            const vencida = c.status !== "concluido" && c.status !== "cancelado" && new Date(c.prazo_fim) < new Date();
            return (
              <div key={c.id}
                className="rounded-xl border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-muted/40 transition-colors cursor-pointer"
                onClick={() => router.push(`/admin/inventario/${c.id}`)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm truncate">{c.nome}</span>
                    <Badge variant={st.variant} className="flex items-center gap-1 text-[10px]">
                      {st.icon}{st.label}
                    </Badge>
                    {vencida && <Badge variant="destructive" className="text-[10px]">Vencida</Badge>}
                  </div>
                  {c.descricao && <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.descricao}</p>}
                  <p className="text-xs text-muted-foreground mt-0.5">Prazo: {prazo}</p>
                </div>
                <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {c.status === "planejado" && (
                    <Button size="sm" variant="outline" className="text-xs h-8"
                      onClick={() => handleStart(c.id)}>
                      Iniciar
                    </Button>
                  )}
                  {c.status === "concluido" && c.document_hash && (
                    <Button size="sm" variant="outline" className="text-xs h-8"
                      onClick={() => window.open(`${BFF_URL}/api/inventory/campaigns/${c.id}/pdf`, "_blank")}>
                      PDF
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-xs h-8"
                    onClick={() => router.push(`/admin/inventario/${c.id}`)}>
                    Ver detalhes
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Dialog nova campanha */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nova campanha de inventário</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Nome da campanha *</Label>
              <Input placeholder="Ex: Inventário Jun/2026" value={form.nome}
                onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Descrição</Label>
              <Input placeholder="Opcional" value={form.descricao}
                onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Prazo final *</Label>
              <Input type="datetime-local" value={form.prazo_fim}
                onChange={(e) => setForm((f) => ({ ...f, prazo_fim: e.target.value }))} />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : "Criar campanha"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
