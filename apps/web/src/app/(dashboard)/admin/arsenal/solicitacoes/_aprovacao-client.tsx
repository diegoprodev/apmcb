"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2, X, TrendingDown, Plus, Loader2, ChevronDown, ChevronUp,
  LayoutGrid, List, ChevronLeft, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDateTime as formatDate } from "@/lib/format-date";
import { bffFetch } from "@/lib/bff-client";
import { friendlyApiError } from "@/lib/api-error";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import { useGridState } from "@/components/shared/use-grid-state";
import { getCategoryIcon } from "@/app/(dashboard)/admin/arsenal/_category-manager";

type Status = "pendente" | "aprovado" | "rejeitado";
type MaterialApprovalType = "stock_adjustment" | "material_addition" | "material_deactivation";

interface RequestorInfo {
  id?: string;
  nome_completo: string;
  posto?: string;
  matricula: string;
}
interface ReviewerInfo {
  id?: string;
  nome_completo: string;
}

interface MaterialApprovalRequest {
  source: "material";
  id: string;
  type: MaterialApprovalType;
  status: Status;
  payload: Record<string, unknown>;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
  requestor: RequestorInfo | null;
  material: { id: string; nome: string; categoria: string } | null;
  reviewer: ReviewerInfo | null;
}

// Categoria é um fluxo de aprovação paralelo (tabela category_requests,
// endpoints POST/api/categories/requests/:id/{approve,reject}) — distinto de
// admin_approval_requests tanto na tabela quanto no formato de payload. Antes
// desta mudança, essas solicitações nunca apareciam nesta tela: a API aceitava
// e persistia, mas nenhuma UI (armeiro ou admin) as exibia.
interface CategoryApprovalRequest {
  source: "category";
  id: string;
  status: Status;
  created_at: string;
  reviewed_at: string | null;
  nome: string;
  slug: string;
  icon: string | null;
  description: string | null;
  rejection_reason: string | null;
  // Nome da reserva de origem — admin_global vê solicitações de várias
  // reservas do mesmo tenant na mesma lista (correção de escopo cross-tenant
  // em categories.ts), então sem isto duas solicitações homônimas de
  // reservas diferentes ficam indistinguíveis na UI.
  reserveNome: string | null;
  requestor: RequestorInfo | null;
  reviewer: ReviewerInfo | null;
}

type ApprovalRequest = MaterialApprovalRequest | CategoryApprovalRequest;

type SearchableRequest = ApprovalRequest & { searchBlob: string };

const GRID_OPTIONS = { searchFields: ["searchBlob"] as (keyof SearchableRequest)[] };

const STATUS_TABS: { key: Status | "all"; label: string }[] = [
  { key: "pendente", label: "Pendentes" },
  { key: "aprovado", label: "Aprovadas" },
  { key: "rejeitado", label: "Rejeitadas" },
  { key: "all", label: "Histórico" },
];

type ViewMode = "grade" | "lista";
const PAGE_SIZE_OPTIONS = [10, 20, 30] as const;
type PageSize = typeof PAGE_SIZE_OPTIONS[number];

const TYPE_LABEL: Record<MaterialApprovalType, string> = {
  stock_adjustment: "Ajuste de estoque",
  material_addition: "Adição de material",
  material_deactivation: "Desativação de material",
};

function toSearchable(r: ApprovalRequest): SearchableRequest {
  if (r.source === "category") {
    return {
      ...r,
      searchBlob: [
        r.requestor?.nome_completo,
        r.requestor?.matricula,
        r.nome,
        r.description,
        r.reserveNome,
        "categoria nova categoria",
      ].filter(Boolean).join(" ").toLowerCase(),
    };
  }

  const materialNames = r.type === "material_addition"
    ? ((r.payload.items as { nome: string }[] | undefined ?? []).map((i) => i.nome).join(" "))
    : (r.material?.nome ?? String(r.payload.material_nome ?? ""));

  return {
    ...r,
    searchBlob: [
      r.requestor?.nome_completo,
      r.requestor?.matricula,
      r.requestor?.posto,
      materialNames,
      TYPE_LABEL[r.type],
    ].filter(Boolean).join(" ").toLowerCase(),
  };
}

