"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Package, Clock, AlertCircle,
  User, Shield, ChevronDown, ChevronUp, Loader2,
  LayoutGrid, Table2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { csrfHeaders } from "@/lib/csrf";
import { createClient } from "@/lib/supabase/client";

async function bffHeaders(contentType?: string): Promise<HeadersInit> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    ...csrfHeaders(),
  };
}

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

type Status = "pendente" | "aprovado" | "rejeitado" | "retirado" | "expirado" | "cancelado";

interface Item {
  id: string;
  material_nome_snapshot: string;
  material_categoria_snapshot: string;
  requested_quantity: number;
  delivered_quantity: number | null;
}

interface Military {
  id: string;
  nome_completo: string;
  posto: string;
  matricula: string;
  foto_url?: string;
}

interface Request {
  id: string;
  status: Status;
  notes: string | null;
  denial_reason: string | null;
  armeiro_nota: string | null;
  cancellation_reason: string | null;
  remote_reason: string | null;
  is_external_request: boolean;
  totp_validated: boolean;
  requested_at: string;
  approved_at: string | null;
  rejected_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  expires_at: string | null;
  military: Military | null;
  reserva: { nome_completo: string } | null;
  items: Item[];
}

interface CardAction {
  action: "aprovar" | "rejeitar" | null;
  nota: string;
  reason: string;
}

const STATUS_LABELS: Record<Status, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  retirado: "Retirado",
  expirado: "Expirado",
  cancelado: "Cancelado",
};

const STATUS_BADGE: Record<Status, string> = {
  pendente: "bg-amber-100 text-amber-800 border-amber-200",
  aprovado: "bg-emerald-100 text-emerald-800 border-emerald-200",
  rejeitado: "bg-red-100 text-red-800 border-red-200",
  retirado: "bg-blue-100 text-blue-800 border-blue-200",
  expirado: "bg-muted text-muted-foreground border-border",
  cancelado: "bg-muted/60 text-muted-foreground border-border",
};

const STATUS_BORDER: Record<Status, string> = {
  pendente: "border-amber-200",
  aprovado: "border-emerald-200",
  rejeitado: "border-border",
  retirado: "border-blue-200",
  expirado: "border-border",
  cancelado: "border-border",
};

