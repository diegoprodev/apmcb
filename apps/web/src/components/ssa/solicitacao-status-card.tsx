"use client";

import { Clock, CheckCircle2, XCircle, Package, Ban, ChevronRight } from "lucide-react";
import Link from "next/link";

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
  approved_at?: string | null;
}

const STATUS_CONFIG: Record<
  Status,
  { label: string; icon: React.ReactNode; bgClass: string; textClass: string; borderClass: string }
> = {
  pendente: {
    label: "Aguardando aprovação",
    icon: <Clock className="size-3.5 animate-pulse" />,
    bgClass: "bg-amber-50",
    textClass: "text-amber-700",
    borderClass: "border-amber-200",
  },
  aprovado: {
    label: "Aprovado — retire o material",
    icon: <CheckCircle2 className="size-3.5" />,
    bgClass: "bg-emerald-50",
    textClass: "text-emerald-700",
    borderClass: "border-emerald-200",
  },
  rejeitado: {
    label: "Não aprovado",
    icon: <XCircle className="size-3.5" />,
    bgClass: "bg-red-50",
    textClass: "text-red-700",
    borderClass: "border-red-200",
  },
  retirado: {
    label: "Material retirado",
    icon: <Package className="size-3.5" />,
    bgClass: "bg-blue-50",
    textClass: "text-blue-700",
    borderClass: "border-blue-200",
  },
  expirado: {
    label: "Prazo encerrado",
    icon: <Ban className="size-3.5" />,
    bgClass: "bg-muted/60",
    textClass: "text-muted-foreground",
    borderClass: "border-border",
  },
  cancelado: {
    label: "Cancelado",
    icon: <Ban className="size-3.5" />,
    bgClass: "bg-muted/40",
    textClass: "text-muted-foreground",
    borderClass: "border-border",
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
}: Props) {
  const cfg = STATUS_CONFIG[status];
  const materialSummary = items
    .slice(0, 2)
    .map((i) => `${i.material_nome_snapshot} ×${i.requested_quantity}`)
    .join(", ");
  const extra = items.length > 2 ? ` +${items.length - 2}` : "";

  return (
    <Link
      href="/cadete/solicitacoes"
      className={`rounded-2xl border p-4 flex flex-col gap-2 transition-opacity hover:opacity-90 ${cfg.bgClass} ${cfg.borderClass}`}
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className={`flex items-center gap-1.5 text-xs font-semibold ${cfg.textClass}`}>
        {cfg.icon}
        {cfg.label}
      </div>

      <p className="text-sm font-medium text-foreground truncate">
        {materialSummary}
        {extra && <span className="text-muted-foreground text-xs">{extra}</span>}
      </p>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Solicitado em {formatDate(requested_at)} às {formatTime(requested_at)}
        </p>
        <ChevronRight className="size-3.5 text-muted-foreground" />
      </div>

      {/* Countdown for approved */}
      {status === "aprovado" && expires_at && (
        <div className="rounded-lg bg-emerald-100 px-2 py-1 text-[11px] text-emerald-800 font-medium">
          ⏱ Retirar até {formatTime(expires_at)} hoje
        </div>
      )}

      {/* Denial reason */}
      {status === "rejeitado" && denial_reason && (
        <div className="rounded-lg bg-red-100 px-2 py-1 text-[11px] text-red-800">
          Motivo: {denial_reason.slice(0, 80)}{denial_reason.length > 80 ? "…" : ""}
        </div>
      )}

      {/* Short ID */}
      <p className="text-[10px] text-muted-foreground/60 font-mono">
        #{id.slice(0, 8).toUpperCase()}
      </p>
    </Link>
  );
}
