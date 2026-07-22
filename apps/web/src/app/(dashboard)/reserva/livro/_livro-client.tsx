"use client";

import { useState, useEffect, useCallback, useDeferredValue, useRef, Suspense, lazy } from "react";
import { useSSERefresh, type SSEPayload } from "@/hooks/use-sse-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { bffFetch } from "@/lib/bff-client";
import { friendlyApiError } from "@/lib/api-error";
import { ShiftAuthDialog, type ShiftAuthMode } from "@/components/livro/shift-auth-dialog";
import { ReserveShiftActiveDialog, type ReserveShiftActiveArmeiro } from "@/components/livro/reserve-shift-active-dialog";
import { formatTime, formatDate } from "@/lib/format-date";
import {
  BookOpen, Clock, CheckCircle2, AlertTriangle, Play,
  Loader2, FileText,
  Search, LayoutList, AlignLeft, History, User,
} from "lucide-react";
import { EventHashTooltip } from "@/components/livro/event-hash-tooltip";
import { EVENT_TYPE_CONFIG, type EventType } from "@/lib/livro/event-type-config";
import { ShiftStatusBar } from "@/components/livro/shift-status-bar";
import { PendingRail } from "@/components/livro/pending-rail";
import { ShortcutStatCards, type ShortcutFilter } from "@/components/livro/shortcut-stat-cards";
import { EventTypeFilterChips } from "@/components/livro/event-type-filter-chips";

const HistoricoContent = lazy(() =>
  import("./historico/_historico-client").then(m => ({ default: m.HistoricoClient }))
);

interface Shift {
  id: string;
  status: "ativo" | "encerrado" | "encerrado_sem_passagem";
  started_at: string;
  ended_at?: string | null;
  pending_count: number;
  reserve: { id: string; nome: string };
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


export function LivroClient() {
  const [shift, setShift]             = useState<Shift | null>(null);
  const [events, setEvents]           = useState<LogEvent[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [showOpenDialog, setShowOpenDialog]   = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showLogDialog, setShowLogDialog]     = useState(false);
  const [reserveShiftActiveOpen, setReserveShiftActiveOpen] = useState(false);
  const [reserveShiftActiveArmeiro, setReserveShiftActiveArmeiro] = useState<ReserveShiftActiveArmeiro | null>(null);
  const [reserveShiftActiveStartedAt, setReserveShiftActiveStartedAt] = useState<string | null>(null);
  const [reserves, setReserves]       = useState<{ id: string; nome: string }[]>([]);
  const [selectedReserve, setSelectedReserve] = useState("");
  const [openObs, setOpenObs]         = useState("");
  const [closeObs, setCloseObs]       = useState("");
  const [logDesc, setLogDesc]         = useState("");
  const [logPending, setLogPending]   = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode]       = useState<"timeline" | "list">("timeline");
  const [shortcutFilter, setShortcutFilter] = useState<ShortcutFilter>("all");
  const [eventTypeFilter, setEventTypeFilter] = useState<EventType | "">("");
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("turno");
  const deferredQuery = useDeferredValue(searchQuery);

  // "now" como state (não Date.now() direto no corpo do render) — chamar uma
  // função impura durante o render viola as regras do React (pode produzir
  // valores diferentes entre múltiplas chamadas da mesma render), achado do
  // lint react-hooks/purity. Atualiza a cada 60s, suficiente para a
  // granularidade de minutos usada abaixo.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const pendingEvents = events.filter(e => e.is_pending && !e.resolved_at);
  const oldestPendingAgeMinutes = pendingEvents.length > 0
    ? Math.max(...pendingEvents.map(e => Math.floor((nowTick - new Date(e.happened_at).getTime()) / 60_000)))
    : null;

