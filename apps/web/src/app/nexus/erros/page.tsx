"use client";

import { useState, useEffect } from "react";
import { NexusSidebar } from "../_components/nexus-sidebar";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Loader2, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface ErrorEvent {
  id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  _new?: boolean;
}

export default function NexusErrosPage() {
  const { ready } = useNexusGuard();
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ready) return;

    setLoading(true);
    fetch(`${BFF_URL}/api/nexus/errors?limit=50`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setEvents(d.errors ?? []))
      .finally(() => setLoading(false));

    // Realtime: watch for new error events
    const supabase = createClient();
    supabase
      .channel("nexus-errors-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_logs" },
        (payload) => {
          const row = payload.new as ErrorEvent;
          if (/error|failed|falhou|negado/i.test(row.action)) {
            setEvents((prev) => [{ ...row, _new: true }, ...prev].slice(0, 100));
            setTimeout(() => {
              setEvents((p) => p.map((e) => (e.id === row.id ? { ...e, _new: false } : e)));
            }, 3000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeAllChannels();
    };
  }, [ready]);

  if (!ready) {
    return (
      <div className="min-h-dvh bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <NexusSidebar />

      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-white">Monitoramento de Erros</h1>
          <p className="text-xs text-gray-500 mt-0.5">Eventos com erro em tempo real</p>
        </div>

        <div className="bg-[#12121A] border border-[#1E1E2E] rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-indigo-400" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                <AlertTriangle className="size-5 text-emerald-400" />
              </div>
              <p className="text-sm text-gray-400 font-medium">Sem erros registrados</p>
              <p className="text-xs text-gray-600">Sistema operando normalmente</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1E1E2E]">
                  <th className="text-left text-gray-600 font-medium px-4 py-2.5 w-44">Horário</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5">Ação</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5">Recurso</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5">Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className={`border-b border-[#1E1E2E]/50 transition-colors ${
                      e._new ? "bg-red-500/10" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <td className="px-4 py-2 text-gray-600 font-mono whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-2 py-2 font-mono text-red-400">{e.action}</td>
                    <td className="px-2 py-2 text-gray-500">{e.resource_type}</td>
                    <td className="px-2 py-2 text-gray-600 max-w-xs truncate font-mono text-[10px]">
                      {e.metadata ? JSON.stringify(e.metadata) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
