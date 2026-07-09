"use client";

import { useState, useMemo } from "react";
import { csrfHeaders } from "@/lib/csrf";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { toast } from "sonner";
import {
  Package2, Clock, FileText, AlertCircle, LayoutGrid, Table2, ChevronDown,
  Search, X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

export interface Cautela {
  id: string;
  status: string;
  motivo_emissao: string;
  condicao_emissao: string;
  data_emissao: string;
  prazo_proxima_conferencia?: string | null;
  armeiro_signature_id?: string | null;
  militar_signature_id?: string | null;
  item: {
    id: string;
    numero_serie?: string | null;
    material_type: { nome: string; categoria: string };
  };
  armeiro: { nome_completo: string; matricula: string };
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  ativa:       { label: "Ativa",       color: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  devolvida:   { label: "Devolvida",   color: "bg-gray-500/10 text-gray-500 border-gray-500/30" },
  substituida: { label: "Substituída", color: "bg-blue-500/10 text-blue-600 border-blue-500/30" },
  em_revisao:  { label: "Em revisão",  color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30" },
  cancelada:   { label: "Cancelada",   color: "bg-red-500/10 text-red-600 border-red-500/30" },
};

interface Props {
  initialCautelas: Cautela[];
  hasMore: boolean;
  currentLimit: number;
}

export function MinhasCautelasClient({ initialCautelas, hasMore, currentLimit }: Props) {
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showLimitMenu, setShowLimitMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("todos");

  const filtered = useMemo(() => {
    let result = initialCautelas;
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((c) =>
      c.item.material_type.nome.toLowerCase().includes(q) ||
      c.item.material_type.categoria.toLowerCase().includes(q) ||
      c.armeiro.nome_completo.toLowerCase().includes(q)
    );
    if (statusFilter !== "todos") result = result.filter((c) => c.status === statusFilter);
    return result;
  }, [initialCautelas, search, statusFilter]);

  const someSelected = selectedIds.size > 0;
  const allSel = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
  const someSel = filtered.some((c) => selectedIds.has(c.id));

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
      if (allSel) filtered.forEach((c) => next.delete(c.id));
      else filtered.forEach((c) => next.add(c.id));
      return next;
    });
  }

  async function downloadPdf(id: string) {
    const res = await fetch(`${BFF_URL}/api/cautelamentos/${id}/pdf`, {
      credentials: "include",
      headers: csrfHeaders(),
    });
    if (!res.ok) { toast.error("Erro ao gerar PDF"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cautela-${id.slice(0, 8)}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (initialCautelas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
        <Package2 className="size-10 opacity-30" />
        <p className="text-sm">Você não possui cautelas ativas</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
          <div className="relative flex-1 w-full sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por material..."
              className="w-full rounded-xl border border-border bg-white dark:bg-card pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {search && (
              <button type="button" onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <GridPdfButton
              printTargetId="cautelas-print"
              label="Exportar"
              disabled={!someSelected}
              selectedCount={selectedIds.size}
            />
            <div className="flex rounded-xl border border-border overflow-hidden">
              <button type="button" onClick={() => setViewMode("cards")} title="Ver em cards"
                className={cn("px-3 py-2 transition-colors", viewMode === "cards" ? "bg-primary text-primary-foreground" : "bg-white dark:bg-card text-muted-foreground hover:bg-primary/10")}>
                <LayoutGrid className="size-4" />
              </button>
              <button type="button" onClick={() => setViewMode("table")} title="Ver em grade"
                className={cn("px-3 py-2 transition-colors", viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-white dark:bg-card text-muted-foreground hover:bg-primary/10")}>
                <Table2 className="size-4" />
              </button>
            </div>
          </div>
        </div>
        {/* Status tabs */}
        <div className="flex items-center gap-1 flex-wrap">
          {(["todos", "ativa", "devolvida", "em_revisao", "substituida"] as const).map((s) => {
            const labels: Record<string, string> = { todos: "Todas", ativa: "Ativas", devolvida: "Devolvidas", em_revisao: "Em revisão", substituida: "Substituídas" };
            return (
              <button key={s} type="button" onClick={() => setStatusFilter(s)}
                className={cn("text-xs px-3 py-1.5 rounded-full border font-medium transition-colors",
                  statusFilter === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-white dark:bg-card text-muted-foreground hover:bg-primary/10 hover:border-primary/40")}>
                {labels[s]}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
          <Package2 className="size-8 opacity-30" />
          <p className="text-sm">{search ? `Nenhum resultado para "${search}"` : "Nenhuma cautela com este status"}</p>
        </div>
      )}

      {viewMode === "cards" ? (
        <div id="cautelas-print" className="space-y-3">
          {filtered.map((c) => (
            <div
              key={c.id}
              data-testid="cautela-card"
              className={cn(
                "rounded-xl border border-border bg-card p-4 space-y-3 transition-all",
                selectedIds.has(c.id) && "ring-2 ring-primary"
              )}
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(c.id)}
                  onChange={() => toggleItem(c.id)}
                  className="size-4 rounded accent-primary mt-1 shrink-0"
                  aria-label={`Selecionar ${c.item.material_type.nome}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-foreground truncate">
                          {c.item.material_type.nome}
                        </span>
                        {c.item.numero_serie && (
                          <span className="text-xs text-muted-foreground font-mono">
                            #{c.item.numero_serie}
                          </span>
                        )}
                        <Badge variant="outline" className={`text-[10px] font-medium ${STATUS_CONFIG[c.status]?.color ?? ""}`}>
                          {STATUS_CONFIG[c.status]?.label ?? c.status}
                        </Badge>
                        {!c.armeiro_signature_id && (
                          <Badge variant="outline" className="text-[10px] bg-yellow-500/10 text-yellow-600 border-yellow-500/30">
                            Aguard. assinatura armeiro
                          </Badge>
                        )}
                        {c.armeiro_signature_id && !c.militar_signature_id && (
                          <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-600 border-orange-500/30">
                            Aguard. sua assinatura
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 truncate">{c.motivo_emissao}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => downloadPdf(c.id)} className="h-7 px-2 text-xs gap-1 shrink-0">
                      <FileText className="size-3.5" />
                      PDF
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="size-3.5 shrink-0" />
                      <span suppressHydrationWarning>Desde {new Date(c.data_emissao).toLocaleDateString("pt-BR")}</span>
                    </div>
                    <div className="text-muted-foreground truncate">
                      Emitido por: {c.armeiro.nome_completo}
                    </div>
                    {c.prazo_proxima_conferencia && (
                      <div className="flex items-center gap-1.5 text-yellow-600 col-span-2">
                        <AlertCircle className="size-3.5 shrink-0" />
                        <span suppressHydrationWarning>
                          Conferência em:{" "}
                          {new Date(c.prazo_proxima_conferencia).toLocaleDateString("pt-BR")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div id="cautelas-print" className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
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
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Material</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell">Emitido por</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((c) => (
                  <tr key={c.id} className={cn("hover:bg-muted/20 transition-colors", selectedIds.has(c.id) && "bg-primary/5")}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(c.id)}
                        onChange={() => toggleItem(c.id)}
                        className="size-4 rounded accent-primary"
                        aria-label={`Selecionar ${c.item.material_type.nome}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.item.material_type.nome}</p>
                      {c.item.numero_serie && (
                        <p className="text-xs text-muted-foreground font-mono">#{c.item.numero_serie}</p>
                      )}
                      <p className="text-xs text-muted-foreground truncate max-w-40">{c.motivo_emissao}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className={`text-[10px] font-medium ${STATUS_CONFIG[c.status]?.color ?? ""}`}>
                        {STATUS_CONFIG[c.status]?.label ?? c.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                      {c.armeiro.nome_completo}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap" suppressHydrationWarning>
                      {new Date(c.data_emissao).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="ghost" onClick={() => downloadPdf(c.id)} className="h-7 px-2 text-xs gap-1">
                        <FileText className="size-3.5" />
                        PDF
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Ver mais */}
      {hasMore && (
        <div className="relative flex justify-end">
          <button data-testid="btn-ver-mais" type="button" onClick={() => setShowLimitMenu((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-border bg-white dark:bg-card px-4 py-2 text-sm font-medium hover:bg-primary/10 hover:border-primary/40 transition-colors">
            <ChevronDown className="size-4" />
            Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute right-0 bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-40">
              {[20, 30].map((n) => (
                <button key={n} data-testid={`btn-limit-${n}`} type="button"
                  onClick={() => {
                    setShowLimitMenu(false);
                    window.location.href = `/efetivo/minhas-cautelas?limit=${n}`;
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-primary/10 transition-colors">
                  Mostrar {n} registros
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
