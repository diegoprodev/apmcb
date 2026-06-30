"use client";

import { Clock, CheckCircle2, XCircle, Package, Ban, ChevronRight } from "lucide-react";

type Status = "pendente" | "aprovado" | "rejeitado" | "retirado" | "expirado" | "cancelado";

interface Item {
  material_nome_snapshot: string;
  requested_quantity: number;
}

interface Props {
  id: string;
  status: Status;
  items: Item[];
  requested_at: string;
  expires_at?: string | null;
  denial_reason?: string | null;
  armeiro_nota?: string | null;
  approved_at?: string | null;
}

const STATUS_CONFIG: Record<
  Status,
  { label: string; icon: React.ReactNode; badgeClass: string }
> = {
  pendente: {
    label: "Aguardando aprovação",
    icon: <Clock className="size-3 animate-pulse" />,
    badgeClass: "bg-amber-500/10 text-amber-700 border border-amber-500/30",
  },
  aprovado: {
    label: "Aprovado — retire o material",
    icon: <CheckCircle2 className="size-3" />,
    badgeClass: "bg-emerald-500/10 text-emerald-700 border border-emerald-500/30",
  },
  rejeitado: {
    label: "Não aprovado",
    icon: <XCircle className="size-3" />,
    badgeClass: "bg-red-500/10 text-red-700 border border-red-500/30",
  },
  retirado: {
    label: "Material retirado",
    icon: <Package className="size-3" />,
    badgeClass: "bg-blue-500/10 text-blue-700 border border-blue-500/30",
  },
  expirado: {
    label: "Prazo encerrado",
    icon: <Ban className="size-3" />,
    badgeClass: "bg-muted/60 text-muted-foreground border border-border",
  },
  cancelado: {
    label: "Cancelado",
    icon: <Ban className="size-3" />,
    badgeClass: "bg-muted/40 text-muted-foreground border border-border",
  },
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export function SolicitacaoStatusCard({
  id,
  status,
  items,
  requested_at,
  expires_at,
  denial_reason,
  armeiro_nota,
}: Props) {
  const cfg = STATUS_CONFIG[status];
  const materialSummary = items
    .slice(0, 2)
    .map((i) => `${i.material_nome_snapshot} ×${i.requested_quantity}`)
    .join(", ");
  const extra = items.length > 2 ? ` +${items.length - 2}` : "";

  return (
    <div
      role="button"
      tabIndex={0}
      className="rounded-2xl border border-border/40 bg-card p-4 flex flex-col gap-2 cursor-pointer transition-colors hover:bg-muted/30"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      {/* Status badge */}
      <div className={`inline-flex items-center gap-1.5 self-start rounded-full px-2 py-0.5 text-[10px] font-semibold ${cfg.badgeClass}`}>
        {cfg.icon}
        {cfg.label}
      </div>

      <p className="text-sm font-medium text-foreground truncate">
        {materialSummary}
        {extra && <span className="text-muted-foreground text-xs">{extra}</span>}
      </p>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground" suppressHydrationWarning>
          Solicitado em {formatDate(requested_at)} às {formatTime(requested_at)}
        </p>
        <ChevronRight className="size-3.5 text-muted-foreground" />
      </div>

      {/* Countdown for approved */}
      {status === "aprovado" && expires_at && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 text-[11px] text-emerald-700 font-medium" suppressHydrationWarning>
          ⏱ Retirar até {formatTime(expires_at)} hoje
        </div>
      )}

      {/* Armeiro note on approved */}
      {status === "aprovado" && armeiro_nota && (
        <div className="rounded-lg bg-muted px-2 py-1 text-[11px] text-muted-foreground">
          💬 {armeiro_nota.slice(0, 100)}{armeiro_nota.length > 100 ? "…" : ""}
        </div>
      )}

      {/* Denial reason */}
      {status === "rejeitado" && denial_reason && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-2 py-1 text-[11px] text-red-700">
          Motivo: {denial_reason.slice(0, 80)}{denial_reason.length > 80 ? "…" : ""}
        </div>
      )}

      {/* Short ID */}
      <p className="text-[10px] text-muted-foreground/60 font-mono">
        #{id.slice(0, 8).toUpperCase()}
      </p>
    </div>
  );
}
