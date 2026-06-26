"use client";

import Link from "next/link";
import { Clock, CheckCircle2, AlertTriangle, ArrowRightLeft, Timer } from "lucide-react";

type HandoverStatus =
  | "aguardando_assinatura_saida"
  | "aguardando_atribuicao"
  | "aguardando_assinatura_entrada"
  | "concluido"
  | "divergencia"
  | "vencido"
  | "cancelado";

interface HandoverCardProps {
  id:           string;
  status:       HandoverStatus;
  reserve:      { nome: string; acronym: string } | null;
  saindo:       { nome_completo: string } | null;
  entrando?:    { nome_completo: string } | null;
  created_at:   string;
  prazo_assumcao?: string | null;
}

const STATUS_LABELS: Record<HandoverStatus, string> = {
  aguardando_assinatura_saida:    "Aguardando assinatura (saindo)",
  aguardando_atribuicao:          "Aguardando atribuição",
  aguardando_assinatura_entrada:  "Aguardando assinatura (entrante)",
  concluido:                      "Concluído",
  divergencia:                    "Divergência registrada",
  vencido:                        "Prazo vencido",
  cancelado:                      "Cancelado",
};

const STATUS_STYLES: Record<HandoverStatus, { border: string; badge: string; text: string; Icon: typeof Clock }> = {
  aguardando_assinatura_saida:   { border: "border-l-amber-500",      badge: "bg-amber-500/10 text-amber-600",      text: "text-amber-500",      Icon: Clock },
  aguardando_atribuicao:         { border: "border-l-primary",        badge: "bg-primary/10 text-primary",          text: "text-primary",        Icon: Timer },
  aguardando_assinatura_entrada: { border: "border-l-amber-500",      badge: "bg-amber-500/10 text-amber-600",      text: "text-amber-500",      Icon: Clock },
  concluido:                     { border: "border-l-muted",          badge: "bg-muted/40 text-muted-foreground",   text: "text-muted-foreground", Icon: CheckCircle2 },
  divergencia:                   { border: "border-l-destructive",    badge: "bg-destructive/10 text-destructive",  text: "text-destructive",    Icon: AlertTriangle },
  vencido:                       { border: "border-l-destructive",    badge: "bg-destructive/10 text-destructive",  text: "text-destructive",    Icon: AlertTriangle },
  cancelado:                     { border: "border-l-muted",          badge: "bg-muted/40 text-muted-foreground",   text: "text-muted-foreground", Icon: CheckCircle2 },
};

const fmtDt = (d: string) =>
  new Date(d).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
    timeZone: "America/Recife",
  });

export function HandoverCard({
  id, status, reserve, saindo, entrando, created_at, prazo_assumcao,
}: HandoverCardProps) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.cancelado;
  const { Icon } = s;

  const isPending = ["aguardando_assinatura_saida", "aguardando_atribuicao", "aguardando_assinatura_entrada", "divergencia", "vencido"].includes(status);

  return (
    <Link href={`/reserva/passagens/${id}`}>
      <div
        data-testid={`handover-card-${id}`}
        className={[
          "rounded-2xl bg-card border-l-4 p-4 space-y-3 transition-all duration-150",
          "hover:-translate-y-0.5 cursor-pointer",
          s.border,
        ].join(" ")}
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className={["size-9 rounded-xl flex items-center justify-center shrink-0", s.badge.split(" ")[0]].join(" ")}>
            <Icon className={["size-4", s.text].join(" ")} />
          </div>
          <span className={["text-xs font-medium rounded-lg px-2 py-1", s.badge].join(" ")}>
            {STATUS_LABELS[status]}
          </span>
        </div>

        <div>
          <p className="text-xs font-semibold text-foreground flex items-center gap-1">
            <ArrowRightLeft className="size-3 text-muted-foreground" />
            {reserve?.acronym ?? "—"} — Passagem de Serviço
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Saindo: {saindo?.nome_completo ?? "—"}
            {entrando && <> · Entrando: {entrando.nome_completo}</>}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Aberta em {fmtDt(created_at)}
          </p>
          {prazo_assumcao && isPending && (
            <p className={["text-[11px] font-medium mt-0.5", s.text].join(" ")}>
              Prazo: {fmtDt(prazo_assumcao)}
            </p>
          )}
        </div>
      </div>
    </Link>
  );
}
