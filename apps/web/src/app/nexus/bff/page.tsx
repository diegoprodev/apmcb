"use client";

import { useState, useEffect } from "react";
import { NexusShell } from "../_components/nexus-shell";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Loader2, CheckCircle2, XCircle, RefreshCw, Server, Trash2 } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Health {
  bff: { ok: boolean; latency_ms: number; uptime_seconds: number | null };
  supabase: { ok: boolean };
  ts: string;
}

export default function NexusBffPage() {
  const { ready } = useNexusGuard();
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(false);
  const [ipToClear, setIpToClear] = useState("");
  const [clearLoading, setClearLoading] = useState(false);

  async function fetchHealth() {
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/health`, { credentials: "include" });
      setHealth(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (ready) {
      fetchHealth();
      const interval = setInterval(fetchHealth, 30_000);
      return () => clearInterval(interval);
    }
  }, [ready]);

  async function clearRateLimit() {
    if (!ipToClear.trim()) return;
    setClearLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/clear-rate-limit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        credentials: "include",
        body: JSON.stringify({ ip: ipToClear.trim() }),
      });
      if (res.ok) {
        toast.success(`Rate limit limpo para ${ipToClear}`);
        setIpToClear("");
      } else {
        toast.error("Erro ao limpar rate limit");
      }
    } finally {
      setClearLoading(false);
    }
  }

  if (!ready) {
    return (
      <div className="min-h-dvh bg-gray-50 dark:bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  const uptime = health?.bff?.uptime_seconds
    ? `${Math.floor(health.bff.uptime_seconds / 3600)}h ${Math.floor((health.bff.uptime_seconds % 3600) / 60)}m ${health.bff.uptime_seconds % 60}s`
    : "—";

  return (
    <NexusShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">BFF Health</h1>
            <p className="text-xs text-gray-500 mt-0.5">Status do backend e controles operacionais</p>
          </div>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-200 border border-gray-200 dark:border-[#1E1E2E] px-3 py-1.5 rounded-lg transition-colors"
          >
            <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>

        {/* Health cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              icon: Server,
              label: "BFF Status",
              value: health?.bff.ok ? "Online" : "Offline",
              ok: health?.bff.ok,
              sub: health ? `${health.bff.latency_ms}ms latência` : "—",
            },
            {
              icon: Server,
              label: "Supabase",
              value: health?.supabase.ok ? "Online" : "Offline",
              ok: health?.supabase.ok,
              sub: "PostgreSQL + Realtime",
            },
            {
              icon: Server,
              label: "Uptime BFF",
              value: uptime,
              ok: true,
              sub: health?.ts ? new Date(health.ts).toLocaleTimeString("pt-BR") : "—",
            },
          ].map(({ icon: Icon, label, value, ok, sub }) => (
            <div key={label} className="bg-gray-100 dark:bg-[#12121A] border border-gray-200 dark:border-[#1E1E2E] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs text-gray-400">{label}</span>
                {ok !== undefined && (
                  ok
                    ? <CheckCircle2 className="size-4 text-emerald-400" />
                    : <XCircle className="size-4 text-red-400" />
                )}
              </div>
              <p className="text-base font-bold text-white">{value}</p>
              <p className="text-[10px] text-gray-600 mt-1">{sub}</p>
            </div>
          ))}
        </div>

        {/* Clear rate limit */}
        <div className="bg-gray-100 dark:bg-[#12121A] border border-gray-200 dark:border-[#1E1E2E] rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Trash2 className="size-4 text-orange-400" />
            <h3 className="text-sm font-semibold text-white">Limpar Rate Limit por IP</h3>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Remove o bloqueio de rate limit de um IP específico. Use apenas quando confirmar que o IP é legítimo.
          </p>
          <div className="flex gap-2">
            <Input
              value={ipToClear}
              onChange={(e) => setIpToClear(e.target.value)}
              placeholder="Ex: 177.84.123.45"
              className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-white text-xs"
            />
            <Button
              onClick={clearRateLimit}
              disabled={clearLoading || !ipToClear.trim()}
              className="bg-orange-600 hover:bg-orange-500 text-white text-xs shrink-0"
            >
              {clearLoading ? <Loader2 className="size-3.5 animate-spin" /> : "Limpar"}
            </Button>
          </div>
        </div>
      </div>
    </NexusShell>
  );
}
