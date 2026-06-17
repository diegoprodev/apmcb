"use client";

import { useState } from "react";
import {
  CheckCircle2, XCircle, Package, Clock, AlertCircle,
  User, Shield, ChevronDown, ChevronUp, Loader2
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogTrigger, DialogPortal, DialogOverlay,
  DialogContent, DialogTitle, DialogDescription, DialogClose
} from "@/components/ui/dialog";
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

const STATUS_LABELS: Record<Status, string> = {
  pendente: "Pendente",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
  retirado: "Retirado",
  expirado: "Expirado",
  cancelado: "Cancelado",
};

const STATUS_BADGE: Record<Status, string> = {
  pendente: "bg-amber-100 text-amber-800",
  aprovado: "bg-emerald-100 text-emerald-800",
  rejeitado: "bg-red-100 text-red-800",
  retirado: "bg-blue-100 text-blue-800",
  expirado: "bg-muted text-muted-foreground",
  cancelado: "bg-muted/60 text-muted-foreground",
};

type Tab = "pendentes" | "aprovadas" | "hoje" | "historico";

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function SolicitacoesClient({ initialRequests }: { initialRequests: Request[] }) {
  const [requests, setRequests] = useState<Request[]>(initialRequests);
  const [activeTab, setActiveTab] = useState<Tab>("pendentes");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

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

  async function approve(id: string) {
    setLoadingId(id);
    try {
      const res = await fetch(`${BFF_URL}/api/ssa/requests/${id}/approve`, {
        method: "PATCH",
        credentials: "include",
        headers: await bffHeaders(),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error ?? "Erro ao aprovar."); return; }
      updateRequest(id, {
        status: "aprovado",
        approved_at: new Date().toISOString(),
        expires_at: body.expires_at,
      });
      toast.success("Solicitação aprovada! Militar notificado.");
    } catch {
      toast.error("Sem conexão com o servidor.");
    } finally {
      setLoadingId(null);
    }
  }

  async function deliver(id: string) {
    setLoadingId(id);
    try {
      const res = await fetch(`${BFF_URL}/api/ssa/requests/${id}/deliver`, {
        method: "PATCH",
        credentials: "include",
        headers: await bffHeaders(),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error ?? "Erro ao confirmar entrega."); return; }
      updateRequest(id, { status: "retirado", delivered_at: new Date().toISOString() });
      toast.success("Entrega confirmada! Registro criado.");
    } catch {
      toast.error("Sem conexão com o servidor.");
    } finally {
      setLoadingId(null);
    }
  }

  async function reject() {
    if (!rejectId) return;
    if (!rejectReason.trim() || rejectReason.trim().length < 5) {
      toast.error("Informe o motivo da rejeição (mínimo 5 caracteres).");
      return;
    }
    setRejectLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/ssa/requests/${rejectId}/reject`, {
        method: "PATCH",
        credentials: "include",
        headers: await bffHeaders("application/json"),
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const body = await res.json();
      if (!res.ok) { toast.error(body.error ?? "Erro ao rejeitar."); return; }
      updateRequest(rejectId, {
        status: "rejeitado",
        denial_reason: rejectReason.trim(),
        rejected_at: new Date().toISOString(),
      });
      toast.success("Solicitação rejeitada. Militar notificado.");
      setRejectId(null);
      setRejectReason("");
    } catch {
      toast.error("Sem conexão com o servidor.");
    } finally {
      setRejectLoading(false);
    }
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "pendentes", label: "Pendentes" },
    { id: "aprovadas", label: "Aprovadas" },
    { id: "hoje", label: "Hoje" },
    { id: "historico", label: "Histórico" },
  ];

  return (
    <>
      {/* Tabs */}
      <div className="flex gap-1 bg-muted rounded-xl p-1 overflow-x-auto">
        {tabs.map((t) => {
          const count =
            t.id === "pendentes" ? requests.filter((r) => r.status === "pendente").length
            : t.id === "aprovadas" ? requests.filter((r) => r.status === "aprovado").length
            : undefined;
          return (
            <button
              key={t.id}
              data-testid={`tab-${t.id}`}
              onClick={() => setActiveTab(t.id)}
              className={`flex-1 min-w-max rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === t.id
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
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

      {/* List */}
      <div className="space-y-3" data-testid="ssa-table">
        {filtered.length === 0 && (
          <div className="rounded-2xl bg-card p-10 text-center text-muted-foreground text-sm"
            style={{ boxShadow: "var(--shadow-card)" }}>
            Nenhuma solicitação {activeTab === "pendentes" ? "pendente" : "nesta categoria"}.
          </div>
        )}

        {filtered.map((r) => {
          const isExpanded = expanded.has(r.id);
          const isLoading = loadingId === r.id;
          const isExpired = r.expires_at && new Date(r.expires_at) < new Date();

          return (
            <div
              key={r.id}
              data-testid="ssa-row"
              className={`rounded-2xl bg-card overflow-hidden transition-all ${
                r.status === "pendente" ? "border border-amber-200" : "border border-border"
              }`}
              style={{ boxShadow: "var(--shadow-card)" }}
            >
              {/* Row header */}
              <button
                className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
                onClick={() => toggleExpand(r.id)}
              >
                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <User className="size-4" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">
                      {r.military?.posto} {r.military?.nome_completo}
                    </p>
                    <span
                      data-testid="status-badge"
                      className={`shrink-0 text-[10px] font-semibold rounded-full px-2 py-0.5 ${STATUS_BADGE[r.status]}`}
                    >
                      {STATUS_LABELS[r.status]}
                    </span>
                    {r.totp_validated && (
                      <span className="size-3 text-emerald-600 shrink-0" aria-label="TOTP validado">
                        <Shield className="size-3" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.items.map((i) => `${i.material_nome_snapshot} ×${i.requested_quantity}`).join(", ")}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {fmtDateTime(r.requested_at)}
                    {r.status === "aprovado" && r.expires_at && (
                      <span className={`ml-2 font-medium ${isExpired ? "text-red-600" : "text-emerald-600"}`}>
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

              {/* Expanded details */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
                  {/* Military info */}
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

                  {/* Items */}
                  <div className="space-y-1">
                    {r.items.map((item) => (
                      <div key={item.id} className="flex items-center justify-between text-sm">
                        <span>{item.material_nome_snapshot}</span>
                        <span className="text-muted-foreground font-mono text-xs">
                          × {item.requested_quantity}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Notes */}
                  {r.notes && (
                    <div className="rounded-lg bg-muted/50 p-2.5 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Obs: </span>{r.notes}
                    </div>
                  )}

                  {/* Denial reason */}
                  {r.denial_reason && (
                    <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700">
                      <span className="font-medium">Motivo da rejeição: </span>{r.denial_reason}
                    </div>
                  )}

                  {/* Actions */}
                  {r.status === "pendente" && (
                    <div className="flex gap-2 pt-1">
                      <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        size="sm"
                        data-testid="btn-aprovar"
                        disabled={isLoading}
                        onClick={() => approve(r.id)}
                      >
                        {isLoading ? <Loader2 className="size-4 animate-spin" /> : (
                          <><CheckCircle2 className="size-4 mr-1" /> Aprovar</>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 border-red-300 text-red-600 hover:bg-red-50"
                        size="sm"
                        data-testid="btn-rejeitar"
                        disabled={isLoading}
                        onClick={() => { setRejectId(r.id); setRejectReason(""); }}
                      >
                        <XCircle className="size-4 mr-1" /> Rejeitar
                      </Button>
                    </div>
                  )}

                  {r.status === "aprovado" && !isExpired && (
                    <Button
                      className="w-full"
                      size="sm"
                      disabled={isLoading}
                      onClick={() => deliver(r.id)}
                    >
                      {isLoading ? <Loader2 className="size-4 animate-spin" /> : (
                        <><Package className="size-4 mr-1.5" /> Confirmar Retirada</>
                      )}
                    </Button>
                  )}

                  {r.status === "aprovado" && isExpired && (
                    <div className="rounded-lg bg-red-50 p-2.5 text-xs text-red-700 flex gap-2">
                      <AlertCircle className="size-4 shrink-0" />
                      Prazo de 6h expirado. A solicitação será automaticamente cancelada.
                    </div>
                  )}

                  {r.status === "retirado" && (
                    <div className="rounded-lg bg-blue-50 p-2.5 text-xs text-blue-700 flex gap-2">
                      <Clock className="size-4 shrink-0" />
                      Retirado em {r.delivered_at ? fmtDateTime(r.delivered_at) : "—"}{" "}
                      {r.reserva ? `por ${r.reserva.nome_completo}` : ""}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Reject dialog */}
      <Dialog open={rejectId !== null} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogPortal>
          <DialogOverlay />
          <DialogContent className="max-w-sm mx-auto p-6 space-y-4">
            <DialogTitle>Rejeitar Solicitação</DialogTitle>
            <DialogDescription>
              Informe o motivo da rejeição. O militar será notificado.
            </DialogDescription>
            <div className="space-y-1.5">
              <Label htmlFor="reject-reason">Motivo *</Label>
              <Input
                id="reject-reason"
                placeholder="Ex: Material em manutenção preventiva"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                maxLength={300}
                data-testid="input-reject-reason"
              />
            </div>
            <div className="flex gap-2">
              <DialogClose render={<Button variant="outline" className="flex-1" />}>
                Cancelar
              </DialogClose>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700 text-white"
                disabled={rejectLoading || rejectReason.trim().length < 5}
                data-testid="btn-confirmar-rejeicao"
                onClick={reject}
              >
                {rejectLoading ? <Loader2 className="size-4 animate-spin" /> : "Confirmar Rejeição"}
              </Button>
            </div>
          </DialogContent>
        </DialogPortal>
      </Dialog>
    </>
  );
}
