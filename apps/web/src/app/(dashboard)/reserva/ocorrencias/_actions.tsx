"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { csrfHeaders } from "@/lib/csrf";
import { createClient } from "@/lib/supabase/client";
import { friendlyApiError } from "@/lib/api-error";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

export function OcorrenciaActions({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [resolucao, setResolucao] = useState("");
  const [showResolve, setShowResolve] = useState(false);

  async function patch(newStatus: string, res?: string) {
    setLoading(newStatus);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const authHeader: Record<string, string> = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};

      const resp = await fetch(`${BFF_URL}/api/ocorrencias/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeader, ...csrfHeaders() },
        body: JSON.stringify({ status: newStatus, resolucao: res }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        console.error("[ocorrencia-actions] falha ao atualizar ocorrência", { status: resp.status, error: (body as { error?: string }).error });
        toast.error(friendlyApiError(resp.status, (body as { error?: string }).error, "Erro ao atualizar."));
        return;
      }

      toast.success(
        newStatus === "resolvida" ? "Ocorrência marcada como resolvida." :
        newStatus === "em_analise" ? "Ocorrência marcada em análise." :
        "Ocorrência encerrada."
      );
      router.refresh();
    } catch (err) {
      console.error("[ocorrencia-actions] erro de conexão ao atualizar ocorrência", err);
      toast.error("Sem conexão com o servidor.");
    } finally {
      setLoading(null);
    }
  }

  if (status === "aberta") {
    return (
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          disabled={!!loading}
          onClick={() => patch("em_analise")}
        >
          {loading === "em_analise" ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
          Em análise
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-emerald-700 border-emerald-200 hover:bg-emerald-50"
          disabled={!!loading}
          onClick={() => setShowResolve(true)}
        >
          Resolver
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={!!loading}
          onClick={() => patch("improcedente")}
        >
          {loading === "improcedente" ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
          Improcedente
        </Button>
        {showResolve && (
          <div className="w-full space-y-2 pt-1">
            <textarea
              value={resolucao}
              onChange={(e) => setResolucao(e.target.value)}
              placeholder="Descreva a resolução (opcional)..."
              rows={2}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary transition-colors resize-none"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={!!loading} onClick={() => { patch("resolvida", resolucao); setShowResolve(false); }}>
                {loading === "resolvida" ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
                Confirmar resolução
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowResolve(false)}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (status === "em_analise") {
    return (
      <div className="flex gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="text-emerald-700 border-emerald-200 hover:bg-emerald-50"
          disabled={!!loading}
          onClick={() => setShowResolve(true)}
        >
          Resolver
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          disabled={!!loading}
          onClick={() => patch("improcedente")}
        >
          {loading === "improcedente" ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
          Improcedente
        </Button>
        {showResolve && (
          <div className="w-full space-y-2 pt-1">
            <textarea
              value={resolucao}
              onChange={(e) => setResolucao(e.target.value)}
              placeholder="Descreva a resolução (opcional)..."
              rows={2}
              className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary transition-colors resize-none"
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={!!loading} onClick={() => { patch("resolvida", resolucao); setShowResolve(false); }}>
                {loading === "resolvida" ? <Loader2 className="size-3.5 animate-spin mr-1" /> : null}
                Confirmar resolução
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowResolve(false)}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
