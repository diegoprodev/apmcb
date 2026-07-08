"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { bffFetch } from "@/lib/bff-client";
import {
  BookOpen, Clock, CheckCircle2, AlertTriangle, Lock, Play, Square,
  Hash, Shield, RefreshCw, Loader2, ExternalLink, FileText, ChevronRight,
} from "lucide-react";
import Link from "next/link";

type EventType =
  | "turno_assumido" | "cautela_emitida" | "cautela_devolvida"
  | "saida_autorizada" | "saida_devolvida" | "ocorrencia_registrada"
  | "solicitacao_aprovada" | "solicitacao_negada" | "inventario_divergencia"
  | "turno_encerrado" | "evento_manual";

const EVENT_CONFIG: Record<EventType, { label: string; color: string; icon: string }> = {
  turno_assumido:          { label: "Turno Assumido",       color: "text-blue-600 bg-blue-500/10 border-blue-500/30",      icon: "▶" },
  cautela_emitida:         { label: "Cautela Emitida",       color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30", icon: "📋" },
  cautela_devolvida:       { label: "Cautela Devolvida",     color: "text-teal-600 bg-teal-500/10 border-teal-500/30",      icon: "✓" },
  saida_autorizada:        { label: "Saída Autorizada",      color: "text-indigo-600 bg-indigo-500/10 border-indigo-500/30", icon: "↗" },
  saida_devolvida:         { label: "Saída Devolvida",       color: "text-violet-600 bg-violet-500/10 border-violet-500/30", icon: "↩" },
  ocorrencia_registrada:   { label: "Ocorrência",            color: "text-orange-600 bg-orange-500/10 border-orange-500/30", icon: "⚠" },
  solicitacao_aprovada:    { label: "Solicitação Aprovada",  color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30", icon: "✓" },
  solicitacao_negada:      { label: "Solicitação Negada",    color: "text-red-600 bg-red-500/10 border-red-500/30",         icon: "✗" },
  inventario_divergencia:  { label: "Divergência Inventário", color: "text-red-600 bg-red-500/10 border-red-500/30",        icon: "!" },
  turno_encerrado:         { label: "Turno Encerrado",       color: "text-gray-600 bg-gray-500/10 border-gray-500/30",      icon: "■" },
  evento_manual:           { label: "Registro Manual",       color: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30", icon: "📝" },
};

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


function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function LivroClient() {
  const [shift, setShift]             = useState<Shift | null>(null);
  const [events, setEvents]           = useState<LogEvent[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [showOpenDialog, setShowOpenDialog]   = useState(false);
  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [showLogDialog, setShowLogDialog]     = useState(false);
  const [reserves, setReserves]       = useState<{ id: string; nome: string }[]>([]);
  const [selectedReserve, setSelectedReserve] = useState("");
  const [openObs, setOpenObs]         = useState("");
  const [closeObs, setCloseObs]       = useState("");
  const [logDesc, setLogDesc]         = useState("");
  const [logPending, setLogPending]   = useState(false);
  const [submitting, setSubmitting]   = useState(false);

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

  async function handleOpenShift() {
    if (!selectedReserve) { toast.error("Selecione a reserva"); return; }
    setSubmitting(true);
    try {
      const res = await bffFetch("POST", "/api/shifts/open", {
        reserve_id: selectedReserve,
        observacao_abertura: openObs || undefined,
      });
      if (res.ok) {
        toast.success("Turno aberto com sucesso");
        setShowOpenDialog(false);
        setOpenObs("");
        setSelectedReserve("");
        loadData();
      } else {
        toast.error(res.data?.error ?? "Erro ao abrir turno");
      }
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloseShift() {
    if (!shift) return;
    setSubmitting(true);
    try {
      const res = await bffFetch("POST", `/api/shifts/${shift.id}/close`, {
        observacao_encerramento: closeObs || undefined,
      });
      if (res.ok) {
        toast.success("Turno encerrado");
        setShowCloseDialog(false);
        setCloseObs("");
        loadData();
      } else {
        toast.error(res.data?.error ?? "Erro ao encerrar turno");
      }
    } catch {
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
        toast.error(res.data?.error ?? "Erro ao registrar evento");
      }
    } catch {
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

      {/* ── Cabeçalho com status do turno ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
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
            <span className="text-xs text-muted-foreground">
              Início: {formatDate(shift.started_at)} {formatTime(shift.started_at)}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => loadData(true)} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${refreshing ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          {shift && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowLogDialog(true)}>
                <FileText className="h-4 w-4 mr-1" />
                Registrar
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setShowCloseDialog(true)}>
                <Square className="h-4 w-4 mr-1" />
                Encerrar Turno
              </Button>
            </>
          )}
          {!shift && (
            <Button size="sm" onClick={() => setShowOpenDialog(true)}>
              <Play className="h-4 w-4 mr-1" />
              Assumir Turno
            </Button>
          )}
        </div>
      </div>

      {/* ── Stats rápidas ── */}
      {shift && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card p-3 text-center">
            <div className="text-2xl font-bold">{events.length}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Eventos</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <div className="text-2xl font-bold text-orange-600">
              {events.filter(e => e.is_pending && !e.resolved_at).length}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Pendências</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <div className="text-2xl font-bold text-blue-600">
              {events.filter(e => e.event_type === "cautela_emitida").length}
            </div>
            <div className="text-xs text-muted-foreground mt-0.5">Cautelas</div>
          </div>
        </div>
      )}

      {/* ── Linha do tempo ── */}
      {shift ? (
        events.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
            Nenhum evento ainda neste turno
          </div>
        ) : (
          <div className="relative space-y-0">
            <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
            {events.map((ev) => {
              const cfg = EVENT_CONFIG[ev.event_type] ?? EVENT_CONFIG.evento_manual;
              return (
                <div key={ev.id} className="relative pl-10 pb-4">
                  <div className="absolute left-2.5 w-3 h-3 rounded-full border-2 border-background bg-border ring-1 ring-border" />
                  <div className="rounded-lg border bg-card p-3 space-y-1.5 hover:bg-accent/30 transition-colors">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <Badge className={`text-xs px-2 py-0.5 ${cfg.color}`}>
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
                        {formatTime(ev.happened_at)}
                      </div>
                    </div>
                    <p className="text-sm text-foreground">{ev.description}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                      <Hash className="h-3 w-3 shrink-0" />
                      <span className="truncate">{ev.event_hash.substring(0, 24)}…</span>
                      {ev.prev_hash && (
                        <span className="text-emerald-600 flex items-center gap-0.5">
                          <Shield className="h-3 w-3" />
                          encadeado
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
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

      {/* ── Link histórico ── */}
      {shift && (
        <div className="flex justify-end">
          <Link
            href="/reserva/livro/historico"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            Ver histórico de turnos anteriores
            <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {/* ── Dialog: Assumir turno ── */}
      <Dialog open={showOpenDialog} onOpenChange={setShowOpenDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Play className="h-5 w-5 text-emerald-600" />
              Assumir Turno de Serviço
            </DialogTitle>
            <DialogDescription>
              Um snapshot do arsenal será registrado na abertura do turno.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
                rows={3}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowOpenDialog(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleOpenShift} disabled={submitting || !selectedReserve}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Play className="h-4 w-4 mr-1" />}
              Assumir Turno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Encerrar turno ── */}
      <Dialog open={showCloseDialog} onOpenChange={setShowCloseDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Square className="h-5 w-5" />
              Encerrar Turno
            </DialogTitle>
            <DialogDescription>
              O turno será encerrado e um snapshot final será registrado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
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
                rows={3}
                maxLength={500}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCloseDialog(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleCloseShift} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Lock className="h-4 w-4 mr-1" />}
              Encerrar Turno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
    </div>
  );
}
