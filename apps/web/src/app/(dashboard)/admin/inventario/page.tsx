"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, ClipboardList, Loader2, CheckCircle2, AlertTriangle, Clock, XCircle, LayoutGrid, Table2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";

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
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  const displayed = useMemo(() => campaigns.slice(0, displayLimit), [campaigns, displayLimit]);
  const hasMore = campaigns.length > displayLimit;
  const someSelected = selectedIds.size > 0;
  const allSel = displayed.length > 0 && displayed.every((c) => selectedIds.has(c.id));
  const someSel = displayed.some((c) => selectedIds.has(c.id));

  function toggleItem(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSel) displayed.forEach((c) => next.delete(c.id));
      else displayed.forEach((c) => next.add(c.id));
      return next;
    });
  }

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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-5 text-primary" />
          <h1 className="text-lg font-semibold">Inventário Periódico</h1>
        </div>
        <div className="flex items-center gap-2">
          <GridPdfButton
            printTargetId="inventario-print"
            label="Exportar"
            disabled={!someSelected}
            selectedCount={selectedIds.size}
          />
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button type="button" onClick={() => setViewMode("cards")} title="Ver em cards"
              className={cn("px-3 py-2 transition-colors", viewMode === "cards" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <LayoutGrid className="size-4" />
            </button>
            <button type="button" onClick={() => setViewMode("table")} title="Ver em grade"
              className={cn("px-3 py-2 transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60")}>
              <Table2 className="size-4" />
            </button>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-4 mr-1" />
            Nova campanha
          </Button>
        </div>
      </div>

      {/* Lista de campanhas */}
      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed p-12 text-center text-muted-foreground">
          <ClipboardList className="size-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Nenhuma campanha de inventário criada.</p>
          <p className="text-xs mt-1">Crie a primeira campanha para iniciar o controle físico.</p>
        </div>
      ) : viewMode === "cards" ? (
        <div id="inventario-print" className="space-y-3">
          {displayed.map((c) => {
            const st = STATUS_MAP[c.status] ?? { label: c.status, icon: null, variant: "secondary" as const };
            const prazo = formatDate(c.prazo_fim);
            const vencida = c.status !== "concluido" && c.status !== "cancelado" && new Date(c.prazo_fim) < new Date();
            return (
              <div key={c.id}
                data-testid="inventario-card"
                className={cn(
                  "rounded-xl border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3 hover:bg-muted/40 transition-colors cursor-pointer",
                  selectedIds.has(c.id) && "ring-2 ring-primary"
                )}
                onClick={() => router.push(`/admin/inventario/${c.id}`)}>
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div onClick={(e) => { e.stopPropagation(); toggleItem(c.id); }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={() => toggleItem(c.id)}
                      className="size-4 rounded accent-primary mt-0.5 shrink-0"
                      aria-label={`Selecionar ${c.nome}`}
                    />
                  </div>
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
                </div>
                <div className="flex gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {c.status === "planejado" && (
                    <Button size="sm" variant="outline" className="text-xs h-8" onClick={() => handleStart(c.id)}>
                      Iniciar
                    </Button>
                  )}
                  {c.status === "concluido" && c.document_hash && (
                    <Button size="sm" variant="outline" className="text-xs h-8"
                      onClick={() => window.open(`${BFF_URL}/api/inventory/campaigns/${c.id}/pdf`, "_blank")}>
                      PDF
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="text-xs h-8" onClick={() => router.push(`/admin/inventario/${c.id}`)}>
                    Ver detalhes
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div id="inventario-print" className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-3 w-8">
                    <input
                      type="checkbox"
                      checked={allSel}
                      ref={(el) => { if (el) el.indeterminate = someSel && !allSel; }}
                      onChange={toggleAll}
                      className="size-4 rounded accent-primary"
                      aria-label="Selecionar todos"
                    />
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Campanha</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell">Descrição</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Prazo</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayed.map((c) => {
                  const st = STATUS_MAP[c.status] ?? { label: c.status, icon: null, variant: "secondary" as const };
                  const prazo = formatDate(c.prazo_fim);
                  const vencida = c.status !== "concluido" && c.status !== "cancelado" && new Date(c.prazo_fim) < new Date();
                  return (
                    <tr key={c.id} className={cn("hover:bg-muted/20 transition-colors cursor-pointer", selectedIds.has(c.id) && "bg-primary/5")}
                      onClick={() => router.push(`/admin/inventario/${c.id}`)}>
                      <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); toggleItem(c.id); }}>
                        <input type="checkbox" checked={selectedIds.has(c.id)} onChange={() => toggleItem(c.id)}
                          className="size-4 rounded accent-primary" aria-label={`Selecionar ${c.nome}`} />
                      </td>
                      <td className="px-4 py-3 font-medium">{c.nome}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-40 hidden sm:table-cell">{c.descricao ?? "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1 flex-wrap">
                          <Badge variant={st.variant} className="flex items-center gap-1 text-[10px]">{st.icon}{st.label}</Badge>
                          {vencida && <Badge variant="destructive" className="text-[10px]">Vencida</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{prazo}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-2 justify-end">
                          {c.status === "planejado" && (
                            <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleStart(c.id)}>Iniciar</Button>
                          )}
                          <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => router.push(`/admin/inventario/${c.id}`)}>Ver</Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ver mais */}
      {hasMore && (
        <div className="relative flex justify-end">
          <button data-testid="btn-ver-mais" type="button" onClick={() => setShowLimitMenu((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/60 transition-colors">
            <ChevronDown className="size-4" />
            Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute right-0 bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-40">
              {[20, 30].map((n) => (
                <button key={n} data-testid={`btn-limit-${n}`} type="button"
                  onClick={() => { setShowLimitMenu(false); setDisplayLimit(n); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors">
                  Mostrar {n} registros
                </button>
              ))}
            </div>
          )}
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
