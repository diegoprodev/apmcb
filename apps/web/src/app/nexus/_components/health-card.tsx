"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface HealthData {
  bff: { ok: boolean; latency_ms: number; uptime_seconds: number | null };
  supabase: { ok: boolean };
  ts: string;
}

export function HealthCard() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function fetch_health() {
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/health`, { credentials: "include" });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setError(false);
        setLastUpdated(new Date());
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    fetch_health();
    const interval = setInterval(fetch_health, 30_000);
    return () => clearInterval(interval);
  }, []);

  const uptime = data?.bff?.uptime_seconds
    ? `${Math.floor(data.bff.uptime_seconds / 3600)}h ${Math.floor((data.bff.uptime_seconds % 3600) / 60)}m`
    : "—";

  return (
    <div className="bg-[#12121A] border border-[#1E1E2E] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Saúde do Sistema</h3>
        <button onClick={fetch_health} className="text-gray-600 hover:text-gray-400 transition-colors">
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {error ? (
        <p className="text-xs text-red-400">Falha ao obter status</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">BFF</span>
            <div className="flex items-center gap-1.5">
              {data?.bff?.ok ? (
                <CheckCircle2 className="size-3.5 text-emerald-400" />
              ) : (
                <XCircle className="size-3.5 text-red-400" />
              )}
              <span className="text-xs text-gray-300">{data ? `${data.bff.latency_ms}ms` : "—"}</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Supabase</span>
            {data?.supabase?.ok ? (
              <CheckCircle2 className="size-3.5 text-emerald-400" />
            ) : (
              <XCircle className="size-3.5 text-red-400" />
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">Uptime</span>
            <span className="text-xs text-gray-300 font-mono">{uptime}</span>
          </div>
        </div>
      )}

      {lastUpdated && (
        <p className="text-[10px] text-gray-600">
          Atualizado {lastUpdated.toLocaleTimeString("pt-BR")}
        </p>
      )}
    </div>
  );
}
