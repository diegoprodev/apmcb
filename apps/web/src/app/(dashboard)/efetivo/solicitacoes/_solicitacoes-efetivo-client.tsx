"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, LayoutGrid, Table2, ChevronDown, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import { SolicitacaoStatusCard } from "@/components/ssa/solicitacao-status-card";

type Status = "pendente" | "aprovado" | "rejeitado" | "retirado" | "expirado" | "cancelado";

interface Item {
  material_nome_snapshot: string;
  requested_quantity: number;
}

interface Request {
  id: string;
  status: Status;
  requested_at: string;
  approved_at: string | null;
  expires_at: string | null;
  denial_reason: string | null;
  cancellation_reason: string | null;
  armeiro_nota: string | null;
  items: Item[];
}

const STATUS_LABELS: Record<Status | "todas", string> = {
  todas: "Todas",
  pendente: "Pendentes",
  aprovado: "Aprovadas",
  rejeitado: "Rejeitadas",
  retirado: "Retiradas",
  expirado: "Expiradas",
  cancelado: "Canceladas",
};

const STATUS_BADGE: Record<Status, string> = {
  pendente: "bg-amber-100 text-amber-800 border-amber-200",
  aprovado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejeitado: "bg-red-100 text-red-800 border-red-200",
  retirado: "bg-blue-100 text-blue-800 border-blue-200",
  expirado: "bg-muted text-muted-foreground border-border",
  cancelado: "bg-muted/60 text-muted-foreground border-border",
};

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function SolicitacoesEfetivoClient({
  requests,
  hasMore = false,
  currentLimit = 20,
}: {
  requests: Request[];
  hasMore?: boolean;
  currentLimit?: number;
}) {
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "todas">("todas");
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  const filtered = requests.filter((r) => {
    if (statusFilter !== "todas" && r.status !== statusFilter) return false;
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      return r.items.some((i) => i.material_nome_snapshot.toLowerCase().includes(q));
    }
    return true;
  });

  const filterTabs: (Status | "todas")[] = ["todas", "pendente", "aprovado", "rejeitado", "retirado", "cancelado"];

  return (
    <div className="space-y-4">
      {/* Search + view toggle */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar material..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            data-testid="ssa-search"
            className="w-full rounded-xl border border-border bg-background pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex rounded-xl border border-border overflow-hidden shrink-0">
          <button
            data-testid="btn-view-cards"
            title="Ver em cards"
            onClick={() => setViewMode("cards")}
            className={cn(
              "px-3 py-2 transition-colors",
              viewMode === "cards"
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-primary/10"
            )}
          >
            <LayoutGrid size={15} />
          </button>
          <button
            data-testid="btn-view-table"
            title="Ver em lista"
            onClick={() => setViewMode("table")}
            className={cn(
              "px-3 py-2 border-l border-border transition-colors",
              viewMode === "table"
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:bg-primary/10"
            )}
          >
            <Table2 size={15} />
          </button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 bg-muted rounded-xl p-1 overflow-x-auto">
        {filterTabs.map((s) => {
          const count = s === "todas" ? undefined : requests.filter((r) => r.status === s).length;
          return (
            <button
              key={s}
              data-testid={`tab-${s}`}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "flex-1 min-w-max rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap",
                statusFilter === s
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {STATUS_LABELS[s]}
              {count != null && count > 0 && (
                <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-px">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="rounded-2xl bg-card border border-border p-10 text-center space-y-2"
          style={{ boxShadow: "var(--shadow-card)" }}>
          <Package className="size-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">
            {searchTerm
              ? `Nenhum resultado para "${searchTerm}"`
              : "Nenhuma solicitação nesta categoria."}
          </p>
        </div>
      )}

      {/* Cards mode — reusa SolicitacaoStatusCard */}
      {viewMode === "cards" && (
        <div className="space-y-3" data-testid="ssa-cards">
          {filtered.map((r) => (
            <SolicitacaoStatusCard
              key={r.id}
              id={r.id}
              status={r.status}
              items={r.items}
              requested_at={r.requested_at}
              approved_at={r.approved_at}
              expires_at={r.expires_at}
              denial_reason={r.denial_reason}
              cancellation_reason={r.cancellation_reason}
              armeiro_nota={r.armeiro_nota}
            />
          ))}
        </div>
      )}

      {/* Table mode */}
      {viewMode === "table" && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card"
          style={{ boxShadow: "var(--shadow-card)" }} data-testid="ssa-table">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Materiais</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Data</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Validade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((r) => (
                <tr key={r.id} data-testid="ssa-row" className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 max-w-50">
                    <p className="truncate text-xs font-medium">
                      {r.items.map((i) => `${i.material_nome_snapshot} ×${i.requested_quantity}`).join(", ")}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[10px] font-semibold rounded-full px-2 py-0.5 border", STATUS_BADGE[r.status])}>
                      {STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {fmtDateTime(r.requested_at)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {r.expires_at ? fmtDateTime(r.expires_at) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Ver mais */}
      {hasMore && (
        <div className="flex justify-center relative">
          <button
            data-testid="btn-ver-mais"
            onClick={() => setShowLimitMenu((v) => !v)}
            className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted/60 transition-colors"
          >
            <ChevronDown className="size-4" /> Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute bottom-full mb-1 z-10 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
              {[20, 30].map((n) => (
                <button
                  key={n}
                  data-testid={`btn-limit-${n}`}
                  onClick={() => {
                    setShowLimitMenu(false);
                    router.push(`/efetivo/solicitacoes?limit=${n}`);
                  }}
                  className="block w-full px-5 py-2.5 text-sm text-left hover:bg-muted/50 transition-colors"
                >
                  Mostrar {n} registros
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground/60">
        {filtered.length} de {requests.length} solicitações · limite {currentLimit}
      </p>
    </div>
  );
}