function CategoryRequestCard({ req, onAction }: { req: CategoryApprovalRequest; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const { Icon } = getCategoryIcon(req.icon);

  // Achado de code review: colapsar o card SEM passar por "Cancelar" (ex:
  // clicando o próprio header/chevron de novo) deixava `mode` como estava —
  // reabrir esse card mostrava direto o painel de confirmação de
  // aprovar/rejeitar já ativo, sem o usuário ter escolhido isso de novo.
  function toggleExpanded() {
    setExpanded((v) => {
      if (v) setMode("idle");
      return !v;
    });
  }

  async function approve() {
    setLoading(true);
    try {
      const { ok, status, data } = await bffFetch("POST", `/api/categories/requests/${req.id}/approve`);
      if (!ok) {
        console.error("[aprovacao] falha ao aprovar categoria", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao aprovar"));
        return;
      }
      toast.success("Categoria aprovada e criada!");
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
      const { ok, status, data } = await bffFetch("POST", `/api/categories/requests/${req.id}/reject`, {
        reason: rejectNote,
      });
      if (!ok) {
        console.error("[aprovacao] falha ao rejeitar categoria", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao rejeitar"));
        return;
      }
      toast.success("Solicitação de categoria rejeitada");
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
      {/* Header em 3 controles IRMÃOS (botão ícone+título, Aprovar/Rejeitar,
          botão chevron) — não um único <button> envolvendo Aprovar/Rejeitar.
          Achado real (via E2E): <button> dentro de <button> é HTML inválido
          (o parser fecha o externo na primeira tag interna, e o React reporta
          "cannot be a descendant of <button> ... will cause a hydration
          error"); e mesmo depois de trocar o container externo por
          div+role="button", o problema persistia de um jeito mais sutil — o
          Accessible Name de um elemento role="button" é computado a partir de
          TODO o texto descendente, então o header herdava "...Aprovar
          Rejeitar" no próprio nome. Isso faz
          getByRole("button", { name: "Rejeitar" }) (substring match, Playwright
          default) casar com o HEADER inteiro também, e como o header precede
          seus próprios descendentes na ordem do documento, `.first()` sempre
          pegava o header (só alterna expanded) em vez do botão Rejeitar real —
          mode nunca virava "reject". Com os três como irmãos, cada um expõe
          seu próprio Accessible Name isolado. */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={toggleExpanded} aria-expanded={expanded}
          className="flex-1 min-w-0 flex items-center gap-3 text-left hover:bg-muted/40 transition-colors cursor-pointer rounded-lg">
          <div className="size-8 rounded-xl flex items-center justify-center shrink-0 bg-violet-100 dark:bg-violet-900/40">
            <Icon className="size-4 text-violet-700 dark:text-violet-300" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">Nova categoria: {req.nome}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${statusBadge}`}>
                {req.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {req.requestor?.nome_completo ?? "—"}
              {req.reserveNome ? ` · ${req.reserveNome}` : ""} · {formatDate(req.created_at)}
            </p>
          </div>
        </button>

        {req.status === "pendente" && (
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 h-7 text-xs"
              onClick={() => { setExpanded(true); setMode("approve"); }}>
              Aprovar
            </Button>
            <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5 h-7 text-xs"
              onClick={() => { setExpanded(true); setMode("reject"); }}>
              Rejeitar
            </Button>
          </div>
        )}

        <button type="button" onClick={toggleExpanded}
          aria-label={expanded ? "Recolher detalhes" : "Expandir detalhes"} aria-expanded={expanded}
          className="shrink-0 p-1 rounded-md hover:bg-muted/40 transition-colors cursor-pointer">
          {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/60">
          <div className="pt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Solicitante</p>
              <p className="font-medium">{req.requestor?.nome_completo ?? "—"}</p>
              <p className="text-xs text-muted-foreground">Mat. {req.requestor?.matricula}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Categoria</p>
              <p className="font-medium">{req.nome}</p>
              <p className="text-xs text-muted-foreground">
                {req.slug}{req.reserveNome ? ` · ${req.reserveNome}` : ""}
              </p>
            </div>
          </div>

          {req.description && (
            <div className="rounded-xl bg-muted/40 p-3 text-sm">
              <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide mb-1">Descrição</p>
              <p>{req.description}</p>
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
              {req.rejection_reason && <p>{req.rejection_reason}</p>}
            </div>
          )}

          {mode === "approve" && req.status === "pendente" && (
            <div className="space-y-2 pt-2 border-t border-border/60">
              <p className="text-sm font-semibold">Confirmar aprovação</p>
              <p className="text-xs text-muted-foreground">
                A categoria &ldquo;{req.nome}&rdquo; será criada e ficará disponível para uso imediatamente.
              </p>
              <div className="flex gap-2">
                <Button className="flex-1" onClick={approve} disabled={loading}>
                  {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <CheckCircle2 className="size-4 mr-1.5" />}
                  Aprovar e criar categoria
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
                className="w-full rounded-lg border border-input bg-white dark:bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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

function MaterialRequestCard({ req, onAction }: { req: MaterialApprovalRequest; onAction: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const payload = req.payload;
  const isAdjust = req.type === "stock_adjustment";
  const isDeactivate = req.type === "material_deactivation";
  const items = isAdjust || isDeactivate ? null : (payload.items as { nome: string; categoria: string; quantidade_total: number }[] | undefined);

  // Ver comentário equivalente em CategoryRequestCard: colapsar sem passar
  // por "Cancelar" deixava `mode` sobrevivendo entre expansões.
  function toggleExpanded() {
    setExpanded((v) => {
      if (v) setMode("idle");
      return !v;
    });
  }

  async function approve() {
    setLoading(true);
    try {
      const { ok, status, data } = await bffFetch("PATCH", `/api/arsenal/requests/${req.id}/approve`, {
        admin_note: note || undefined,
      });
      if (!ok) {
        console.error("[aprovacao] falha ao aprovar solicitação de material", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao aprovar"));
        return;
      }
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
      const { ok, status, data } = await bffFetch("PATCH", `/api/arsenal/requests/${req.id}/reject`, {
        admin_note: rejectNote,
      });
      if (!ok) {
        console.error("[aprovacao] falha ao rejeitar solicitação de material", { status, error: data.error });
        toast.error(friendlyApiError(status, data.error, "Erro ao rejeitar"));
        return;
      }
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
      {/* Header em 3 controles IRMÃOS — ver comentário equivalente em
          CategoryRequestCard acima: <button> dentro de <button> é HTML
          inválido, e mesmo com div+role="button" o Accessible Name do header
          herdava o texto "Aprovar Rejeitar" dos descendentes, fazendo
          getByRole("button", { name: "Rejeitar" }) casar com o header em vez
          do botão real (achado real via E2E, mesma raiz corrigida aqui). */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button type="button" onClick={toggleExpanded} aria-expanded={expanded}
          className="flex-1 min-w-0 flex items-center gap-3 text-left hover:bg-muted/40 transition-colors cursor-pointer rounded-lg">
          <div className={`size-8 rounded-xl flex items-center justify-center shrink-0 ${
            isAdjust ? "bg-amber-100 dark:bg-amber-900/40" : isDeactivate ? "bg-destructive/10" : "bg-primary/10"
          }`}>
            {isAdjust ? <TrendingDown className="size-4 text-amber-700 dark:text-amber-300" /> : isDeactivate ? <X className="size-4 text-destructive" /> : <Plus className="size-4 text-primary" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">
                {isAdjust ? "Ajuste de estoque" : isDeactivate ? "Desativacao de material" : "Adicao de material"}
              </span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${statusBadge}`}>
                {req.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {req.requestor?.nome_completo ?? "—"} · {formatDate(req.created_at)}
            </p>
          </div>
        </button>

        {req.status === "pendente" && (
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="outline" className="text-emerald-600 border-emerald-300 hover:bg-emerald-50 h-7 text-xs"
              onClick={() => { setExpanded(true); setMode("approve"); }}>
              Aprovar
            </Button>
            <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/5 h-7 text-xs"
              onClick={() => { setExpanded(true); setMode("reject"); }}>
              Rejeitar
            </Button>
          </div>
        )}

        <button type="button" onClick={toggleExpanded}
          aria-label={expanded ? "Recolher detalhes" : "Expandir detalhes"} aria-expanded={expanded}
          className="shrink-0 p-1 rounded-md hover:bg-muted/40 transition-colors cursor-pointer">
          {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </button>
      </div>

      {/* Details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-border/60">
          <div className="pt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wide">Solicitante</p>
              <p className="font-medium">{req.requestor?.nome_completo ?? "—"}</p>
              <p className="text-xs text-muted-foreground">{req.requestor?.posto} · Mat. {req.requestor?.matricula}</p>
            </div>
            {(isAdjust || isDeactivate) && req.material && (
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
          ) : isDeactivate ? (
            <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">{String(payload.material_nome ?? req.material?.nome ?? "Material")}</p>
              {(payload.notes as string | undefined) && (
                <p className="mt-1 text-xs text-muted-foreground">{String(payload.notes)}</p>
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
                className="w-full rounded-lg border border-input bg-white dark:bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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
                className="w-full rounded-lg border border-input bg-white dark:bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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

function RequestCard({ req, onAction }: { req: ApprovalRequest; onAction: () => void }) {
  if (req.source === "category") return <CategoryRequestCard req={req} onAction={onAction} />;
  return <MaterialRequestCard req={req} onAction={onAction} />;
}

export function AprovacaoClient({ requests }: { requests: ApprovalRequest[] }) {
  const [tab, setTab] = useState<Status | "all">("pendente");
  const [viewMode, setViewMode] = useState<ViewMode>("lista");
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [page, setPage] = useState(1);
  const [printReady, setPrintReady] = useState(false);
  const localRequests = requests;

  const searchable = useMemo(() => localRequests.map(toSearchable), [localRequests]);
  const { searchText, setSearchText, processedData } = useGridState<SearchableRequest>(searchable, GRID_OPTIONS);

  const filtered = tab === "all" ? processedData : processedData.filter((r) => r.status === tab);

  // Troca de aba, busca ou tamanho de página sempre volta pra página 1 — sem
  // isso o usuário pode ficar "preso" numa página que não existe mais depois
  // de filtrar (ex: estava na página 3 de "Histórico" e trocou pra
  // "Pendentes", que só tem 1 página).
  useEffect(() => {
    setPage(1);
  }, [tab, searchText, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Clamp defensivo: cobre também o caso de uma ação (aprovar/rejeitar)
  // encolher `filtered` via router.refresh() sem passar pelas dependências
  // do efeito acima (ex: usuário na última página do histórico e o item mais
  // recente sai do filtro por outro motivo).
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const paginated = useMemo(
    () => filtered.slice((safePage - 1) * pageSize, safePage * pageSize),
    [filtered, safePage, pageSize]
  );

  const counts = useMemo(() => localRequests.reduce(
    (acc, r) => {
      acc[r.status] += 1;
      acc.all += 1;
      return acc;
    },
    { pendente: 0, aprovado: 0, rejeitado: 0, all: 0 } as Record<Status | "all", number>
  ), [localRequests]);

  function handleAction() {
    // After action, re-fetch is triggered by router.refresh() in the card
    // Optimistically update local count by switching to refresh
  }

  return (
    <div className="space-y-4">
      {/* Tabs + busca */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex gap-1 rounded-xl bg-muted/60 p-1 w-fit overflow-x-auto">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
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
        <GridSearchInput
          value={searchText}
          onChange={setSearchText}
          placeholder="Buscar por armeiro, matrícula, material ou categoria..."
          className="sm:max-w-xs sm:ml-auto"
          data-testid="solicitacoes-search"
        />
      </div>

      {/* Itens por página + alternância grade/lista + exportação PDF */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Itens por página:</span>
          <div className="flex gap-1 rounded-xl bg-muted/60 p-1">
            {PAGE_SIZE_OPTIONS.map((size) => (
              <button
                key={size}
                type="button"
                onClick={() => setPageSize(size)}
                aria-label={`Mostrar ${size} itens por página`}
                aria-pressed={pageSize === size}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer ${
                  pageSize === size
                    ? "bg-card shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Container de impressão só é montado sob demanda (hover/foco/toque
              antecipam o clique) — sem isso, a lista COMPLETA filtrada (todas
              as páginas) ficaria sempre no DOM mesmo sem o usuário nunca
              exportar, anulando o ganho de performance da própria paginação
              em abas como "Histórico" (centenas de itens acumulados). */}
          <div
            onMouseEnter={() => setPrintReady(true)}
            onFocus={() => setPrintReady(true)}
            onTouchStart={() => setPrintReady(true)}
          >
            <GridPdfButton
              printTargetId="solicitacoes-armeiro-print"
              label="PDF"
              selectedCount={filtered.length}
              reportTitle="SOLICITAÇÕES DE ARMEIRO"
              disabled={filtered.length === 0}
            />
          </div>
          <div className="flex rounded-xl border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("grade")}
              title="Ver em grade"
              aria-label="Ver em grade"
              aria-pressed={viewMode === "grade"}
              className={`px-2.5 py-2 transition-colors cursor-pointer ${
                viewMode === "grade" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <LayoutGrid className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("lista")}
              title="Ver em lista"
              aria-label="Ver em lista"
              aria-pressed={viewMode === "lista"}
              className={`px-2.5 py-2 transition-colors cursor-pointer ${
                viewMode === "lista" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted/60"
              }`}
            >
              <List className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Requests */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl bg-card p-10 text-center text-muted-foreground text-sm"
          style={{ boxShadow: "var(--shadow-card)" }}>
          {searchText ? (
            <p>Nenhuma solicitação encontrada para &ldquo;{searchText}&rdquo;.</p>
          ) : tab === "pendente" ? (
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
        <>
          <div className={viewMode === "grade" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start" : "space-y-3"}>
            {paginated.map((r) => (
              <RequestCard key={r.id} req={r} onAction={handleAction} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setPage(safePage - 1)}
                disabled={safePage <= 1}
                aria-label="Página anterior"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-pointer"
              >
                <ChevronLeft className="size-3.5" /> Anterior
              </button>
              <span className="text-xs text-muted-foreground tabular-nums">
                Página {safePage} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(safePage + 1)}
                disabled={safePage >= totalPages}
                aria-label="Próxima página"
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-pointer"
              >
                Próxima <ChevronRight className="size-3.5" />
              </button>
            </div>
          )}

          {/* Container oculto exclusivo para exportação em PDF: o GridPdfButton
              clona o conteúdo deste elemento pelo id, então precisa conter
              SEMPRE a lista completa filtrada (todas as páginas), não só a
              fatia exibida em tela — senão o PDF sairia incompleto ao usar
              paginação. Ver mesmo raciocínio (sem paginação) em
              reserva/arsenal/_arsenal-client.tsx. */}
          <div id="solicitacoes-armeiro-print" className="hidden">
            {printReady && (
              <div className="space-y-3">
                {filtered.map((r) => (
                  <RequestCard key={`print-${r.id}`} req={r} onAction={handleAction} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
