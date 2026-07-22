"use client";

import { CheckCircle2, ChevronRight } from "lucide-react";
import { EVENT_TYPE_CONFIG, type EventType } from "@/lib/livro/event-type-config";

interface PendingRailEvent {
  id: string;
  event_type: EventType;
  description: string;
  happened_at: string;
}

interface PendingRailProps {
  pendingEvents: PendingRailEvent[];
  onJumpTo: (eventId: string) => void;
}

function ageLabel(happenedAt: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(happenedAt).getTime()) / 60_000));
  if (minutes < 60) return `há ${minutes}min`;
  return `há ${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

// Painel dedicado de pendências — resolve o achado 1.5 do spec de redesign:
// antes, a única forma de achar todas as pendências era rolar a timeline
// inteira lendo badge por badge. Reserva altura mínima mesmo vazio (linha
// "Nenhuma pendência aberta" sempre ocupa o espaço) para não causar layout
// shift ao abrir/fechar pendências durante o turno.
export function PendingRail({ pendingEvents, onJumpTo }: PendingRailProps) {
  return (
    <div id="pending-rail" className="rounded-xl border bg-card p-3">
      {pendingEvents.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          Nenhuma pendência aberta
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Pendências abertas ({pendingEvents.length})
          </p>
          <ul className="space-y-1">
            {pendingEvents.map(ev => {
              const cfg = EVENT_TYPE_CONFIG[ev.event_type] ?? EVENT_TYPE_CONFIG.evento_manual;
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => onJumpTo(ev.id)}
                    className="w-full flex items-center gap-2 text-left text-sm rounded-md px-2 py-1.5 hover:bg-accent/50 transition-colors"
                  >
                    <cfg.Icon className="h-3.5 w-3.5 shrink-0 text-orange-600" />
                    <span className="flex-1 truncate">{ev.description}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{ageLabel(ev.happened_at)}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
