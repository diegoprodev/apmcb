"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Square, FileText, RefreshCw, AlertTriangle } from "lucide-react";
import { formatDate, formatTime } from "@/lib/format-date";
import { useLiveDuration } from "@/hooks/use-live-duration";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ShiftStatusBarShift {
  started_at: string;
  reserve: { nome: string };
}

interface ShiftStatusBarProps {
  shift: ShiftStatusBarShift | null;
  pendingCount: number;
  oldestPendingAgeMinutes: number | null;
  onAssumir: () => void;
  onEncerrar: () => void;
  onRegistrar: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}

// Sempre visível, fora de qualquer TabsContent — resolve o achado central do
// spec de redesign (2026-07-21): o status do turno sumia ao trocar para a
// aba "Histórico". Mantém o texto "Turno Ativo — {reserva}" / "Sem turno
// ativo" idêntico ao anterior (contrato de vários testes E2E existentes,
// ex: LDS02/LDS09/LDS30, que fazem getByText(/turno ativo —/i)).
export function ShiftStatusBar({
  shift, pendingCount, oldestPendingAgeMinutes,
  onAssumir, onEncerrar, onRegistrar, refreshing, onRefresh,
}: ShiftStatusBarProps) {
  // Fallback estático (não new Date()) quando shift é null — o valor nunca é
  // exibido nesse caso (gated por `{shift && ...}` abaixo), mas useLiveDuration
  // sempre precisa de uma string; um fallback impuro violaria a mesma regra
  // de pureza de render já documentada em _livro-client.tsx (nowTick).
  const duration = useLiveDuration(shift?.started_at ?? "1970-01-01T00:00:00.000Z");
  const pendingColorClass = oldestPendingAgeMinutes !== null && oldestPendingAgeMinutes >= 120
    ? "bg-red-500/10 text-red-700 border-red-500/30"
    : "bg-orange-500/10 text-orange-700 border-orange-500/30";

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-3 flex-wrap">
        {shift ? (
          <Badge className="bg-emerald-500/10 text-emerald-700 border-emerald-500/30 gap-1.5 text-sm px-3 py-1">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Turno Ativo — {shift.reserve.nome}
          </Badge>
        ) : (
          <Badge className="bg-gray-500/10 text-gray-500 border-gray-500/30 gap-1.5 text-sm px-3 py-1">
            <span className="w-2 h-2 rounded-full bg-gray-400" />
            Sem turno ativo
          </Badge>
        )}
        {shift && (
          <TooltipProvider delay={200}>
            <Tooltip>
              <TooltipTrigger type="button" className="text-xs text-muted-foreground p-1 -m-1">
                {duration}
              </TooltipTrigger>
              <TooltipContent side="top">
                Início: {formatDate(shift.started_at, { day: "2-digit", month: "short", year: "numeric" })} {formatTime(shift.started_at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {shift && pendingCount > 0 && (
          <button
            type="button"
            onClick={() => document.getElementById("pending-rail")?.scrollIntoView({ behavior: "smooth", block: "center" })}
            className="focus:outline-none"
            aria-label={`${pendingCount} pendência${pendingCount !== 1 ? "s" : ""} — ver detalhes`}
          >
            <Badge className={`gap-1 ${pendingColorClass}`}>
              <AlertTriangle className="h-3 w-3" />
              {pendingCount} pendência{pendingCount !== 1 ? "s" : ""}
            </Badge>
          </button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing} className="md:px-3 px-2" aria-label="Atualizar">
          <RefreshCw className={`h-4 w-4 md:mr-1 ${refreshing ? "animate-spin" : ""}`} />
          <span className="hidden md:inline">Atualizar</span>
        </Button>
        {shift && (
          <>
            <Button variant="outline" size="sm" onClick={onRegistrar}>
              <FileText className="h-4 w-4 mr-1" />
              Registrar
            </Button>
            <Button variant="destructive" size="sm" onClick={onEncerrar}>
              <Square className="h-4 w-4 mr-1" />
              Encerrar Turno
            </Button>
          </>
        )}
        {!shift && (
          <Button size="sm" onClick={onAssumir}>
            <Play className="h-4 w-4 mr-1" />
            Assumir Turno
          </Button>
        )}
      </div>
    </div>
  );
}
