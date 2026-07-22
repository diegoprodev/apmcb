"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface EventHashTooltipProps {
  eventHash: string;
  prevHash: string | null;
  className?: string;
  iconClassName?: string;
}

// Hash de integridade do evento — dado técnico, não precisa ocupar espaço
// visível na timeline. Ícone "i" revela sob demanda (pedido do usuário:
// design 80/20, não poluir a UI com texto monoespaçado ilegível para
// quem não vai auditar hash manualmente).
export function EventHashTooltip({ eventHash, prevHash, className, iconClassName }: EventHashTooltipProps) {
  return (
    <TooltipProvider delay={200}>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label="Ver hash de integridade do evento"
          className={className ?? "inline-flex shrink-0 items-center justify-center p-1 -m-1 text-muted-foreground/60 hover:text-primary transition-colors"}
        >
          <Info className={iconClassName ?? "h-3 w-3"} />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-72">
          <div className="space-y-1">
            <p className="font-mono text-[10px] break-all">{eventHash}</p>
            <p className="text-[10px] opacity-80">
              {/* Achado ALTO de code review (2026-07-21): "cadeia íntegra"
              seria uma afirmação de verificação criptográfica, mas aqui só
              checamos prevHash !== null (presença de campo, não validação).
              A verificação real existe em GET /api/public/shifts/:id/verify
              (LDS35) — este tooltip não deve overclaim isso. */}
              {prevHash ? "Encadeado ao evento anterior" : "Primeiro evento do turno (genesis)"}
            </p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
