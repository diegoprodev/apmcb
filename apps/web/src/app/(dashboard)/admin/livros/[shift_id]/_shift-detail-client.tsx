"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { csrfHeaders } from "@/lib/csrf";
import { bffFetch as bffFetchClient } from "@/lib/bff-client";
import { toast } from "sonner";
import {
  Clock, BookOpen, Hash, Shield, RefreshCw, Loader2, AlertTriangle, ChevronLeft,
  CheckCircle2, Download, FileText, FileSpreadsheet,
} from "lucide-react";
import Link from "next/link";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

type EventType =
  | "turno_assumido" | "cautela_emitida" | "cautela_devolvida"
  | "saida_autorizada" | "saida_devolvida" | "ocorrencia_registrada"
  | "solicitacao_aprovada" | "solicitacao_negada" | "inventario_divergencia"
  | "turno_encerrado" | "evento_manual";

const EVENT_CONFIG: Record<EventType, { label: string; color: string }> = {
  turno_assumido:         { label: "Turno Assumido",       color: "text-blue-600 bg-blue-500/10 border-blue-500/30" },
  cautela_emitida:        { label: "Cautela Emitida",       color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
  cautela_devolvida:      { label: "Cautela Devolvida",     color: "text-teal-600 bg-teal-500/10 border-teal-500/30" },
  saida_autorizada:       { label: "Saída Autorizada",      color: "text-indigo-600 bg-indigo-500/10 border-indigo-500/30" },
  saida_devolvida:        { label: "Saída Devolvida",       color: "text-violet-600 bg-violet-500/10 border-violet-500/30" },
  ocorrencia_registrada:  { label: "Ocorrência",            color: "text-orange-600 bg-orange-500/10 border-orange-500/30" },
  solicitacao_aprovada:   { label: "Sol. Aprovada",         color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30" },
  solicitacao_negada:     { label: "Sol. Negada",           color: "text-red-600 bg-red-500/10 border-red-500/30" },
  inventario_divergencia: { label: "Divergência",           color: "text-red-600 bg-red-500/10 border-red-500/30" },
  turno_encerrado:        { label: "Turno Encerrado",       color: "text-gray-600 bg-gray-500/10 border-gray-500/30" },
  evento_manual:          { label: "Registro Manual",       color: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30" },
};

interface Shift {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  pending_count: number;
  opening_snapshot: Record<string, unknown>;
  closing_snapshot?: Record<string, unknown> | null;
  reserve: { id: string; nome: string };
  armeiro: { id: string; nome_completo: string; matricula: string; posto: string };
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
  actor: { nome_completo: string; matricula: string; posto: string };
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function ShiftDetailClient({ shiftId }: { shiftId: string }) {
  const [shift, setShift]     = useState<Shift | null>(null);
  const [events, setEvents]   = useState<LogEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState<string>("");
  const [exporting, setExporting] = useState<"pdf" | "csv" | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [shiftRes, eventsRes] = await Promise.all([
      bffFetchClient("GET", `/api/shifts/${shiftId}`),
      bffFetchClient("GET", `/api/shifts/${shiftId}/events`),
    ]);
    setShift(shiftRes.data?.shift ?? null);
    setEvents(eventsRes.data?.events ?? []);
    setLoading(false);
  }, [shiftId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function exportJSON() {
    const payload = { shift, events, exported_at: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `livro-${shiftId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportFile(kind: "pdf" | "csv") {
    setExporting(kind);
    try {
      const res = await fetch(`${BFF_URL}/api/shifts/${shiftId}/${kind}`, {
        credentials: "include",
        headers: csrfHeaders(),
      });
      if (!res.ok) { toast.error(`Falha ao gerar ${kind.toUpperCase()}`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `livro-${shiftId.slice(0, 8)}.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(`Falha ao gerar ${kind.toUpperCase()}`);
    } finally {
      setExporting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando livro...</span>
      </div>
    );
  }

  if (!shift) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        Turno não encontrado ou acesso negado.
      </div>
    );
  }

  const filteredEvents = filter
    ? events.filter(e => e.event_type === filter)
    : events;

  const pendingCount = events.filter(e => e.is_pending && !e.resolved_at).length;

  return (
    <div className="space-y-4" data-testid="shift-detail-ready">
      {/* Nav */}
      <Link
        href="/admin/livros"
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors w-fit"
      >
        <ChevronLeft className="h-3 w-3" />
        Todos os livros
      </Link>

      {/* Cabeçalho do turno */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={
                shift.status === "ativo"
                  ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30"
                  : "bg-gray-500/10 text-gray-500 border-gray-500/30"
              }>
                {shift.status === "ativo" ? "Ativo" : "Encerrado"}
              </Badge>
              {pendingCount > 0 && (
                <Badge className="bg-orange-500/10 text-orange-700 border-orange-500/30 gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {pendingCount} pendência{pendingCount !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <h2 className="text-base font-semibold mt-2">
              {shift.armeiro.posto} {shift.armeiro.nome_completo}
            </h2>
            <p className="text-sm text-muted-foreground">
              Mat. {shift.armeiro.matricula} · {shift.reserve.nome}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground space-y-0.5">
            <p>Início: {formatDateTime(shift.started_at)}</p>
            {shift.ended_at && <p>Fim: {formatDateTime(shift.ended_at)}</p>}
            <p className="font-medium text-foreground">{events.length} eventos</p>
          </div>
        </div>

        {/* Snapshot abertura */}
        {shift.opening_snapshot && Object.keys(shift.opening_snapshot).length > 0 && (
          <div className="rounded-md bg-muted/40 p-3 grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-lg font-bold">{String(shift.opening_snapshot.total_itens ?? 0)}</div>
              <div className="text-[10px] text-muted-foreground">Itens na abertura</div>
            </div>
            <div>
              <div className="text-lg font-bold text-emerald-600">{String(shift.opening_snapshot.cautelas_ativas ?? 0)}</div>
              <div className="text-[10px] text-muted-foreground">Cautelas ativas</div>
            </div>
            <div>
              <div className="text-lg font-bold text-indigo-600">{String(shift.opening_snapshot.saidas_abertas ?? 0)}</div>
              <div className="text-[10px] text-muted-foreground">Saídas abertas</div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => exportFile("pdf")} disabled={exporting !== null} data-testid="btn-export-pdf">
            {exporting === "pdf" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
            PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportFile("csv")} disabled={exporting !== null} data-testid="btn-export-csv">
            {exporting === "csv" ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileSpreadsheet className="h-4 w-4 mr-1" />}
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportJSON} data-testid="btn-export-json">
            <Download className="h-4 w-4 mr-1" />
            JSON
          </Button>
        </div>
      </div>

      {/* Filtro de tipo */}
      <div className="flex gap-2 flex-wrap">
        {["", "cautela_emitida", "saida_autorizada", "ocorrencia_registrada", "evento_manual"].map(f => (
          <Button
            key={f || "all"}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
            className="text-xs"
          >
            {f === "" ? "Todos" : (EVENT_CONFIG[f as EventType]?.label ?? f)}
          </Button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" size="sm" onClick={loadData}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Linha do tempo */}
      {filteredEvents.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <BookOpen className="h-6 w-6 mx-auto mb-2 opacity-30" />
          Nenhum evento para o filtro selecionado
        </div>
      ) : (
        <div className="relative space-y-0">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
          {filteredEvents.map(ev => {
            const cfg = EVENT_CONFIG[ev.event_type] ?? EVENT_CONFIG.evento_manual;
            return (
              <div key={ev.id} className="relative pl-10 pb-4">
                <div className="absolute left-2.5 w-3 h-3 rounded-full border-2 border-background bg-border ring-1 ring-border" />
                <div className="rounded-lg border bg-card p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Badge className={`text-xs px-2 py-0.5 ${cfg.color}`}>{cfg.label}</Badge>
                      {ev.is_pending && !ev.resolved_at && (
                        <span className="text-xs text-orange-600 font-medium flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Pendente
                        </span>
                      )}
                      {ev.resolved_at && (
                        <span className="text-xs text-emerald-600 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Resolvida
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(ev.happened_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                  </div>
                  <p className="text-sm text-foreground">{ev.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {ev.actor.posto} {ev.actor.nome_completo} · Mat. {ev.actor.matricula}
                  </p>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 font-mono border-t pt-1.5">
                    <Hash className="h-3 w-3 shrink-0" />
                    <span className="truncate">{ev.event_hash}</span>
                    {ev.prev_hash && (
                      <span className="text-emerald-600 flex items-center gap-0.5 shrink-0">
                        <Shield className="h-3 w-3" />
                        ✓
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