  const filteredEvents = events
    .filter(ev => shortcutFilter === "all" || (shortcutFilter === "pending" ? (ev.is_pending && !ev.resolved_at) : ev.event_type === "cautela_emitida"))
    .filter(ev => eventTypeFilter === "" || ev.event_type === eventTypeFilter)
    .filter(ev => {
      if (!deferredQuery) return true;
      const q = deferredQuery.toLowerCase();
      return (
        ev.description.toLowerCase().includes(q) ||
        ev.event_type.toLowerCase().includes(q) ||
        (ev.actor?.nome_completo ?? "").toLowerCase().includes(q) ||
        (ev.actor?.matricula ?? "").toLowerCase().includes(q)
      );
    });

  // PendingRail fica visível em QUALQUER aba (fora de <Tabs>) — se o usuário
  // clicar numa pendência estando na aba "Histórico", o elemento do evento
  // não existe no DOM (o painel "Turno Atual" só monta quando ativo). Por
  // isso `handleJumpToEvent` força a volta pra aba "Turno Atual" (Tabs
  // controlada via activeTab) antes de tentar rolar — sem isso, o clique
  // falharia silenciosamente nesse cenário (achado de auto-revisão 2026-07-22).
  function handleJumpToEvent(eventId: string) {
    setActiveTab("turno");
    setShortcutFilter("all");
    setEventTypeFilter("");
    setSearchQuery("");
    setHighlightedEventId(eventId);
  }

