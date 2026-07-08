"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { csrfHeaders } from "@/lib/csrf";
import {
  Clock, BookOpen, CheckCircle2, RefreshCw, Loader2, ChevronDown, ChevronUp,
  Hash, Shield, AlertTriangle, ChevronLeft,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

type EventType =
  | "turno_assumido" | "cautela_emitida" | "cautela_devolvida"
  | "saida_autorizada" | "saida_devolvida" | "ocorrencia_registrada"
  | "solicitacao_aprovada" | "solicitacao_negada" | "inventario_divergencia"
  | "turno_encerrado" | "evento_manual";

const EVENT_LABEL: Record<EventType, string> = {
  turno_assumido:         "Turno Assumido",
  cautela_emitida:        "Cautela Emitida",
  cautela_devolvida:      "Cautela Devolvida",
  saida_autorizada:       "Saída Autorizada",
  saida_devolvida:        "Saída Devolvida",
  ocorrencia_registrada:  "Ocorrência",
  solicitacao_aprovada:   "Solicitação Aprovada",
  solicitacao_negada:     "Solicitação Negada",
  inventario_divergencia: "Divergência Inventário",
  turno_encerrado:        "Turno Encerrado",
  evento_manual:          "Registro Manual",
};

interface Shift {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  pending_count: number;
  reserve: { id: string; nome: string };
  armeiro: { nome_completo: string; matricula: string; posto: string };
}

interface LogEvent {
  id: string;
  happened_at: string;
  event_type: EventType;
  description: string;
  is_pending: boolean;
  resolved_at: string | null;
  event_hash: string;
  prev_hash: string | null;
}

async function bffFetch(method: string, path: string) {
  const headers = new Headers(csrfHeaders());
  headers.set("Content-Type", "application/json");
  const res = await fetch(`${BFF_URL}${path}`, { method, credentials: "include", headers });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function duration(from: string, to?: string | null) {
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h${m.toString().padStart(2, "0")}m`;
}

export function HistoricoClient() {
  const [shifts, setShifts]       = useState<Shift[]>([]);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [events, setEvents]       = useState<Record<string, LogEvent[]>>({});
  const [loadingEvents, setLoadingEvents] = useState<string | null>(null);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await bffFetch("GET", "/api/shifts");
      setShifts(res.data?.shifts ?? []);
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  async function toggleExpand(shiftId: string) {
    if (expanded === shiftId) {
      setExpanded(null);
      return;
    }
    setExpanded(shiftId);
    if (!events[shiftId]) {
      setLoadingEvents(shiftId);
      try {
        const res = await bffFetch("GET", `/api/shifts/${shiftId}/events`);
        setEvents(prev => ({ ...prev, [shiftId]: res.data?.events ?? [] }));
      } catch {
        toast.error("Erro ao carregar eventos do turno.");
      } finally {
        setLoadingEvents(null);
      }
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando histórico...</span>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="historico-ready">
      <div className="flex items-center justify-between">
        <Link
          href="/reserva/livro"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
        >
          <ChevronLeft className="h-3 w-3" />
          Turno atual
        </Link>
        <Button variant="ghost" size="sm" onClick={loadShifts}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Atualizar
        </Button>
      </div>

      {shifts.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
          Nenhum turno registrado ainda
        </div>
      ) : (
        shifts.map(shift => (
          <div key={shift.id} className="rounded-lg border bg-card overflow-hidden">
            <button
              className="w-full p-4 flex items-center justify-between gap-3 hover:bg-accent/30 transition-colors text-left"
              onClick={() => toggleExpand(shift.id)}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Badge className={
                  shift.status === "ativo"
                    ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                    : "bg-gray-500/10 text-gray-500 border-gray-500/30"
                }>
                  {shift.status === "ativo" ? "Ativo" : "Encerrado"}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{shift.reserve.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(shift.started_at)}
                    {shift.ended_at && ` → ${formatDateTime(shift.ended_at)}`}
                    {" · "}{duration(shift.started_at, shift.ended_at)}
                  </p>
                </div>
              </div>
              {expanded === shift.id
                ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
                : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
              }
            </button>

            {expanded === shift.id && (
              <div className="border-t px-4 pb-4 pt-3 bg-muted/20">
                {loadingEvents === shift.id ? (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando eventos...
                  </div>
                ) : (events[shift.id] ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">Nenhum evento neste turno.</p>
                ) : (
                  <div className="relative space-y-0 mt-1">
                    <div className="absolute left-3 top-0 bottom-0 w-px bg-border" />
                    {(events[shift.id] ?? []).map(ev => (
                      <div key={ev.id} className="relative pl-8 pb-3">
                        <div className="absolute left-1.5 w-3 h-3 rounded-full border-2 border-background bg-border" />
                        <div className="rounded-md border bg-background p-2.5 space-y-1">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-xs font-medium text-foreground">
                              {EVENT_LABEL[ev.event_type] ?? ev.event_type}
                            </span>
                            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <Clock className="h-2.5 w-2.5" />
                              {new Date(ev.happened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{ev.description}</p>
                          <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground/60 font-mono">
                            <Hash className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{ev.event_hash.substring(0, 20)}…</span>
                            {ev.prev_hash && (
                              <Shield className="h-2.5 w-2.5 text-emerald-600 shrink-0" />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
