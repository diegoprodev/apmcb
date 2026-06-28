"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Plus, RefreshCw, AlertTriangle } from "lucide-react";
import { HandoverCard } from "@/components/reserva/handover-card";
import { Button } from "@/components/ui/button";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface HandoverRow {
  id:           string;
  status:       string;
  created_at:   string;
  prazo_assumcao?: string | null;
  reserve:      { nome: string; acronym: string } | null;
  saindo:       { nome_completo: string } | null;
  entrando?:    { nome_completo: string } | null;
}

interface NewHandoverForm {
  observacao: string;
}

interface Props {
  token:      string;
  role:       string;
  reserveId:  string | null;
  reserveIds?: string[];
}

export function PassagensClient({ token, role, reserveId }: Props) { // reserveIds unused for now
  const [handovers, setHandovers] = useState<HandoverRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [creating,  setCreating]  = useState(false);
  const [showForm,  setShowForm]  = useState(false);
  const [form,      setForm]      = useState<NewHandoverForm>({ observacao: "" });
  const [createErr, setCreateErr] = useState<string | null>(null);

  const fetchHandovers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = reserveId
        ? `${BFF_URL}/api/handovers?reserve_id=${reserveId}`
        : `${BFF_URL}/api/handovers`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) { setError("Erro ao carregar passagens"); return; }
      const d = await res.json() as { handovers: HandoverRow[] };
      // Normalise Supabase array joins to single objects
      setHandovers(
        (d.handovers ?? []).map(h => ({
          ...h,
          reserve:  Array.isArray(h.reserve)  ? h.reserve[0]  ?? null : h.reserve,
          saindo:   Array.isArray(h.saindo)   ? h.saindo[0]   ?? null : h.saindo,
          entrando: Array.isArray(h.entrando) ? h.entrando[0] ?? null : h.entrando,
        }))
      );
    } catch {
      setError("Sem conexão com o servidor");
    } finally {
      setLoading(false);
    }
  }, [token, reserveId]);

  useEffect(() => { fetchHandovers(); }, [fetchHandovers]);

  const handleCreate = async () => {
    if (!reserveId) {
      setCreateErr("Nenhuma reserva associada à sua conta");
      return;
    }
    setCreating(true);
    setCreateErr(null);
    try {
      const res = await fetch(`${BFF_URL}/api/handovers`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ reserve_id: reserveId, observacao_saindo: form.observacao || undefined }),
      });
      const d = await res.json() as { ok?: boolean; error?: string; handover_id?: string };
      if (!res.ok) { setCreateErr(d.error ?? "Erro ao criar passagem"); return; }
      setShowForm(false);
      setForm({ observacao: "" });
      await fetchHandovers();
    } catch {
      setCreateErr("Erro de rede");
    } finally {
      setCreating(false);
    }
  };

  const pending = handovers.filter(h =>
    ["aguardando_assinatura_saida", "aguardando_atribuicao", "aguardando_assinatura_entrada", "divergencia"].includes(h.status)
  );
  const done = handovers.filter(h => !pending.includes(h));

  const canCreate = ["armeiro", "admin_reserva"].includes(role);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ArrowRightLeft className="size-6 text-primary" />
            Passagens de Serviço
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Livro Digital de Serviço — passagens de turno com assinatura dupla
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchHandovers}
            disabled={loading}
            aria-label="Atualizar"
            className="h-9 w-9 rounded-xl border border-border bg-background flex items-center justify-center hover:bg-muted transition-colors disabled:opacity-40"
          >
            <RefreshCw className={["size-4 text-muted-foreground", loading ? "animate-spin" : ""].join(" ")} />
          </button>
          {canCreate && (
            <Button
              size="sm"
              onClick={() => setShowForm(v => !v)}
              className="rounded-xl"
            >
              <Plus className="size-4 mr-1" />
              Nova Passagem
            </Button>
          )}
        </div>
      </div>

      {/* Formulário rápido de criação */}
      {showForm && canCreate && (
        <div className="rounded-2xl border border-border bg-card p-5 space-y-4" style={{ boxShadow: "var(--shadow-card)" }}>
          <h3 className="text-sm font-semibold text-foreground">Iniciar Passagem de Serviço</h3>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Observação de saída (opcional)</label>
            <textarea
              value={form.observacao}
              onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))}
              rows={3}
              placeholder="Situação do turno, ocorrências, pendências..."
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          {createErr && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertTriangle className="size-3" /> {createErr}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => setShowForm(false)} className="rounded-xl">
              Cancelar
            </Button>
            <Button size="sm" onClick={handleCreate} disabled={creating} className="rounded-xl">
              {creating ? "Criando..." : "Criar Passagem"}
            </Button>
          </div>
        </div>
      )}

      {/* Erro */}
      {error && (
        <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4 flex items-center gap-3">
          <AlertTriangle className="size-5 text-destructive shrink-0" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Passagens pendentes */}
      {!loading && pending.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Em andamento ({pending.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {pending.map(h => (
              <HandoverCard key={h.id} {...h} status={h.status as Parameters<typeof HandoverCard>[0]["status"]} />
            ))}
          </div>
        </section>
      )}

      {/* Histórico */}
      {!loading && done.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            Histórico ({done.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {done.map(h => (
              <HandoverCard key={h.id} {...h} status={h.status as Parameters<typeof HandoverCard>[0]["status"]} />
            ))}
          </div>
        </section>
      )}

      {/* Empty state */}
      {!loading && !error && handovers.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-2">
          <ArrowRightLeft className="size-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Nenhuma passagem de serviço registrada</p>
          {canCreate && (
            <p className="text-xs text-muted-foreground">
              Clique em <strong>Nova Passagem</strong> para iniciar o livro digital de serviço
            </p>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl bg-card border-l-4 border-l-muted p-4 space-y-3 animate-pulse" style={{ boxShadow: "var(--shadow-card)" }}>
              <div className="flex justify-between">
                <div className="size-9 rounded-xl bg-muted" />
                <div className="h-6 w-32 rounded-lg bg-muted" />
              </div>
              <div className="space-y-1.5">
                <div className="h-3 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
