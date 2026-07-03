"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CheckCircle2, Clock, LayoutGrid, Table2,
  ChevronDown, Search, X,
} from "lucide-react";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { OcorrenciaActions } from "./_actions";
import { cn } from "@/lib/utils";

type Ocorrencia = {
  id: string;
  titulo: string;
  descricao: string | null;
  status: string;
  material_nome_snapshot: string | null;
  created_at: string;
  military: { nome_completo: string; posto: string | null; matricula: string } | null;
};

const STATUS_LABEL: Record<string, string> = {
  aberta: "Aberta",
  em_analise: "Em análise",
  resolvida: "Resolvida",
  improcedente: "Improcedente",
};

const STATUS_COLOR: Record<string, string> = {
  aberta: "text-amber-700 bg-amber-50 border-amber-200",
  em_analise: "text-blue-700 bg-blue-50 border-blue-200",
  resolvida: "text-emerald-700 bg-emerald-50 border-emerald-200",
  improcedente: "text-gray-600 bg-gray-50 border-gray-200",
};

interface Props {
  ocorrencias: Ocorrencia[];
  hasMore: boolean;
  currentLimit: number;
}

export function OcorrenciasClient({ ocorrencias, hasMore, currentLimit }: Props) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showLimitMenu, setShowLimitMenu] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return ocorrencias;
    return ocorrencias.filter(
      (o) =>
        o.titulo.toLowerCase().includes(q) ||
        (o.descricao ?? "").toLowerCase().includes(q) ||
        (o.military?.nome_completo ?? "").toLowerCase().includes(q) ||
        (o.material_nome_snapshot ?? "").toLowerCase().includes(q)
    );
  }, [ocorrencias, search]);

  const someSelected = selectedIds.size > 0;
  const allSel = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));
  const someSel = filtered.some((o) => selectedIds.has(o.id));

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
      if (allSel) filtered.forEach((o) => next.delete(o.id));
      else filtered.forEach((o) => next.add(o.id));
      return next;
    });
  }

  if (ocorrencias.length === 0) {
    return (
      <div className="rounded-2xl bg-card p-12 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
        <CheckCircle2 className="size-10 text-emerald-500/60 mx-auto mb-3" />
        <p className="text-sm font-medium">Nenhuma ocorrência aberta</p>
        <p className="text-xs text-muted-foreground mt-1">Tudo em ordem por aqui.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar ocorrência, militar ou material..."
            className="w-full rounded-xl border border-input bg-card pl-9 pr-9 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
          />
          {search && (
            <button type="button" onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <GridPdfButton
            printTargetId="ocorrencias-print"
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
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-card p-10 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <p className="text-sm font-medium text-muted-foreground">Nenhuma ocorrência encontrada</p>
        </div>
      ) : viewMode === "cards" ? (
        <div id="ocorrencias-print" className="space-y-3">
          {filtered.map((occ) => (
            <div
              key={occ.id}
              data-testid="ocorrencia-card"
              className={cn(
                "rounded-2xl bg-card p-5 space-y-3 transition-all",
                selectedIds.has(occ.id) && "ring-2 ring-primary"
              )}
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedIds.has(occ.id)}
                  onChange={() => toggleItem(occ.id)}
                  className="size-4 rounded accent-primary mt-1 shrink-0"
                  aria-label={`Selecionar ${occ.titulo}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full border px-2.5 py-0.5 ${STATUS_COLOR[occ.status]}`}>
                          {occ.status === "aberta" && <AlertTriangle className="size-3" />}
                          {occ.status === "em_analise" && <Clock className="size-3" />}
                          {STATUS_LABEL[occ.status] ?? occ.status}
                        </span>
                        {occ.material_nome_snapshot && (
                          <span className="text-xs text-muted-foreground">{occ.material_nome_snapshot}</span>
                        )}
                      </div>
                      <p className="font-semibold text-sm mt-1.5">{occ.titulo}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{occ.descricao}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium text-foreground">
                        {occ.military?.posto} {occ.military?.nome_completo ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">{occ.military?.matricula ?? "—"}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {new Date(occ.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                  </div>
                  <OcorrenciaActions id={occ.id} status={occ.status} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div id="ocorrencias-print" className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
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
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Título</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground hidden sm:table-cell">Material</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Militar</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((occ) => (
                  <tr key={occ.id} className={cn("hover:bg-muted/20 transition-colors", selectedIds.has(occ.id) && "bg-primary/5")}>
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(occ.id)}
                        onChange={() => toggleItem(occ.id)}
                        className="size-4 rounded accent-primary"
                        aria-label={`Selecionar ${occ.titulo}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium truncate max-w-48">{occ.titulo}</p>
                      {occ.descricao && <p className="text-xs text-muted-foreground truncate max-w-48">{occ.descricao}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden sm:table-cell">
                      {occ.material_nome_snapshot ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium">{occ.military?.posto} {occ.military?.nome_completo ?? "—"}</p>
                      <p className="text-xs text-muted-foreground font-mono">{occ.military?.matricula ?? "—"}</p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-semibold rounded-full border px-2.5 py-0.5 ${STATUS_COLOR[occ.status]}`}>
                        {occ.status === "aberta" && <AlertTriangle className="size-3" />}
                        {occ.status === "em_analise" && <Clock className="size-3" />}
                        {STATUS_LABEL[occ.status] ?? occ.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(occ.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <OcorrenciaActions id={occ.id} status={occ.status} />
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
          <button
            data-testid="btn-ver-mais"
            type="button"
            onClick={() => setShowLimitMenu((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/60 transition-colors"
          >
            <ChevronDown className="size-4" />
            Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute right-0 bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-md overflow-hidden min-w-40">
              {[20, 30].map((n) => (
                <button
                  key={n}
                  data-testid={`btn-limit-${n}`}
                  type="button"
                  onClick={() => { setShowLimitMenu(false); router.push(`/reserva/ocorrencias?limit=${n}`); }}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-muted/60 transition-colors"
                >
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
