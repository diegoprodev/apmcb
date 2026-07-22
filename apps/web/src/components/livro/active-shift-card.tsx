"use client";

import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ListChecks } from "lucide-react";
import { useLiveDuration } from "@/hooks/use-live-duration";

interface ActiveShiftCardShift {
  id: string;
  started_at: string;
  evento_count: number;
  pending_count: number;
  reserve: { nome: string };
  armeiro: { nome_completo: string; matricula: string; posto: string };
}

interface ActiveShiftCardProps {
  shift: ActiveShiftCardShift;
  onOpen: () => void;
}

// Grid "Em Serviço Agora" do admin (spec de redesign do Livro Digital,
// seção 4.1) — responde de 1 clique a pergunta mais frequente do admin
// ("quem está de plantão agora"), sem precisar aplicar filtro manualmente.
export function ActiveShiftCard({ shift, onOpen }: ActiveShiftCardProps) {
  const duration = useLiveDuration(shift.started_at);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left rounded-xl border bg-card p-4 space-y-2 hover:bg-accent/20 hover:border-primary/50 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium truncate">
          {shift.armeiro.posto} {shift.armeiro.nome_completo}
        </p>
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
      </div>
      <p className="text-xs text-muted-foreground">
        {shift.reserve.nome} · {duration}
      </p>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <ListChecks className="h-3 w-3" />
          {shift.evento_count} evento{shift.evento_count !== 1 ? "s" : ""}
        </span>
        {shift.pending_count > 0 ? (
          <Badge className="bg-orange-500/10 text-orange-700 border-orange-500/30 gap-1">
            <AlertTriangle className="h-3 w-3" />
            {shift.pending_count} pend.
          </Badge>
        ) : (
          <span className="text-emerald-600">0 pendências</span>
        )}
      </div>
    </button>
  );
}
