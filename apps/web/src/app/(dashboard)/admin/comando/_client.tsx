"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Clock, Lock, Timer, Activity, Search,
  Wrench, FileQuestion, Package, ClipboardList, Shield,
  Users, BarChart3, RefreshCw,
} from "lucide-react";
import { CommandCard } from "@/components/admin/command-card";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";
const REFRESH_MS = 60_000; // Auto-refresh a cada 60s

interface DashData {
  cautelas_ativas:              number;
  cautelas_com_item_vencido:    number;
  cautelas_sem_conferencia_90d: number;
  saidas_ativas:                number;
  saidas_com_atraso:            number;
  itens_disponiveis:            number;
  itens_em_manutencao:          number;
  itens_extraviados:            number;
  itens_sem_identificador:      number;
  solicitacoes_pendentes:       number;
  ocorrencias_abertas:          number;
  usuarios_sem_totp:            number;
  movimentacoes_24h:            number;
  passagens_em_atraso:          number;
  passagens_sem_entrante:       number;
  generated_at:                 string;
}

interface Reserve { id: string; nome: string; acronym: string }

interface Props {
  role:     string;
  token:    string;
  reserves: Reserve[];
}

export function ComandoClient({ role, token, reserves }: Props) {
  const [data,      setData]      = useState<DashData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [reserveId, setReserveId] = useState<string>("");
  const [lastAt,    setLastAt]    = useState<string>("");

  const fetchData = useCallback(async (rid: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = rid
        ? `${BFF_URL}/api/dashboard/command?reserve_id=${rid}`
        : `${BFF_URL}/api/dashboard/command`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) { setError("Erro ao carregar dados do painel"); return; }
      const d: DashData = await res.json();
      setData(d);
      setLastAt(new Date(d.generated_at).toLocaleTimeString("pt-BR", {
        hour: "2-digit", minute: "2-digit", timeZone: "America/Recife",
      }));
    } catch {
      setError("Sem conexão com o BFF");
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Initial load + auto-refresh
  useEffect(() => {
    fetchData(reserveId);
    const timer = setInterval(() => fetchData(reserveId), REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchData, reserveId]);

  const handleReserveChange = (id: string) => {
    setReserveId(id);
    fetchData(id);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="size-6 text-primary" />
            Dashboard de Comando
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Exceções e conformidade
            {lastAt && <> · atualizado às <span className="font-medium text-foreground">{lastAt}</span></>}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Filtro por reserva — apenas admin_global com múltiplas reserves */}
          {role !== "admin_reserva" && reserves.length > 1 && (
            <select
              name="reserve"
              value={reserveId}
              onChange={e => handleReserveChange(e.target.value)}
              className="h-9 rounded-xl border border-border bg-background px-3 text-sm text-foreground
                         focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
              aria-label="Filtrar por reserva"
            >
              <option value="">Todas as reservas</option>
              {reserves.map(r => (
                <option key={r.id} value={r.id}>{r.acronym} — {r.nome}</option>
              ))}
            </select>
          )}

          {/* Botão de refresh manual */}
          <button
            onClick={() => fetchData(reserveId)}
            disabled={loading}
            aria-label="Atualizar dados"
            className="h-9 w-9 rounded-xl border border-border bg-background flex items-center justify-center
                       hover:bg-muted transition-colors disabled:opacity-40"
          >
            <RefreshCw className={["size-4 text-muted-foreground", loading ? "animate-spin" : ""].join(" ")} />
          </button>
        </div>
      </div>

      {/* Estado de erro */}
      {error && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-6 flex items-center gap-4">
          <AlertTriangle className="size-6 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-medium text-destructive">{error}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Verifique a conexão com o servidor e tente novamente
            </p>
          </div>
          <button
            onClick={() => fetchData(reserveId)}
            className="ml-auto text-xs font-medium text-destructive hover:underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Grid de 14 cards de exceção — 4 colunas máx (design system) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <CommandCard
          title="Passagens em Atraso"
          count={data?.passagens_em_atraso ?? 0}
          severity={data && data.passagens_em_atraso > 0 ? "critical" : "ok"}
          icon={Clock}
          description="Passagens de serviço vencidas"
          loading={loading}
        />
        <CommandCard
          title="Sem Entrante (2h+)"
          count={data?.passagens_sem_entrante ?? 0}
          severity={data && data.passagens_sem_entrante > 0 ? "warning" : "ok"}
          icon={Timer}
          description="Passagens sem entrante atribuído"
          loading={loading}
        />
        <CommandCard
          title="Cautelas Ativas"
          count={data?.cautelas_ativas ?? 0}
          severity={data && data.cautelas_ativas > 50 ? "warning" : "info"}
          icon={Lock}
          description="Por tempo indeterminado"
          loading={loading}
        />
        <CommandCard
          title="Cautela com Item Vencido"
          count={data?.cautelas_com_item_vencido ?? 0}
          severity={data && data.cautelas_com_item_vencido > 0 ? "critical" : "ok"}
          icon={AlertTriangle}
          description="Validade do item expirada"
          loading={loading}
        />
        <CommandCard
          title="Sem Conferência (90d)"
          count={data?.cautelas_sem_conferencia_90d ?? 0}
          severity={data && data.cautelas_sem_conferencia_90d > 0 ? "warning" : "ok"}
          icon={Search}
          description="Cautelas sem revisão há 90+ dias"
          loading={loading}
        />
        <CommandCard
          title="Saídas de Turno Ativas"
          count={data?.saidas_ativas ?? 0}
          severity="info"
          icon={Activity}
          description="Materiais em uso no turno atual"
          loading={loading}
        />
        <CommandCard
          title="Saídas em Atraso"
          count={data?.saidas_com_atraso ?? 0}
          severity={data && data.saidas_com_atraso > 0 ? "critical" : "ok"}
          icon={AlertTriangle}
          description="Saídas ativas há mais de 24h"
          loading={loading}
        />
        <CommandCard
          title="Itens Extraviados"
          count={data?.itens_extraviados ?? 0}
          severity={data && data.itens_extraviados > 0 ? "critical" : "ok"}
          icon={FileQuestion}
          description="Status: extraviado no acervo"
          loading={loading}
        />
        <CommandCard
          title="Em Manutenção"
          count={data?.itens_em_manutencao ?? 0}
          severity={data && data.itens_em_manutencao > 0 ? "warning" : "ok"}
          icon={Wrench}
          description="Itens fora de operação"
          loading={loading}
        />
        <CommandCard
          title="Sem Identificador"
          count={data?.itens_sem_identificador ?? 0}
          severity={data && data.itens_sem_identificador > 0 ? "warning" : "ok"}
          icon={Package}
          description="Itens sem número de série"
          loading={loading}
        />
        <CommandCard
          title="SSA Pendentes"
          count={data?.solicitacoes_pendentes ?? 0}
          severity={data && data.solicitacoes_pendentes > 0 ? "warning" : "ok"}
          icon={ClipboardList}
          href="/admin/arsenal/solicitacoes"
          description="Solicitações aguardando aprovação"
          loading={loading}
        />
        <CommandCard
          title="Ocorrências Abertas"
          count={data?.ocorrencias_abertas ?? 0}
          severity={data && data.ocorrencias_abertas > 0 ? "warning" : "ok"}
          icon={AlertTriangle}
          href="/reserva/ocorrencias"
          description="Em aberto ou em análise"
          loading={loading}
        />
        <CommandCard
          title="Usuários Sem TOTP"
          count={data?.usuarios_sem_totp ?? 0}
          severity={
            data
              ? data.usuarios_sem_totp > 5 ? "critical"
              : data.usuarios_sem_totp > 0 ? "warning"
              : "ok"
              : "ok"
          }
          icon={Shield}
          href="/admin/usuarios?filter=sem-totp"
          description="Usuários sem 2FA configurado"
          loading={loading}
        />
        <CommandCard
          title="Movimentações (24h)"
          count={data?.movimentacoes_24h ?? 0}
          severity="info"
          icon={Users}
          description="Eventos de auditoria nas últimas 24h"
          loading={loading}
        />
      </div>

      {/* Métricas de acervo — destaque informativo */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div
          className="rounded-2xl bg-card p-4 flex items-center gap-4"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Package className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Itens Disponíveis no Acervo</p>
            <p className={["text-2xl font-bold tabular-nums", loading ? "opacity-30 animate-pulse" : ""].join(" ")}>
              {loading ? "—" : (data?.itens_disponiveis ?? 0)}
            </p>
          </div>
        </div>
        <div
          className="rounded-2xl bg-card p-4 flex items-center gap-4"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <RefreshCw className="size-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Atualização automática</p>
            <p className="text-sm font-medium text-foreground">A cada 60 segundos</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {reserveId
                ? `Filtrando: ${reserves.find(r => r.id === reserveId)?.acronym ?? "—"}`
                : "Exibindo todas as reservas"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
