"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FilterGroupLabel } from "@/components/shared/filter-field";
import { AsyncComboBox } from "@/components/shared/async-combobox";
import { bffFetch } from "@/lib/bff-client";
import { csrfHeaders } from "@/lib/csrf";
import {
  Clock, BookOpen, RefreshCw, Loader2, ChevronDown, ChevronUp,
  ChevronLeft, FileText, FileSpreadsheet, User,
} from "lucide-react";
import { EventHashTooltip } from "@/components/livro/event-hash-tooltip";
import Link from "next/link";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format-date";

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
  evento_count: number;
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
  actor?: { nome_completo: string; matricula: string; posto?: string | null } | null;
}

interface ArmeiroOption {
  id: string;
  nome_completo: string;
  matricula: string;
}

async function searchArmeiros(query: string): Promise<ArmeiroOption[]> {
  const res = await fetch(`/api/admin/search-profiles?role=armeiro&q=${encodeURIComponent(query)}`, {
    credentials: "include",
  });
  if (!res.ok) return [];
  return res.json();
}

function duration(from: string, to?: string | null) {
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h${m.toString().padStart(2, "0")}m`;
}

export function HistoricoClient() {
  const [shifts, setShifts]       = useState<Shift[]>([]);
  const [hasMore, setHasMore]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [events, setEvents]       = useState<Record<string, LogEvent[]>>({});
  const [loadingEvents, setLoadingEvents] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo]     = useState("");
  const [exporting, setExporting] = useState<string | null>(null); // `${shiftId}:${kind}`

  // Paginação real no backend (padrão 10 → 20 → 30 "Ver mais" já usado em
  // apps/(dashboard)/reserva/saidas) — sem isso, a página buscava até 50
  // turnos de uma vez do BFF mesmo mostrando só os primeiros.
  const [displayLimit, setDisplayLimit] = useState(10);
  const [showLimitMenu, setShowLimitMenu] = useState(false);

  // Busca por armeiro — só faz sentido para quem pode ver turnos de outros
  // armeiros (admin_reserva/admin_global/auditor); o próprio armeiro só vê
  // os próprios turnos, então o filtro é escondido nesse caso (o BFF já
  // ignora armeiro_id/q para role=armeiro — privilege ceiling).
  const [role, setRole] = useState<string | null>(null);
  const [armeiroFilter, setArmeiroFilter] = useState<ArmeiroOption | null>(null);

  useEffect(() => {
    bffFetch("GET", "/api/auth/me").then((res) => {
      setRole(res.data?.user?.role ?? null);
    }).catch(() => {});
  }, []);

  async function exportShift(shiftId: string, kind: "pdf" | "csv") {
    setExporting(`${shiftId}:${kind}`);
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

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (fFrom)         params.set("from", fFrom);
      if (fTo)           params.set("to", fTo);
      if (armeiroFilter) params.set("armeiro_id", armeiroFilter.id);
      params.set("limit", String(displayLimit));
      const res = await bffFetch("GET", `/api/shifts?${params}`);
      setShifts(res.data?.shifts ?? []);
      setHasMore(!!res.data?.has_more);
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, fFrom, fTo, armeiroFilter, displayLimit]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  const hasFilters = !!(statusFilter || fFrom || fTo || armeiroFilter);
  function clearFilters() {
    setStatusFilter(""); setFFrom(""); setFTo("");
    setArmeiroFilter(null); setDisplayLimit(10);
  }

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

      <div className="flex items-center gap-2 flex-wrap">
        <FilterGroupLabel label="Status" tooltip="Filtra os turnos pelo status atual: em andamento ou já encerrados." />
        <select
          className="rounded-md border bg-white dark:bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary transition-colors"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          data-testid="select-historico-status"
        >
          <option value="">Todos os status</option>
          <option value="ativo">Em andamento</option>
          <option value="encerrado">Encerrados</option>
        </select>
        <FilterGroupLabel label="Período:" tooltip="Filtra os turnos que estiveram em andamento (abertos ou encerrados) dentro do intervalo informado." />
        <input
          type="date"
          value={fFrom}
          onChange={e => setFFrom(e.target.value)}
          className="rounded-md border bg-white dark:bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary transition-colors"
          data-testid="input-historico-from"
        />
        <input
          type="date"
          value={fTo}
          onChange={e => setFTo(e.target.value)}
          className="rounded-md border bg-white dark:bg-card px-2.5 py-1.5 text-xs outline-none focus:border-primary transition-colors"
          data-testid="input-historico-to"
        />
        {role && role !== "armeiro" && (
          <>
            <FilterGroupLabel label="Armeiro:" tooltip="Filtra os turnos por um armeiro específico. Busque por nome ou matrícula." />
            <div className="w-56">
              <AsyncComboBox<ArmeiroOption>
                testId="filter-historico-armeiro"
                selected={armeiroFilter}
                onSelect={setArmeiroFilter}
                onSearch={searchArmeiros}
                placeholder="Buscar armeiro..."
                getLabel={(a) => a.nome_completo}
                getSecondary={(a) => a.matricula}
              />
            </div>
          </>
        )}
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            Limpar filtros
          </button>
        )}
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
                  <p className="text-sm font-medium truncate">
                    {shift.reserve.nome}
                    {role && role !== "armeiro" && shift.armeiro && (
                      <span className="text-xs text-muted-foreground font-normal ml-2">
                        {[shift.armeiro.posto, shift.armeiro.nome_completo].filter(Boolean).join(" ")}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(shift.started_at, { day: "2-digit", month: "short", year: undefined, hour: "2-digit", minute: "2-digit" })}
                    {shift.ended_at && ` → ${formatDateTime(shift.ended_at, { day: "2-digit", month: "short", year: undefined, hour: "2-digit", minute: "2-digit" })}`}
                    {" · "}{duration(shift.started_at, shift.ended_at)}
                    {" · "}{shift.evento_count} evento{shift.evento_count !== 1 ? "s" : ""}
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
                <div className="flex justify-end gap-2 mb-2">
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); exportShift(shift.id, "pdf"); }}
                    disabled={exporting !== null}
                    data-testid="btn-export-pdf"
                  >
                    {exporting === `${shift.id}:pdf` ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />}
                    PDF
                  </Button>
                  <Button
                    variant="outline" size="sm" className="h-7 text-xs"
                    onClick={(e) => { e.stopPropagation(); exportShift(shift.id, "csv"); }}
                    disabled={exporting !== null}
                    data-testid="btn-export-csv"
                  >
                    {exporting === `${shift.id}:csv` ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileSpreadsheet className="h-3 w-3 mr-1" />}
                    CSV
                  </Button>
                </div>
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
                              {formatDateTime(ev.happened_at, { day: "2-digit", month: "2-digit", year: undefined, hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">{ev.description}</p>
                          {ev.actor && (
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <User className="h-2.5 w-2.5 shrink-0" />
                              <span>
                                {[ev.actor.posto, ev.actor.nome_completo].filter(Boolean).join(" ")}
                                {ev.actor.matricula ? ` · mat. ${ev.actor.matricula}` : ""}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <EventHashTooltip
                              eventHash={ev.event_hash}
                              prevHash={ev.prev_hash}
                              iconClassName="h-2.5 w-2.5"
                            />
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

      {/* Ver mais — paginação real no backend (10 → 20 → 30) */}
      {!loading && hasMore && (
        <div className="relative flex justify-end">
          <button
            data-testid="btn-ver-mais"
            type="button"
            onClick={() => setShowLimitMenu((v) => !v)}
            className="flex items-center gap-2 rounded-lg border bg-white dark:bg-card px-3 py-1.5 text-xs font-medium hover:bg-primary/10 hover:border-primary/40 transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            Ver mais
          </button>
          {showLimitMenu && (
            <div className="absolute right-0 bottom-full mb-1 z-10 rounded-lg border bg-card shadow-md overflow-hidden min-w-40">
              {[20, 30].filter((n) => n > displayLimit).map((n) => (
                <button
                  key={n}
                  data-testid={`btn-limit-${n}`}
                  type="button"
                  onClick={() => { setShowLimitMenu(false); setDisplayLimit(n); }}
                  className="block w-full px-4 py-2 text-xs text-left hover:bg-primary/10 transition-colors"
                >
                  Mostrar {n} turnos
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