  useEffect(() => {
    if (!highlightedEventId) return;
    // Roda depois do commit da troca de aba/filtros acima — garante que o
    // elemento já está montado no DOM antes de tentar rolar até ele.
    const frame = requestAnimationFrame(() => {
      document.getElementById(`event-${highlightedEventId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timeout = setTimeout(() => setHighlightedEventId(null), 2000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [highlightedEventId]);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const [shiftRes, reservesRes] = await Promise.all([
        bffFetch("GET", "/api/shifts/active"),
        bffFetch("GET", "/api/profiles/me/reserves"),
      ]);

      if (!shiftRes.ok || !reservesRes.ok) {
        toast.error("Erro ao carregar dados do livro");
        return;
      }

      const activeShift: Shift | null = shiftRes.data?.shift ?? null;
      setShift(activeShift);
      setReserves(reservesRes.data?.reserves ?? []);

      if (activeShift) {
        const eventsRes = await bffFetch("GET", `/api/shifts/${activeShift.id}/events`);
        setEvents(eventsRes.data?.events ?? []);
      } else {
        setEvents([]);
      }
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime via SSE do BFF (iron-session HttpOnly — não usa supabase.auth.getSession()
  // no browser, que retorna null desde a migração dos cookies sb-* para HttpOnly).
  // O canal é tenant-wide; filtramos client-side pelo shift_id ativo via refs (onEvent
  // do useSSERefresh precisa de referência estável — ver hooks/use-sse-refresh.ts).
  const shiftIdRef = useRef<string | undefined>(shift?.id);
  const loadDataRef = useRef(loadData);

  useEffect(() => {
    shiftIdRef.current = shift?.id;
  }, [shift?.id]);

  useEffect(() => {
    loadDataRef.current = loadData;
  }, [loadData]);

  const onLivroEvent = useCallback((payload: SSEPayload) => {
    const row = payload.row as { shift_id?: string } | undefined;
    if (payload.table === "service_log_events" && row?.shift_id === shiftIdRef.current) {
      loadDataRef.current(true);
    }
  }, []);

  useSSERefresh(shift?.id ? "livro-sync" : "", onLivroEvent);

  async function handleOpenShift(authMode: ShiftAuthMode, totpToken?: string) {
    setSubmitting(true);
    try {
      const res = await bffFetch("POST", "/api/shifts/open", {
        reserve_id: selectedReserve,
        observacao_abertura: openObs || undefined,
        auth_mode: authMode,
        totp_token: totpToken,
      });
      if (res.ok) {
        toast.success("Turno aberto com sucesso");
        setShowOpenDialog(false);
        setOpenObs("");
        setSelectedReserve("");
        loadData();
      } else {
        const errCode = res.data?.error;
        if (errCode === "TOTP_NOT_CONFIGURED") {
          toast.error("Configure seu TOTP no perfil antes de assumir um turno.");
        } else if (errCode === "BIOMETRIC_NOT_REGISTERED") {
          toast.error("Biometria não cadastrada. Registre sua digital na administração.");
        } else if (errCode === "RESERVE_SHIFT_ACTIVE") {
          // Reserva já tem turno ativo com outro armeiro — dialog amigável e
          // centralizado em vez de toast genérico (a reserva/o arsenal é
          // compartilhado, então isso é esperado, não um erro técnico).
          setShowOpenDialog(false);
          setReserveShiftActiveArmeiro(res.data?.armeiro ?? null);
          setReserveShiftActiveStartedAt(res.data?.started_at ?? null);
          setReserveShiftActiveOpen(true);
        } else {
          console.error("[livro] falha ao abrir turno", { status: res.status, error: errCode });
          toast.error(friendlyApiError(res.status, errCode, "Erro ao abrir turno"));
        }
      }
    } catch (err) {
      console.error("[livro] erro de conexão ao abrir turno", err);
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloseShift(authMode: ShiftAuthMode, totpToken?: string) {
    if (!shift) return;
    setSubmitting(true);
    try {
      const res = await bffFetch("POST", `/api/shifts/${shift.id}/close`, {
        observacao_encerramento: closeObs || undefined,
        auth_mode: authMode,
        totp_token: totpToken,
      });
      if (res.ok) {
        toast.success("Turno encerrado");
        setShowCloseDialog(false);
        setCloseObs("");
        loadData();
      } else {
        console.error("[livro] falha ao encerrar turno", { status: res.status, error: res.data?.error });
        toast.error(friendlyApiError(res.status, res.data?.error, "Erro ao encerrar turno"));
      }
    } catch (err) {
      console.error("[livro] erro de conexão ao encerrar turno", err);
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogEvent() {
    if (!shift || !logDesc.trim()) return;
    setSubmitting(true);
    try {
      const res = await bffFetch("POST", `/api/shifts/${shift.id}/log`, {
        description: logDesc.trim(),
        event_type: "evento_manual",
        is_pending: logPending,
      });
      if (res.ok) {
        toast.success("Evento registrado");
        setShowLogDialog(false);
        setLogDesc("");
        setLogPending(false);
        loadData(true);
      } else {
        console.error("[livro] falha ao registrar evento", { status: res.status, error: res.data?.error });
        toast.error(friendlyApiError(res.status, res.data?.error, "Erro ao registrar evento"));
      }
    } catch (err) {
      console.error("[livro] erro de conexão ao registrar evento", err);
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando livro de serviço...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="livro-ready">
      {/* ── Status do turno — sempre visível, fora das abas (achado central
      do redesign 2026-07-21: antes sumia ao trocar para "Histórico") ── */}
      <ShiftStatusBar
        shift={shift}
        pendingCount={pendingEvents.length}
        oldestPendingAgeMinutes={oldestPendingAgeMinutes}
        onAssumir={() => setShowOpenDialog(true)}
        onEncerrar={() => setShowCloseDialog(true)}
        onRegistrar={() => setShowLogDialog(true)}
        refreshing={refreshing}
        onRefresh={() => loadData(true)}
      />
      {shift && <PendingRail pendingEvents={pendingEvents} onJumpTo={handleJumpToEvent} />}

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(String(v))}>
        <TabsList variant="line">
          <TabsTrigger value="turno" className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            Turno Atual
          </TabsTrigger>
          <TabsTrigger value="historico" className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            Histórico
          </TabsTrigger>
        </TabsList>

        {/* ── Aba: Turno Atual ── */}
        <TabsContent value="turno" className="space-y-4 mt-4">

      {/* ── Cards de atalho — clicáveis de verdade (achado 1.2: eram
      decorativos, violação do princípio de cards de atalho do CLAUDE.md) ── */}
      {shift && (
        <ShortcutStatCards
          eventos={events.length}
          pendencias={pendingEvents.length}
          cautelas={events.filter(e => e.event_type === "cautela_emitida").length}
          activeFilter={shortcutFilter}
          onSelect={setShortcutFilter}
        />
      )}

      {/* ── Linha do tempo ── */}
      {shift ? (
        <>
          {/* Filtro por tipo + busca + toggle view */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <EventTypeFilterChips value={eventTypeFilter} onChange={setEventTypeFilter} />
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar eventos, tipo, militar..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-sm"
                data-testid="input-busca-eventos"
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setViewMode(v => v === "timeline" ? "list" : "timeline")}
              title={viewMode === "timeline" ? "Ver como lista" : "Ver como linha do tempo"}
              data-testid="btn-toggle-view"
            >
              {viewMode === "timeline" ? <LayoutList className="h-4 w-4" /> : <AlignLeft className="h-4 w-4" />}
            </Button>
          </div>

          {events.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
              Nenhum evento ainda neste turno
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              Nenhum evento corresponde à busca
            </div>
          ) : viewMode === "list" ? (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Data/Hora</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Tipo</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Descrição</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground">Registrado por</th>
                    <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredEvents.map(ev => {
                    const cfg = EVENT_TYPE_CONFIG[ev.event_type] ?? EVENT_TYPE_CONFIG.evento_manual;
                    return (
                      <tr
                        key={ev.id}
                        id={`event-${ev.id}`}
                        className={`hover:bg-accent/30 transition-colors ${highlightedEventId === ev.id ? "bg-primary/10" : ""}`}
                      >
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(ev.happened_at, { day: "2-digit", month: "short", year: "numeric" })} {formatTime(ev.happened_at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                        <td className="px-3 py-2">
                          <Badge className={`text-xs px-1.5 py-0 ${cfg.colorClass}`}>{cfg.label}</Badge>
                        </td>
                        <td className="px-3 py-2 text-foreground max-w-xs truncate">{ev.description}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                          {ev.actor ? `${[ev.actor.posto, ev.actor.nome_completo].filter(Boolean).join(" ")}` : "—"}
                        </td>
                        <td className="px-3 py-2">
                          <EventHashTooltip eventHash={ev.event_hash} prevHash={ev.prev_hash} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="relative space-y-0">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-green-500/40" />
              {filteredEvents.map((ev) => {
                const cfg = EVENT_TYPE_CONFIG[ev.event_type] ?? EVENT_TYPE_CONFIG.evento_manual;
                return (
                  <div key={ev.id} id={`event-${ev.id}`} className="relative pl-10 pb-4">
                    <div className="absolute left-2.5 w-3 h-3 rounded-full border-2 border-background bg-green-500 ring-1 ring-green-500/30" />
                    <div className={`rounded-lg border border-l-4 border-l-green-500 bg-card p-3 space-y-1.5 hover:bg-accent/30 transition-colors ${highlightedEventId === ev.id ? "ring-2 ring-primary" : ""}`}>
                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <Badge className={`text-xs px-2 py-0.5 ${cfg.colorClass}`}>
                          {cfg.label}
                        </Badge>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          {ev.is_pending && !ev.resolved_at && (
                            <span className="text-orange-600 font-medium flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3" />
                              Pendente
                            </span>
                          )}
                          <Clock className="h-3 w-3" />
                          <span>{formatDate(ev.happened_at, { day: "2-digit", month: "short", year: "numeric" })} {formatTime(ev.happened_at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                        </div>
                      </div>
                      <p className="text-sm text-foreground">{ev.description}</p>
                      {ev.actor && (
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <User className="h-3 w-3 shrink-0" />
                          <span>
                            {[ev.actor.posto, ev.actor.nome_completo].filter(Boolean).join(" ")}
                            {ev.actor.matricula ? ` · mat. ${ev.actor.matricula}` : ""}
                          </span>
                        </div>
                      )}
                      <div className="flex items-center gap-1">
                        <EventHashTooltip eventHash={ev.event_hash} prevHash={ev.prev_hash} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center space-y-3">
          <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <div>
            <p className="font-medium text-foreground">Você não tem turno ativo</p>
            <p className="text-sm text-muted-foreground mt-1">
              Assuma um turno para iniciar o registro automático de todos os eventos
            </p>
          </div>
          <Button onClick={() => setShowOpenDialog(true)}>
            <Play className="h-4 w-4 mr-1" />
            Assumir Turno Agora
          </Button>
        </div>
      )}

        </TabsContent>

        {/* ── Aba: Histórico de Turnos ── */}
        <TabsContent value="historico" className="mt-4">
          <Suspense fallback={
            <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Carregando histórico...</span>
            </div>
          }>
            <HistoricoContent />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* ── Dialog: Assumir turno (com autenticação TOTP/biometria) ── */}
      <ShiftAuthDialog
        open={showOpenDialog}
        title="Assumir Turno de Serviço"
        description="Autentique-se para iniciar o registro do turno. Um snapshot do arsenal será gerado."
        confirmLabel="Assumir Turno"
        confirmDisabled={!selectedReserve}
        submitting={submitting}
        onConfirm={handleOpenShift}
        onCancel={() => { setShowOpenDialog(false); setOpenObs(""); setSelectedReserve(""); }}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Reserva</Label>
            <select
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={selectedReserve}
              onChange={e => setSelectedReserve(e.target.value)}
            >
              <option value="">Selecione a reserva...</option>
              {reserves.map(r => (
                <option key={r.id} value={r.id}>{r.nome}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Observação de abertura (opcional)</Label>
            <Textarea
              value={openObs}
              onChange={e => setOpenObs(e.target.value)}
              placeholder="Ex: Assumi o turno. Arsenal conferido."
              rows={2}
              maxLength={500}
            />
          </div>
        </div>
      </ShiftAuthDialog>

      {/* ── Dialog: Encerrar turno (com autenticação TOTP/biometria) ── */}
      <ShiftAuthDialog
        open={showCloseDialog}
        title="Encerrar Turno"
        description="Autentique-se para confirmar o encerramento. Um snapshot final será registrado."
        confirmLabel="Encerrar Turno"
        confirmVariant="destructive"
        submitting={submitting}
        onConfirm={handleCloseShift}
        onCancel={() => { setShowCloseDialog(false); setCloseObs(""); }}
      >
        <div className="space-y-3">
          {events.filter(e => e.is_pending && !e.resolved_at).length > 0 && (
            <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 p-3 flex gap-2 text-sm text-orange-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Existem <strong>{events.filter(e => e.is_pending && !e.resolved_at).length} pendências</strong> em aberto.
                Verifique antes de encerrar.
              </span>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Observação de encerramento (opcional)</Label>
            <Textarea
              value={closeObs}
              onChange={e => setCloseObs(e.target.value)}
              placeholder="Ex: Turno encerrado sem ocorrências. Arsenal conferido."
              rows={2}
              maxLength={500}
            />
          </div>
        </div>
      </ShiftAuthDialog>

      {/* ── Dialog: Registrar evento manual ── */}
      <Dialog open={showLogDialog} onOpenChange={setShowLogDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Registrar Evento
            </DialogTitle>
            <DialogDescription>
              Registre uma ocorrência, observação ou incidente no livro de serviço.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Descrição *</Label>
              <Textarea
                value={logDesc}
                onChange={e => setLogDesc(e.target.value)}
                placeholder="Descreva o evento ou observação..."
                rows={4}
                maxLength={1000}
              />
              <p className="text-xs text-muted-foreground text-right">{logDesc.length}/1000</p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={logPending}
                onChange={e => setLogPending(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-foreground">Marcar como pendência (requer resolução)</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLogDialog(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleLogEvent} disabled={submitting || !logDesc.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: reserva já tem turno ativo com outro armeiro ── */}
      <ReserveShiftActiveDialog
        open={reserveShiftActiveOpen}
        onCancel={() => setReserveShiftActiveOpen(false)}
        armeiro={reserveShiftActiveArmeiro}
        startedAt={reserveShiftActiveStartedAt}
      />
    </div>
  );
}
