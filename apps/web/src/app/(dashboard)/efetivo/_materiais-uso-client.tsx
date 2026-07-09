"use client";

import { useState, useCallback, Fragment } from "react";
import { Search, LayoutGrid, Table2, FileDown, Loader2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export interface ActiveLending {
  id: string;
  issued_at: string;
  quantidade: number;
  local: string | null;
  movement_id: string | null;
  material_nome: string;
  material_categoria: string;
  reserve_nome: string | null;
  master_nome: string | null;
}

interface MateriaisGroup {
  key: string;
  issued_at: string;
  reserve_nome: string | null;
  master_nome: string | null;
  items: ActiveLending[];
}

function groupByMovement(lendings: ActiveLending[]): MateriaisGroup[] {
  const map = new Map<string, MateriaisGroup>();
  for (const l of lendings) {
    const key = l.movement_id ?? l.issued_at ?? l.id;
    if (!map.has(key)) {
      map.set(key, { key, issued_at: l.issued_at, reserve_nome: l.reserve_nome, master_nome: l.master_nome, items: [] });
    }
    map.get(key)!.items.push(l);
  }
  return [...map.values()];
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  return dt.toLocaleDateString("pt-BR") + " · " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function MateriaisUsoClient({ activeLendings }: { activeLendings: ActiveLending[] }) {
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const groups = groupByMovement(activeLendings);

  const filtered = groups.filter((g) => {
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return g.items.some(
      (i) => i.material_nome.toLowerCase().includes(q) || i.material_categoria.toLowerCase().includes(q)
    );
  });

  const allFilteredIds = filtered.flatMap((g) => g.items.map((i) => i.id));
  const someSelected = selectedIds.size > 0;
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every((id) => selectedIds.has(id));

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((ids: string[]) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allIn = ids.every((id) => next.has(id));
      ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      allSelected ? new Set() : new Set(allFilteredIds)
    );
  }, [allSelected, allFilteredIds]);

  async function exportPdf() {
    if (!someSelected) return;
    setExporting(true);
    try {
      const ids = [...selectedIds].join(",");
      const res = await fetch(`${BFF_URL}/api/usuario/historico/pdf?ids=${encodeURIComponent(ids)}`, {
        headers: csrfHeaders(),
        credentials: "include",
      });
      if (!res.ok) {
        toast.error("Falha ao exportar PDF");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `materiais-uso-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const totalMateriais = filtered.reduce((n, g) => n + g.items.length, 0);

  return (
    <div data-testid="materiais-uso-ready" className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-44">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <input
            data-testid="input-busca-materiais"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por material..."
            className="w-full rounded-lg border border-border bg-white pl-8 pr-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
          />
        </div>

        <Button
          variant={someSelected ? "default" : "outline"}
          size="sm"
          disabled={!someSelected || exporting}
          onClick={exportPdf}
          data-testid="btn-exportar-materiais-pdf"
        >
          {exporting ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileDown className="size-3.5" />
          )}
          {someSelected ? `Exportar PDF (${selectedIds.size})` : "Exportar PDF"}
        </Button>

        <div className="flex gap-1">
          <Button
            variant={viewMode === "cards" ? "default" : "outline"}
            size="icon-sm"
            onClick={() => setViewMode("cards")}
            data-testid="btn-view-cards"
            title="Ver em cards"
          >
            <LayoutGrid className="size-3.5" />
          </Button>
          <Button
            variant={viewMode === "table" ? "default" : "outline"}
            size="icon-sm"
            onClick={() => setViewMode("table")}
            data-testid="btn-view-table"
            title="Ver em tabela"
          >
            <Table2 className="size-3.5" />
          </Button>
        </div>

        {totalMateriais > 0 && (
          <span className="text-xs text-muted-foreground">{totalMateriais} {totalMateriais === 1 ? "material" : "materiais"}</span>
        )}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="rounded-2xl bg-card p-8 text-center" style={{ boxShadow: "var(--shadow-card)" }}>
          <Package className="size-8 mx-auto mb-2 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {searchTerm ? "Nenhum material encontrado para a busca." : "Nenhum material em uso no momento."}
          </p>
        </div>
      )}

      {/* Card view */}
      {viewMode === "cards" && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((g) => {
            const groupIds = g.items.map((i) => i.id);
            const groupSelected = groupIds.every((id) => selectedIds.has(id));
            return (
              <div
                key={g.key}
                data-testid="materiais-uso-group"
                className="rounded-2xl bg-card p-4 space-y-2"
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                {/* Group header */}
                <div className="flex items-start gap-3 pb-2 border-b border-border/60">
                  <input
                    type="checkbox"
                    data-testid={`checkbox-group-${g.key}`}
                    checked={groupSelected}
                    onChange={() => toggleGroup(groupIds)}
                    className="mt-0.5 size-4 rounded accent-primary cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-muted-foreground">{formatDateTime(g.issued_at)}</p>
                    {g.reserve_nome && (
                      <p data-testid="group-reserva" className="text-xs font-semibold text-foreground truncate">
                        {g.reserve_nome}
                      </p>
                    )}
                    {g.master_nome && (
                      <p data-testid="group-armeiro" className="text-xs text-muted-foreground">
                        Armeiro: {g.master_nome}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    Ativo
                  </span>
                </div>

                {/* Items */}
                {g.items.map((item) => (
                  <div
                    key={item.id}
                    data-testid="materiais-uso-item"
                    onClick={() => toggleRow(item.id)}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-2.5 py-2 cursor-pointer transition-colors hover:bg-muted/40",
                      selectedIds.has(item.id) && "bg-primary/5 ring-1 ring-primary/30"
                    )}
                  >
                    <input
                      type="checkbox"
                      data-testid={`checkbox-item-${item.id}`}
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleRow(item.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.material_nome}</p>
                      <p className="text-xs text-muted-foreground">{item.material_categoria}</p>
                    </div>
                    <span className="text-xs font-mono text-muted-foreground shrink-0">×{item.quantidade}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {/* Table view — grouped by movement (same as cards) */}
      {viewMode === "table" && filtered.length > 0 && (
        <div className="rounded-2xl bg-card overflow-hidden" style={{ boxShadow: "var(--shadow-card)" }}>
          <div className="overflow-x-auto">
            <table data-testid="materiais-uso-table" className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="px-4 py-2.5 text-left w-8">
                    <input
                      type="checkbox"
                      data-testid="checkbox-select-all-materiais"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="size-4 rounded accent-primary cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Material</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider hidden sm:table-cell">Categoria</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">Armeiro</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider hidden md:table-cell">Reserva</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Data Saída</th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Qtd</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((g) => {
                  const groupIds = g.items.map((i) => i.id);
                  const groupSelected = groupIds.every((id) => selectedIds.has(id));
                  return (
                    <Fragment key={g.key}>
                      {/* Group separator row */}
                      <tr
                        data-testid="materiais-uso-group"
                        className="bg-muted/20 border-t border-border"
                      >
                        <td className="px-4 py-1.5">
                          <input
                            type="checkbox"
                            data-testid={`checkbox-group-${g.key}`}
                            checked={groupSelected}
                            onChange={() => toggleGroup(groupIds)}
                            className="size-4 rounded accent-primary cursor-pointer"
                          />
                        </td>
                        <td colSpan={6} className="px-2 py-1.5">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                            <span>{formatDateTime(g.issued_at)}</span>
                            {g.reserve_nome && (
                              <span data-testid="group-reserva" className="font-semibold text-foreground">
                                {g.reserve_nome}
                              </span>
                            )}
                            {g.master_nome && (
                              <span data-testid="group-armeiro">
                                Armeiro: {g.master_nome}
                              </span>
                            )}
                            <span className="ml-auto inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0 text-[10px] font-semibold text-amber-700">
                              Ativo
                            </span>
                          </div>
                        </td>
                      </tr>
                      {/* Item rows */}
                      {g.items.map((item) => (
                        <tr
                          key={item.id}
                          data-testid="materiais-uso-item"
                          onClick={() => toggleRow(item.id)}
                          className={cn(
                            "border-t border-border/40 cursor-pointer transition-colors hover:bg-muted/30",
                            selectedIds.has(item.id) && "bg-primary/5"
                          )}
                        >
                          <td className="px-4 py-2.5 pl-8">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => toggleRow(item.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="size-4 rounded accent-primary cursor-pointer"
                            />
                          </td>
                          <td className="px-4 py-2.5 font-medium">{item.material_nome}</td>
                          <td className="px-4 py-2.5 text-muted-foreground hidden sm:table-cell">{item.material_categoria}</td>
                          <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{g.master_nome ?? "—"}</td>
                          <td className="px-4 py-2.5 text-muted-foreground hidden md:table-cell">{g.reserve_nome ?? "—"}</td>
                          <td className="px-4 py-2.5 text-muted-foreground text-xs">{formatDateTime(g.issued_at)}</td>
                          <td className="px-4 py-2.5 text-right font-mono">×{item.quantidade}</td>
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
