import Link from "next/link";
import { Clock, ChevronRight } from "lucide-react";

export function ReviewRequestsAccordion({ pendingCount }: { pendingCount: number }) {
  const hasPending = pendingCount > 0;

  return (
    <Link
      href="/admin/arsenal/solicitacoes"
      className="rounded-2xl bg-card overflow-hidden border border-border/60 flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
      style={{ boxShadow: "var(--shadow-card)" }}
      data-testid="accordion-solicitacoes-armeiro"
    >
      <div className={`size-8 rounded-xl flex items-center justify-center shrink-0 ${hasPending ? "bg-amber-100 dark:bg-amber-900/40" : "bg-muted"}`}>
        <Clock className={`size-4 ${hasPending ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground"}`} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold">Solicitações de armeiro</p>
        <p className="text-xs text-muted-foreground">
          {hasPending
            ? `${pendingCount} pendente${pendingCount !== 1 ? "s" : ""} aguardando revisão`
            : "Ajustes, adições e desativações de material"}
        </p>
      </div>
      {hasPending && (
        <span className="badge-warning text-[10px] font-bold tracking-wide rounded-full px-2 py-0.5 min-w-5 text-center">
          {pendingCount}
        </span>
      )}
      <ChevronRight className="size-4 text-muted-foreground shrink-0" />
    </Link>
  );
}
