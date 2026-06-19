"use client";

import { useEffect, useState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { AlertCircle } from "lucide-react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Event {
  id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  profiles?: { nome_completo: string; matricula: string; role: string } | null;
  _new?: boolean;
}

function isError(action: string) {
  return /error|failed|falhou|negado/i.test(action);
}

export function EventTable() {
  const [events, setEvents] = useState<Event[]>([]);
  const [hasNewError, setHasNewError] = useState(false);
  const realtimeRef = useRef<ReturnType<typeof createClient> | null>(null);

  useEffect(() => {
    // Load initial events from BFF
    fetch(`${BFF_URL}/api/nexus/events?limit=50`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.events) setEvents(d.events);
      })
      .catch(() => {});

    // Subscribe to realtime INSERT on audit_logs
    const supabase = createClient();
    realtimeRef.current = supabase;

    supabase
      .channel("nexus-audit-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "audit_logs" },
        (payload) => {
          const row = payload.new as Event;
          const enriched = { ...row, _new: true };
          setEvents((prev) => [enriched, ...prev].slice(0, 100));
          if (isError(row.action)) setHasNewError(true);
          setTimeout(() => {
            setEvents((prev) => prev.map((e) => (e.id === row.id ? { ...e, _new: false } : e)));
          }, 3000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeAllChannels();
    };
  }, []);

  function actionColor(action: string) {
    if (isError(action)) return "text-red-400";
    if (/login|auth/i.test(action)) return "text-blue-400";
    if (/nexus/i.test(action)) return "text-indigo-400";
    if (/totp/i.test(action)) return "text-purple-400";
    return "text-gray-300";
  }

  return (
    <div className="bg-[#12121A] border border-[#1E1E2E] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E1E2E]">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Feed de Eventos
          <span className="ml-2 inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        </h3>
        {hasNewError && (
          <span
            onClick={() => setHasNewError(false)}
            className="flex items-center gap-1 text-[10px] text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full cursor-pointer animate-pulse"
          >
            <AlertCircle className="size-2.5" />
            Novo erro detectado
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#1E1E2E]">
              <th className="text-left text-gray-600 font-medium px-4 py-2 w-40">Horário</th>
              <th className="text-left text-gray-600 font-medium px-2 py-2">Ação</th>
              <th className="text-left text-gray-600 font-medium px-2 py-2">Recurso</th>
              <th className="text-left text-gray-600 font-medium px-2 py-2 w-32">Ator</th>
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-gray-600 py-8">
                  Nenhum evento ainda
                </td>
              </tr>
            )}
            {events.map((e) => (
              <tr
                key={e.id}
                className={`border-b border-[#1E1E2E]/50 transition-colors ${
                  e._new ? "bg-indigo-500/10" : "hover:bg-white/[0.02]"
                }`}
              >
                <td className="px-4 py-2 text-gray-600 font-mono whitespace-nowrap">
                  {new Date(e.created_at).toLocaleTimeString("pt-BR")}
                </td>
                <td className={`px-2 py-2 font-mono ${actionColor(e.action)}`}>{e.action}</td>
                <td className="px-2 py-2 text-gray-500">{e.resource_type}</td>
                <td className="px-2 py-2 text-gray-600 truncate max-w-32">
                  {(e.profiles as Event["profiles"])?.matricula ?? e.actor_id?.slice(0, 8) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
