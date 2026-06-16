"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Check, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface TOTPState {
  code: string;
  seconds_remaining: number;
  period: number;
}

export function TOTPDisplay() {
  const [state, setState] = useState<TOTPState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [localSeconds, setLocalSeconds] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchCode() {
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const authHeader = session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
      const res = await fetch(`${BFF_URL}/api/totp/code`, {
        credentials: "include",
        headers: authHeader,
      });
      if (res.status === 404) {
        setError("TOTP não configurado.");
        return;
      }
      if (res.status === 429) {
        const body = await res.json();
        setError(`Bloqueado. Tente em ${body.retry_after_seconds ?? 60}s.`);
        return;
      }
      if (!res.ok) { setError("Erro ao obter código."); return; }
      const data: TOTPState = await res.json();
      setState(data);
      setLocalSeconds(data.seconds_remaining);
      setError(null);
    } catch {
      setError("Sem conexão com o servidor.");
    }
  }

  useEffect(() => {
    fetchCode();
    // Refetch every 5s — ensures we never show a stale code
    fetchRef.current = setInterval(fetchCode, 5000);
    return () => {
      if (fetchRef.current) clearInterval(fetchRef.current);
    };
  }, []);

  // Local countdown tick every second
  useEffect(() => {
    tickRef.current = setInterval(() => {
      setLocalSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => { if (tickRef.current) clearInterval(tickRef.current); };
  }, []);

  async function copy() {
    if (!state) return;
    await navigator.clipboard.writeText(state.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // SVG ring countdown
  const period = state?.period ?? 30;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const progress = localSeconds / period;
  const dashoffset = circumference * (1 - progress);
  const ringColor =
    localSeconds > 10 ? "#16a34a" : localSeconds > 5 ? "#d97706" : "#dc2626";

  if (error) {
    return (
      <div className="rounded-2xl bg-destructive/10 p-4 text-center text-sm text-destructive">
        {error}
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center h-24">
        <div className="size-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const digits = state.code.split("");

  return (
    <div
      data-testid="totp-display"
      className="rounded-2xl bg-card p-5 flex flex-col items-center gap-4"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Shield className="size-4 text-primary" />
        Código de Acesso
      </div>

      {/* Countdown ring + code */}
      <div className="relative flex items-center justify-center">
        <svg width={96} height={96} className="-rotate-90">
          <circle cx={48} cy={48} r={radius} fill="none" stroke="currentColor"
            className="text-muted/20" strokeWidth={4} />
          <circle cx={48} cy={48} r={radius} fill="none" stroke={ringColor}
            strokeWidth={4} strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashoffset}
            style={{ transition: "stroke-dashoffset 1s linear, stroke 0.5s" }}
          />
        </svg>
        <span className="absolute text-xs font-mono font-semibold" style={{ color: ringColor }}>
          {localSeconds}s
        </span>
      </div>

      {/* 6-digit code split 3+3 */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5">
          {digits.slice(0, 3).map((d, i) => (
            <span key={i} className="text-3xl font-mono font-bold tracking-widest text-foreground">{d}</span>
          ))}
        </div>
        <span className="text-2xl text-muted-foreground/40 font-light">·</span>
        <div className="flex gap-1.5">
          {digits.slice(3).map((d, i) => (
            <span key={i} className="text-3xl font-mono font-bold tracking-widest text-foreground">{d}</span>
          ))}
        </div>
      </div>

      <Button variant="outline" size="sm" onClick={copy} className="w-full max-w-[160px]">
        {copied ? (
          <><Check className="size-3.5 mr-1.5" /> Copiado</>
        ) : (
          <><Copy className="size-3.5 mr-1.5" /> Copiar código</>
        )}
      </Button>

      <p className="text-[11px] text-muted-foreground text-center leading-tight max-w-[200px]">
        Informe este código ao Reserva de Armamento ou use-o para validar sua solicitação remota
      </p>
    </div>
  );
}
