"use client";

import { useState, useEffect, useCallback } from "react";
import { NexusShell } from "../_components/nexus-shell";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Input } from "@/components/ui/input";
import { Loader2, Search, ChevronLeft, ChevronRight } from "lucide-react";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Event {
  id: string;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export default function NexusLogsPage() {
  const { ready } = useNexusGuard();
  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        limit: "50",
        ...(actionFilter ? { action: actionFilter } : {}),
      });
      const res = await fetch(`${BFF_URL}/api/nexus/events?${qs}`, { credentials: "include" });
      const data = await res.json();
      setEvents(data.events ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (!ready) {
    return (
      <div className="min-h-dvh bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  const totalPages = Math.ceil(total / 50);

  function actionColor(action: string) {
    if (/error|failed|falhou/i.test(action)) return "text-red-400";
    if (/login|auth/i.test(action)) return "text-blue-400";
    if (/nexus/i.test(action)) return "text-indigo-400";
    if (/totp/i.test(action)) return "text-purple-400";
    return "text-gray-300";
  }

  return (
    <NexusShell>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Audit Logs</h1>
            <p className="text-xs text-gray-500 mt-0.5">{total.toLocaleString("pt-BR")} eventos registrados</p>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-gray-500" />
            <Input
              placeholder="Filtrar por ação..."
              value={actionFilter}
              onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
              className="pl-8 bg-[#12121A] border-[#1E1E2E] text-white text-xs"
            />
          </div>
        </div>

        <div className="bg-[#12121A] border border-[#1E1E2E] rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-indigo-400" />
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1E1E2E]">
                  <th className="text-left text-gray-600 font-medium px-4 py-2.5 w-44">Horário</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5">Ação</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5">Recurso</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-b border-[#1E1E2E]/50 hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-gray-600 font-mono whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString("pt-BR")}
                    </td>
                    <td className={`px-2 py-2 font-mono ${actionColor(e.action)}`}>{e.action}</td>
                    <td className="px-2 py-2 text-gray-500">{e.resource_type}</td>
                    <td className="px-2 py-2 text-gray-600 max-w-xs truncate font-mono text-[10px]">
                      {e.metadata ? JSON.stringify(e.metadata) : "—"}
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center text-gray-600 py-8">
                      Nenhum evento encontrado
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>Página {page} de {totalPages}</span>
            <div className="flex gap-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                className="p-1.5 rounded border border-[#1E1E2E] disabled:opacity-30 hover:bg-white/5"
              >
                <ChevronLeft className="size-3.5" />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="p-1.5 rounded border border-[#1E1E2E] disabled:opacity-30 hover:bg-white/5"
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </NexusShell>
  );
}
