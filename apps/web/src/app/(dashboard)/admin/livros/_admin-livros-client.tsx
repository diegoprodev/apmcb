"use client";

import { useState, useEffect, useCallback, useDeferredValue, useRef } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterGroupLabel } from "@/components/shared/filter-field";
import { bffFetch } from "@/lib/bff-client";
import { BookOpen, Clock, Search, RefreshCw, Loader2, ExternalLink, AlertTriangle, ListChecks, X, Radio } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format-date";
import { useSSERefresh } from "@/hooks/use-sse-refresh";
import { ActiveShiftCard } from "@/components/livro/active-shift-card";

interface Shift {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  pending_count: number;
  evento_count: number;
  reserve: { id: string; nome: string };
  armeiro: { id: string; nome_completo: string; matricula: string; posto: string };
}


function duration(from: string, to?: string | null) {
  const ms = (to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h${m.toString().padStart(2, "0")}m`;
}

export function AdminLivrosClient() {
  const router = useRouter();
  const [shifts, setShifts]     = useState<Shift[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fFrom, setFFrom]       = useState("");
  const [fTo, setFTo]           = useState("");
  const deferredSearch = useDeferredValue(search);

  // ── "Em Serviço Agora" — grid separada, sempre status=ativo, independente
  // da paginação/filtros do Arquivo abaixo (spec de redesign, seção 4.1:
  // responde de 1 clique "quem está de plantão agora", em qualquer reserva).
  const [activeShifts, setActiveShifts] = useState<Shift[]>([]);
  const [loadingActive, setLoadingActive] = useState(true);
  const [activeShiftsError, setActiveShiftsError] = useState(false);

  const loadActiveShifts = useCallback(async () => {
    try {
      const res = await bffFetch("GET", "/api/shifts?status=ativo");
      // Achado ALTO de code review (2026-07-22): bffFetch não lança em
      // resposta HTTP não-2xx (só em falha de rede/timeout) — sem checar
      // res.ok, uma falha do servidor virava silenciosamente "ninguém de
      // plantão", um falso-negativo operacionalmente sensível pra essa tela.
      if (!res.ok) {
        setActiveShiftsError(true);
        return;
      }
      setActiveShiftsError(false);
      setActiveShifts(res.data?.shifts ?? []);
    } catch {
      setActiveShiftsError(true);
    } finally {
      setLoadingActive(false);
    }
  }, []);

  useEffect(() => {
    loadActiveShifts();
  }, [loadActiveShifts]);

  // Realtime: qualquer INSERT em service_log_events do tenant (inclui os
  // eventos turno_assumido/turno_encerrado logados automaticamente na
  // abertura/fechamento) já é sinal suficiente para re-buscar quem está de
  // plantão agora — mesmo canal tenant-wide já usado pelo armeiro em
  // _livro-client.tsx, sem infraestrutura nova (achado 1.7 do spec).
  const loadActiveShiftsRef = useRef(loadActiveShifts);
  useEffect(() => {
    loadActiveShiftsRef.current = loadActiveShifts;
  }, [loadActiveShifts]);
  const onLivroEvent = useCallback(() => {
    loadActiveShiftsRef.current();
  }, []);
  useSSERefresh("livro-sync", onLivroEvent);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter)     params.set("status", statusFilter);
      if (fFrom)             params.set("from", fFrom);
      if (fTo)               params.set("to", fTo);
      if (deferredSearch)    params.set("q", deferredSearch);
      const res = await bffFetch("GET", `/api/shifts?${params}`);
      if (!res.ok) {
        toast.error("Erro ao carregar livros de serviço");
        return;
      }
      setShifts(res.data?.shifts ?? []);
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, fFrom, fTo, deferredSearch]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

  const hasFilters = !!(search || statusFilter || fFrom || fTo);

  function clearFilters() {
    setSearch(""); setStatusFilter(""); setFFrom(""); setFTo("");
  }

  // Busca no nome/reserva já vem filtrada pelo servidor (?q=); refina localmente
  // também por matrícula/reserva para o que o back-end não cobre.
  const filtered = shifts.filter(s => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      s.armeiro.nome_completo.toLowerCase().includes(q) ||
      s.armeiro.matricula.toLowerCase().includes(q) ||
      s.reserve.nome.toLowerCase().includes(q)
    );
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40 gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Carregando livros...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="admin-livros-ready">
      {/* ── Em Serviço Agora — responde de 1 clique "quem está de plantão" ── */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5 text-emerald-600" />
            Em Serviço Agora {activeShifts.length > 0 && `(${activeShifts.length})`}
          </h2>
        </div>
        {loadingActive ? (
          <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : activeShiftsError ? (
          <div className="rounded-xl border border-dashed border-destructive/40 bg-card p-4 text-center text-sm text-destructive flex items-center justify-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Não foi possível carregar quem está de plantão
            <Button variant="ghost" size="sm" onClick={loadActiveShifts}>Tentar novamente</Button>
          </div>
        ) : activeShifts.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-4 text-center text-sm text-muted-foreground">
            Nenhum armeiro de plantão no momento
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="active-shifts-grid">
            {activeShifts.map(shift => (
              <ActiveShiftCard
                key={shift.id}
                shift={shift}
                onOpen={() => router.push(`/admin/livros/${shift.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Arquivo */}
      <h2 className="text-sm font-semibold text-muted-foreground">Arquivo</h2>
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar armeiro ou reserva..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
            data-testid="input-historico-armeiro"
          />
        </div>
        <FilterGroupLabel label="Status" tooltip="Filtra os turnos pelo status atual: em andamento ou já encerrados." />
        <select
          className="rounded-md border bg-white dark:bg-card px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">Todos os status</option>
          <option value="ativo">Em andamento</option>
          <option value="encerrado">Encerrados</option>
        </select>
        <FilterGroupLabel label="Período:" tooltip="Filtra turnos que estiveram abertos em algum momento dentro do intervalo informado — inclui turnos iniciados antes do período mas ainda ativos ou encerrados dentro dele." />
        <Input
          type="date"
          value={fFrom}
          onChange={e => setFFrom(e.target.value)}
          className="w-auto"
          data-testid="input-historico-from"
        />
        <Input
          type="date"
          value={fTo}
          onChange={e => setFTo(e.target.value)}
          className="w-auto"
          data-testid="input-historico-to"
        />
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="h-4 w-4 mr-1" />
            Limpar
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={loadShifts}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Atualizar
        </Button>
      </div>

      {/* Lista */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <BookOpen className="h-8 w-8 mx-auto mb-2 opacity-30" />
          {search ? "Nenhum resultado para a busca" : "Nenhum turno registrado"}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(shift => (
            <div
              key={shift.id}
              className="rounded-lg border bg-card p-4 flex items-center justify-between gap-4 hover:bg-accent/20 transition-colors"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Badge className={
                  shift.status === "ativo"
                    ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/30 shrink-0"
                    : "bg-gray-500/10 text-gray-500 border-gray-500/30 shrink-0"
                }>
                  {shift.status === "ativo" ? "Ativo" : "Encerrado"}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {shift.armeiro.posto} {shift.armeiro.nome_completo}
                    <span className="text-muted-foreground font-normal ml-2 text-xs">
                      Mat. {shift.armeiro.matricula}
                    </span>
                  </p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <span>{shift.reserve.nome}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDateTime(shift.started_at, { day: "2-digit", month: "short", year: undefined, hour: "2-digit", minute: "2-digit" })}
                      {" · "}{duration(shift.started_at, shift.ended_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <ListChecks className="h-3 w-3" />
                      {shift.evento_count} evento{shift.evento_count !== 1 ? "s" : ""}
                    </span>
                    {shift.pending_count > 0 && (
                      <span className="text-orange-600 flex items-center gap-1 font-medium">
                        <AlertTriangle className="h-3 w-3" />
                        {shift.pending_count} pendência{shift.pending_count !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Link href={`/admin/livros/${shift.id}`}>
                <Button variant="outline" size="sm" className="shrink-0">
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Ver Livro
                </Button>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