type Tab = "pendentes" | "aprovadas" | "hoje" | "historico";

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function SolicitacoesClient({
  initialRequests,
  hasMore = false,
  currentLimit = 20,
}: {
  initialRequests: Request[];
  hasMore?: boolean;
  currentLimit?: number;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [requests, setRequests] = useState<Request[]>(initialRequests);
  // Sync quando router.refresh() traz novos dados do servidor (ex: evento realtime)
  useEffect(() => { setRequests(initialRequests); }, [initialRequests]);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const t = searchParams.get("tab") as Tab | null;
    return t && ["pendentes", "aprovadas", "hoje", "historico"].includes(t) ? t : "pendentes";
  });
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cardActions, setCardActions] = useState<Record<string, CardAction>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  const todayStr = new Date().toISOString().split("T")[0];

  const filtered = requests.filter((r) => {
    if (activeTab === "pendentes") return r.status === "pendente";
    if (activeTab === "aprovadas") return r.status === "aprovado";
    if (activeTab === "hoje") return (r.requested_at ?? "").startsWith(todayStr);
    return true;
  });

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function updateRequest(id: string, patch: Partial<Request>) {
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function getCardAction(id: string): CardAction {
    return cardActions[id] ?? { action: null, nota: "", reason: "" };
  }

  function patchCardAction(id: string, patch: Partial<CardAction>) {
    const defaults: CardAction = { action: null, nota: "", reason: "" };
    setCardActions((prev) => ({
      ...prev,
      [id]: { ...defaults, ...prev[id], ...patch },
    }));
  }

  function clearCardAction(id: string) {
    setCardActions((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }

  async function deliver(id: string) {
    setLoadingId(id);
    try {
      const res = await fetch(`${BFF_URL}/api/ssa/requests/${id}/deliver`, {
        method: "PATCH", credentials: "include", headers: await bffHeaders(),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error ?? "Erro ao confirmar entrega."); return; }
      updateRequest(id, { status: "retirado", delivered_at: new Date().toISOString() });
      toast.success("Entrega confirmada! Registro criado.");
    } catch { toast.error("Sem conexão com o servidor."); }
    finally { setLoadingId(null); }
  }

  async function submitAction(id: string) {
    const ca = getCardAction(id);
    if (!ca.action) return;
    if (ca.action === "rejeitar" && ca.reason.trim().length < 5) {
      toast.error("Informe o motivo da rejeição (mínimo 5 caracteres).");
      return;
    }
    setLoadingId(id);
    try {
      if (ca.action === "aprovar") {
        const reqBody: Record<string, string> = {};
        if (ca.nota.trim()) reqBody.nota = ca.nota.trim();
        const res = await fetch(`${BFF_URL}/api/ssa/requests/${id}/approve`, {
          method: "PATCH", credentials: "include",
          headers: await bffHeaders("application/json"),
          body: JSON.stringify(reqBody),
        });
        const data = await res.json() as { expires_at?: string; error?: string };
        if (!res.ok) { toast.error(data.error ?? "Erro ao aprovar."); return; }
        updateRequest(id, {
          status: "aprovado", approved_at: new Date().toISOString(),
          expires_at: data.expires_at ?? null, armeiro_nota: ca.nota.trim() || null,
        });
        toast.success("Solicitação aprovada! Usuário notificado.");
      } else {
        const res = await fetch(`${BFF_URL}/api/ssa/requests/${id}/reject`, {
          method: "PATCH", credentials: "include",
          headers: await bffHeaders("application/json"),
          body: JSON.stringify({ reason: ca.reason.trim() }),
        });
        const data = await res.json() as { error?: string };
        if (!res.ok) { toast.error(data.error ?? "Erro ao rejeitar."); return; }
        updateRequest(id, {
          status: "rejeitado", denial_reason: ca.reason.trim(),
          rejected_at: new Date().toISOString(),
        });
        toast.success("Solicitação rejeitada. Usuário notificado.");
      }
      clearCardAction(id);
      setExpanded((prev) => { const n = new Set(prev); n.delete(id); return n; });
    } catch { toast.error("Sem conexão com o servidor."); }
    finally { setLoadingId(null); }
  }

  function handleTabChange(tab: Tab) {
    setActiveTab(tab);
    router.replace(`?tab=${tab}`, { scroll: false });
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "pendentes", label: "Pendentes" },
    { id: "aprovadas", label: "Aprovadas" },
    { id: "hoje", label: "Hoje" },
    { id: "historico", label: "Histórico" },
  ];

  return (
    <div className="space-y-4">
      {/* Header: tabs + view toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 bg-muted rounded-xl p-1 flex-1 overflow-x-auto">
          {tabs.map((t) => {
            const count =
              t.id === "pendentes" ? requests.filter((r) => r.status === "pendente").length
              : t.id === "aprovadas" ? requests.filter((r) => r.status === "aprovado").length
              : undefined;
            return (
              <button
                key={t.id}
                data-testid={`tab-${t.id}`}
                onClick={() => handleTabChange(t.id)}
                className={cn(
                  "flex-1 min-w-max rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                  activeTab === t.id
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t.label}
                {count != null && count > 0 && (
                  <span className="ml-1.5 bg-amber-500 text-white text-[10px] font-bold rounded-full px-1.5 py-px">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
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

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="rounded-2xl bg-card p-10 text-center text-muted-foreground text-sm"
          style={{ boxShadow: "var(--shadow-card)" }}>
          Nenhuma solicitação {activeTab === "pendentes" ? "pendente" : "nesta categoria"}.
        </div>
      )}

      {/* Cards mode */}
      {viewMode === "cards" && (
        <div className="space-y-3" data-testid="ssa-cards">
          {filtered.map((r) => {
            const isExpanded = expanded.has(r.id);
            const isLoading = loadingId === r.id;
            const isExpired = r.expires_at ? new Date(r.expires_at) < new Date() : false;
            const ca = getCardAction(r.id);

            return (
              <div
                key={r.id}
                data-testid="ssa-row"
                className={cn(
                  "rounded-2xl bg-card overflow-hidden transition-all border",
                  STATUS_BORDER[r.status]
                )}
                style={{ boxShadow: "var(--shadow-card)" }}
              >
                <button
                  className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => toggleExpand(r.id)}
                >
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <User className="size-4" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold truncate">
                        {r.military?.posto} {r.military?.nome_completo}
                      </p>
                      <span
                        data-testid="status-badge"
                        className={cn("shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 border", STATUS_BADGE[r.status])}
                      >
                        {STATUS_LABELS[r.status]}
                      </span>
                      {r.is_external_request && (
                        <span className="shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200">
                          Externa
                        </span>
                      )}
                      {r.totp_validated && (
                        <Shield className="size-3 text-emerald-600 shrink-0" aria-label="TOTP validado" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {r.items.map((i) => `${i.material_nome_snapshot} ×${i.requested_quantity}`).join(", ")}
                    </p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {fmtDateTime(r.requested_at)}
                      {r.status === "aprovado" && r.expires_at && (
                        <span className={cn("ml-2 font-medium", isExpired ? "text-red-600" : "text-emerald-600")}>
                          {isExpired ? "⚠ Expirado" : `· Expira às ${new Date(r.expires_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                        </span>
                      )}
                    </p>
                  </div>

                  {isExpanded
                    ? <ChevronUp className="size-4 text-muted-foreground shrink-0" />
                    : <ChevronDown className="size-4 text-muted-foreground shrink-0" />
                  }
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Matrícula</p>
                        <p className="font-mono font-medium">{r.military?.matricula}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Identidade TOTP</p>
                        <p className={r.totp_validated ? "text-emerald-700 font-medium" : "text-red-600"}>
                          {r.totp_validated ? "✓ Validado" : "✗ Não validado"}
                        </p>
                      </div>
                    </div>

                    {/* Materials section */}
                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="section-materiais">
                        Materiais Solicitados
                      </p>
                      {r.items.map((item) => (
                        <div key={item.id} className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{item.material_nome_snapshot}</p>
                            <p className="text-[10px] text-muted-foreground" data-testid="material-categoria">{item.material_categoria_snapshot}</p>
                          </div>
                          <span className="font-mono text-xs font-bold ml-2 shrink-0">×{item.requested_quantity}</span>
                        </div>
                      ))}
                    </div>

                    {r.is_external_request && r.remote_reason && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs text-amber-800">
                        <span className="font-semibold">Motivo da solicitação externa: </span>{r.remote_reason}
                      </div>
                    )}

                    {r.notes && (
                      <div className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Observação: </span>{r.notes}
                      </div>
                    )}

                    {r.denial_reason && (
                      <div className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-1.5 text-xs text-red-700">
                        <span className="font-medium">Motivo da rejeição: </span>{r.denial_reason}
                      </div>
                    )}

                    {r.cancellation_reason && (
                      <div className="rounded-lg bg-muted/40 border border-border px-2.5 py-1.5 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Motivo do cancelamento: </span>{r.cancellation_reason}
                      </div>
                    )}

                    {r.armeiro_nota && (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-2.5 py-1.5 text-xs text-emerald-800">
                        <span className="font-medium">Mensagem do armeiro: </span>{r.armeiro_nota}
                      </div>
                    )}

                    {/* Inline action: select dropdown + conditional fields */}
                    {r.status === "pendente" && (
                      <div className="space-y-2 pt-1 border-t border-border/60">
                        <select
                          data-testid="select-acao"
                          value={ca.action ?? ""}
                          onChange={(e) => patchCardAction(r.id, { action: (e.target.value as CardAction["action"]) || null })}
                          className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">Selecionar ação...</option>
                          <option value="aprovar">✓ Aprovar solicitação</option>
                          <option value="rejeitar">✗ Rejeitar solicitação</option>
                        </select>

                        {ca.action === "aprovar" && (
                          <textarea
                            placeholder="Mensagem para o usuário (opcional)"
                            value={ca.nota}
                            onChange={(e) => patchCardAction(r.id, { nota: e.target.value })}
                            rows={2}
                            maxLength={500}
                            data-testid="textarea-nota-aprovacao"
                            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                          />
                        )}

                        {ca.action === "rejeitar" && (
                          <input
                            type="text"
                            placeholder="Motivo da rejeição *"
                            value={ca.reason}
                            onChange={(e) => patchCardAction(r.id, { reason: e.target.value })}
                            maxLength={300}
                            data-testid="input-motivo-rejeicao"
                            className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        )}

                        {ca.action && (
                          <Button
                            size="sm"
                            className={cn(
                              "w-full",
                              ca.action === "aprovar"
                                ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                : "bg-red-600 hover:bg-red-700 text-white"
                            )}
                            disabled={isLoading || (ca.action === "rejeitar" && ca.reason.trim().length < 5)}
                            onClick={() => submitAction(r.id)}
                            data-testid="btn-confirmar-acao"
                          >
                            {isLoading
                              ? <Loader2 className="size-4 animate-spin" />
                              : ca.action === "aprovar" ? "Confirmar aprovação" : "Confirmar rejeição"
                            }
                          </Button>
                        )}
                      </div>
                    )}

                    {r.status === "aprovado" && !isExpired && (
                      <Button
                        className="w-full" size="sm" disabled={isLoading}
                        onClick={() => deliver(r.id)}
                        data-testid="btn-confirmar-retirada"
                      >
                        {isLoading
                          ? <Loader2 className="size-4 animate-spin" />
                          : <><Package className="size-4 mr-1.5" /> Confirmar Retirada</>
                        }
                      </Button>
                    )}

                    {r.status === "aprovado" && isExpired && (
                      <div className="rounded-lg bg-red-50 border border-red-100 px-2.5 py-1.5 text-xs text-red-700 flex gap-2">
                        <AlertCircle className="size-4 shrink-0" />
                        Prazo de 6h expirado. A solicitação será automaticamente cancelada.
                      </div>
                    )}

                    {r.status === "retirado" && (
                      <div className="rounded-lg bg-blue-50 border border-blue-100 px-2.5 py-1.5 text-xs text-blue-700 flex gap-2">
                        <Clock className="size-4 shrink-0" />
                        Retirado em {r.delivered_at ? fmtDateTime(r.delivered_at) : "—"}
                        {r.reserva ? ` — ${r.reserva.nome_completo}` : ""}
                      </div>
                    )}

                    <p className="text-[10px] text-muted-foreground/50 font-mono text-right">
                      #{r.id.slice(0, 8).toUpperCase()}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Table mode */}
      {viewMode === "table" && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card" style={{ boxShadow: "var(--shadow-card)" }} data-testid="ssa-table">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Militar</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Materiais</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Data</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filtered.map((r) => {
                const isLoading = loadingId === r.id;
                const ca = getCardAction(r.id);
                return (
                  <tr key={r.id} data-testid="ssa-row" className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.military?.nome_completo}</p>
                      <p className="text-xs text-muted-foreground font-mono">{r.military?.matricula}</p>
                    </td>
                    <td className="px-4 py-3 max-w-50">
                      <p className="truncate text-xs">
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
                    <td className="px-4 py-3">
                      {r.status === "pendente" && (
                        <div className="flex items-center gap-1.5 min-w-50">
                          <select
                            value={ca.action ?? ""}
                            onChange={(e) => patchCardAction(r.id, { action: (e.target.value as CardAction["action"]) || null })}
                            className="rounded-lg border border-border bg-background px-2 py-1 text-xs"
                          >
                            <option value="">Ação...</option>
                            <option value="aprovar">Aprovar</option>
                            <option value="rejeitar">Rejeitar</option>
                          </select>
                          {ca.action === "rejeitar" && (
                            <input
                              type="text"
                              placeholder="Motivo *"
                              value={ca.reason}
                              onChange={(e) => patchCardAction(r.id, { reason: e.target.value })}
                              className="rounded-lg border border-border bg-background px-2 py-1 text-xs w-32"
                            />
                          )}
                          {ca.action && (
                            <button
                              disabled={isLoading || (ca.action === "rejeitar" && ca.reason.trim().length < 5)}
                              onClick={() => submitAction(r.id)}
                              className="rounded-lg bg-primary text-primary-foreground text-xs px-2 py-1 disabled:opacity-50"
                            >
                              {isLoading ? "..." : "OK"}
                            </button>
                          )}
                        </div>
                      )}
                      {r.status === "aprovado" && (
                        <button
                          disabled={isLoading}
                          onClick={() => deliver(r.id)}
                          className="rounded-lg bg-blue-100 text-blue-700 text-xs px-2 py-1 hover:bg-blue-200 transition-colors"
                        >
                          {isLoading ? "..." : "Confirmar Retirada"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
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
                    router.push(`?tab=${activeTab}&limit=${n}`);
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
    </div>
  );
}
