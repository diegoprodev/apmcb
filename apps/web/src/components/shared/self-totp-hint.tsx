"use client";

import { useEffect, useState } from "react";
import { bffFetch } from "@/lib/bff-client";

/**
 * O próprio app gera o código TOTP do usuário logado (mesma fonte de
 * GET /api/totp/code usado em "Meu Perfil") — sem isso o usuário precisaria
 * de outro app/aba aberta para descobrir o código enquanto o dialog que
 * pede esse código já está na tela. Extraído de cautelas/sign-dialog.tsx
 * (mesma UX, "toque para usar") para reuso em qualquer fluxo que peça TOTP
 * do próprio usuário — ex: abrir/encerrar turno no Livro Digital.
 */
export function SelfTotpHint({ onUse }: { onUse: (code: string) => void }) {
  const [state, setState] = useState<{ code: string; seconds_remaining: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    function stopPolling() {
      if (interval) { clearInterval(interval); interval = null; }
    }
    async function fetchCode() {
      const { ok, status, data } = await bffFetch("GET", "/api/totp/code");
      if (cancelled) return;
      if (status === 404) {
        setState(null); setError("TOTP não configurado. Acesse 'Meu Perfil' para configurar.");
        stopPolling();
        return;
      }
      if (status === 422) {
        // needs_reconfigure — retry não resolve, backend já traz mensagem acionável
        setState(null); setError(data.error ?? "Autenticador inválido. Reconfigure em 'Meu Perfil'.");
        stopPolling();
        return;
      }
      if (!ok) { setState(null); setError(data.error ?? "Não foi possível obter seu código."); return; }
      setState({ code: data.code, seconds_remaining: data.seconds_remaining });
      setError(null);
    }
    fetchCode();
    interval = setInterval(fetchCode, 5000);
    return () => { cancelled = true; stopPolling(); };
  }, []);

  if (error) {
    return <p className="text-[11px] text-destructive text-center">{error}</p>;
  }
  if (!state) {
    return <p className="text-[11px] text-muted-foreground text-center">Carregando seu código atual...</p>;
  }

  return (
    <button type="button" onClick={() => onUse(state.code)}
      className="w-full rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-center hover:bg-primary/10 transition-colors">
      <span className="block text-[10px] text-muted-foreground mb-0.5">
        Seu código atual (expira em {state.seconds_remaining}s) — toque para usar
      </span>
      <span className="text-lg font-mono font-bold tracking-[0.3em] text-primary">{state.code}</span>
    </button>
  );
}
