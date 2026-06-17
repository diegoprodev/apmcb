"use client";

import { useState } from "react";
import { Clock, CheckCircle2, X, TrendingDown, Plus, ChevronDown, ChevronUp } from "lucide-react";

interface OwnRequest {
  id: string;
  type: "stock_adjustment" | "material_addition";
  status: "pendente" | "aprovado" | "rejeitado";
  payload: Record<string, unknown>;
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

const pendingCount = (reqs: OwnRequest[]) => reqs.filter((r) => r.status === "pendente").length;

export function MyRequestsBanner({ requests }: { requests: OwnRequest[] }) {
  const [open, setOpen] = useState(false);
  const pending = pendingCount(requests);

  return (
    <div className="rounded-2xl bg-card overflow-hidden border border-border/60" style={{ boxShadow: "var(--shadow-card)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/40 transition-colors cursor-pointer text-left"
      >
        <div className={`size-8 rounded-xl flex items-center justify-center shrink-0 ${pending > 0 ? "bg-amber-100 dark:bg-amber-900/40" : "bg-muted"}`}>
          <Clock className={`size-4 ${pending > 0 ? "text-amber-600 dark:text-amber-300" : "text-muted-foreground"}`} />
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold">Minhas solicitações</p>
          <p className="text-xs text-muted-foreground">
            {pending > 0 ? `${pending} pendente${pending !== 1 ? "s" : ""} · ` : ""}
            {requests.length} no total
          </p>
        </div>
        {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t border-border/60 divide-y divide-border/60">
          {requests.map((r) => {
            const isAdjust = r.type === "stock_adjustment";
            const items = isAdjust ? null : (r.payload.items as { nome: string; quantidade_total: number }[] | undefined);
            const statusIcon = r.status === "pendente"
              ? <Clock className="size-3.5 text-amber-500" />
              : r.status === "aprovado"
              ? <CheckCircle2 className="size-3.5 text-emerald-500" />
              : <X className="size-3.5 text-destructive" />;

            return (
              <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{statusIcon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {isAdjust ? "Ajuste de estoque" : `Adição: ${items?.map((i) => i.nome).join(", ")}`}
                    </span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${
                      r.status === "pendente" ? "bg-amber-100 text-amber-800" :
                      r.status === "aprovado" ? "bg-emerald-100 text-emerald-800" :
                      "bg-destructive/10 text-destructive"
                    }`}>
                      {r.status}
                    </span>
                  </div>
                  {isAdjust && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Nova qty: <span className="font-medium">{String(r.payload.new_quantity)}</span> · {String(r.payload.material_nome ?? "")}
                    </p>
                  )}
                  {r.admin_note && (
                    <p className="text-xs text-muted-foreground mt-0.5 italic">"{r.admin_note}"</p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-1">{formatDate(r.created_at)}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
