"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X, Clock, Package, TrendingDown, Plus, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

async function getBearerHeaders(): Promise<Record<string, string>> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (session?.access_token) h["Authorization"] = `Bearer ${session.access_token}`;
  return h;
}

type Status = "pendente" | "aprovado" | "rejeitado";

interface ApprovalRequest {
  id: string;
  type: "stock_adjustment" | "material_addition";
  status: Status;
  payload: Record<string, unknown>;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  requestor: { id: string; nome_completo: string; posto: string; matricula: string } | null;
  material: { id: string; nome: string; categoria: string } | null;
  reviewer: { id: string; nome_completo: string } | null;
}

const STATUS_TABS: { key: Status | "all"; label: string }[] = [
  { key: "pendente", label: "Pendentes" },
  { key: "aprovado", label: "Aprovadas" },
  { key: "rejeitado", label: "Rejeitadas" },
  { key: "all", label: "Todas" },
];

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function RequestCard({ req, onAction }: { req: ApprovalRequest; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const payload = req.payload;
  const isAdjust = req.type === "stock_adjustment";
  const items = isAdjust ? null : (payload.items as { nome: string; categoria: string; quantidade_total: number }[] | undefined);

  async function approve() {
    setLoading(true);
    try {
      const headers = await getBearerHeaders();
      const res = await fetch(`${BFF_URL}/api/arsenal/requests/${req.id}/approve`, {
        method: "PATCH", headers,
        body: JSON.stringify({ admin_note: note || undefined }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Erro ao aprovar"); return; }
      toast.success("Solicitação aprovada e aplicada!");
      onAction();
      router.refresh();
    } catch { toast.error("Erro de conexão"); }
    finally { setLoading(false); setMode("idle"); }
  }

  async function reject() {
    if (!rejectNote.trim() || rejectNote.trim().length < 5) {
      toast.error("Informe um motivo com ao menos 5 caracteres");
      return;
    }
    setLoading(true);
    try {
      const headers = await getBearerHeaders();
      const res = await fetch(`${BFF_URL}/api/arsenal/requests/${req.id}/reject`, {
        method: "PATCH", headers,
        body: JSON.stringify({ admin_note: rejectNote }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) { toast.error(data.error ?? "Erro ao rejeitar"); return; }
      toast.success("Solicitação rejeitada");
      onAction();
      router.refresh();
    } catch { toast.error("Erro de conexão"); }
    finally { setLoading(false); setMode("idle"); }
  }

  const statusBadge = {
    pendente: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    aprovado: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
    rejeitado: "bg-destructive/10 text-destructive",
  }[req.status];

  return (
    <div className="rounded-2xl bg-card overflow-hidden border border-border/60" style={{ boxShadow: "var(--shadow-card)" }}>
      {/* Header */}
      <button type="button" onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted/40 transition-colors cursor-pointer">
        <div className={`size-8 rounded-xl flex items-center justify-center shrink-0 ${
          isAdjust ? "bg-amber-100 dark:bg-amber-900/40" : "bg-primary/10"
        }`}>
          {isAdjust ? <TrendingDown className="size-4 text-amber-700 dark:text-amber-300" /> : <Plus className="size-4 text-primary" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">
              {isAdjust ? "Ajuste de estoque" : "Adição de material"}
            </span>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${statusBadge}`}>
              {req.status}
            </span>
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {req.requestor?.nome_completo ?? "—"} · {formatDate(req.created_at)}
          </p>
        </div>

        {req.status === "pendente" && (
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 h-7 text-xs"
              onClick={(e) => { e.stopPropagation(); setExpanded(true); setMode("approve"); }}>
              Aprovar
            </Button>
            <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5 h-7 text-xs"
              onClick={(e) => { e.stopPropagation(); setExpanded(true); setMode("reject"); }}>
              Rejeitar
            </Button>
          </div>
        )}

        {expanded ? <ChevronUp className="size-4 text-muted-foreground shrink-0" /> : <ChevronDown className="size-4 text-muted-foreground shrink-0" />}
      </button>

      {/* Details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/60">
          <div className="pt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Solicitante</p>
              <p className="font-medium">{req.requestor?.nome_completo ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{req.requestor?.posto} · Mat. {req.requestor?.matricula}</p>
            </div>
            {isAdjust && req.material && (
              <div>
                <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Material</p>
                <p className="font-medium">{req.material.nome}</p>
                <p className="text-xs text-muted-foreground">{req.material.categoria}</p>
              </div>
            )}
          </div>

          {isAdjust ? (
            <div className="rounded-xl bg-muted/40 p-3 text-sm flex gap-6">
              <div>
                <p className="text-[10px] text-muted-foreground">Qtd. atual</p>
                <p className="font-semibold">{String(payload.quantidade_atual ?? "—")}</p>
              </div>
              <div className="text-muted-foreground self-center">→</div>
              <div>
                <p className="text-[10px] text-muted-foreground">Nova qtd.</p>
                <p className="font-semibold text-primary">{String(payload.new_quantity ?? "—")}</p>
              </div>
              {(payload.notes as string | undefined) && (
                <div className="flex-1">
                  <p className="text-[10px] text-muted-foreground">Observação</p>
                  <p className="text-xs">{String(payload.notes)}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">
                {items?.length} material{items?.length !== 1 ? "is" : ""} a adicionar
              </p>
              <div className="divide-y divide-border/60 rounded-xl border border-border/60 overflow-hidden">
                {items?.map((item, i) => (
                  <div key={i} className="px-3 py-2 flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium">{item.nome}</p>
                      <p className="text-xs text-muted-foreground">{item.categoria}</p>
                    </div>
                    <span className="text-sm font-semibold">{item.quantidade_total} un.</span>
                  </div>
                ))}
              </div>
              {(payload.notes as string | undefined) && (
                <p className="text-xs text-muted-foreground italic">{String(payload.notes)}</p>
              )}
            </div>
          )}

          {req.status !== "pendente" && (
            <div className={`rounded-xl p-3 text-sm ${
              req.status === "aprovado"
                ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300"
                : "bg-destructive/5 text-destructive"
            }`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide mb-1">
                {req.status === "aprovado" ? "Aprovado" : "Rejeitado"} por {req.reviewer?.nome_completo ?? "—"} em {req.reviewed_at ? formatDate(req.reviewed_at) : "—"}
              </p>
              {req.admin_note && <p>{req.admin_note}</p>}
            </div>
          )}

          {/* Action forms */}
          {mode === "approve" && req.status === "pendente" && (
            <div className="space-y-2 pt-2 border-t border-border/60">
              <p className="text-sm font-semibold">Confirmar aprovação</p>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Observação opcional..."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                disabled={loading}
              />
              <div className="flex gap-2">
                <Button className="flex-1" onClick={approve} disabled={loading}>
                  {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <CheckCircle2 className="size-4 mr-1.5" />}
                  Aprovar e aplicar
                </Button>
                <Button variant="outline" onClick={() => setMode("idle")} disabled={loading}>Cancelar</Button>
              </div>
            </div>
          )}

          {mode === "reject" && req.status === "pendente" && (
            <div className="space-y-2 pt-2 border-t border-border/60">
              <p className="text-sm font-semibold">Motivo da rejeição <span className="text-destructive">*</span></p>
              <input
                type="text"
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="Informe o motivo (obrigatório)..."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                disabled={loading}
              />
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/5"
                  onClick={reject} disabled={loading || rejectNote.trim().length < 5}>
                  {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <X className="size-4 mr-1.5" />}
                  Confirmar rejeição
                </Button>
                <Button variant="outline" onClick={() => setMode("idle")} disabled={loading}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AprovacaoClient({ requests }: { requests: ApprovalRequest[] }) {
  const [tab, setTab] = useState<Status | "all">("pendente");
  const [localRequests, setLocalRequests] = useState(requests);

  const filtered = tab === "all" ? localRequests : localRequests.filter((r) => r.status === tab);

  const counts: Record<Status | "all", number> = {
    pendente: localRequests.filter((r) => r.status === "pendente").length,
    aprovado: localRequests.filter((r) => r.status === "aprovado").length,
    rejeitado: localRequests.filter((r) => r.status === "rejeitado").length,
    all: localRequests.length,
  };

  function handleAction() {
    // After action, re-fetch is triggered by router.refresh() in the card
    // Optimistically update local count by switching to refresh
  }

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-muted/60 p-1 w-fit">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer ${
              tab === t.key
                ? "bg-card shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span className={`min-w-[18px] h-[18px] text-[10px] font-bold rounded-full flex items-center justify-center ${
                t.key === "pendente" && tab === t.key ? "bg-amber-200 text-amber-800" :
                t.key === "pendente" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"
              }`}>
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Requests */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-card p-10 text-center text-muted-foreground text-sm"
          style={{ boxShadow: "var(--shadow-card)" }}>
          {tab === "pendente" ? (
            <>
              <CheckCircle2 className="size-10 text-emerald-500 mx-auto mb-3" />
              <p className="font-medium">Nenhuma solicitação pendente</p>
              <p className="text-xs mt-1">Tudo em dia por enquanto.</p>
            </>
          ) : (
            <p>Nenhuma solicitação encontrada.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => (
            <RequestCard key={r.id} req={r} onAction={handleAction} />
          ))}
        </div>
      )}
    </div>
  );
}
