"use client";

import { useState, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { csrfHeaders } from "@/lib/csrf";
import { BookOpen, Clock, Search, RefreshCw, Loader2, ExternalLink, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Shift {
  id: string;
  status: string;
  started_at: string;
  ended_at?: string | null;
  pending_count: number;
  reserve: { id: string; nome: string };
  armeiro: { id: string; nome_completo: string; matricula: string; posto: string };
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

export function AdminLivrosClient() {
  const [shifts, setShifts]     = useState<Shift[]>([]);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const loadShifts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      const res = await bffFetch("GET", `/api/shifts?${params}`);
      setShifts(res.data?.shifts ?? []);
    } catch {
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadShifts();
  }, [loadShifts]);

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
      {/* Filtros */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar armeiro ou reserva..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          className="rounded-md border bg-white dark:bg-card px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
        >
          <option value="">Todos os status</option>
          <option value="ativo">Em andamento</option>
          <option value="encerrado">Encerrados</option>
        </select>
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
                      {formatDateTime(shift.started_at)}
                      {" · "}{duration(shift.started_at, shift.ended_at)}
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
