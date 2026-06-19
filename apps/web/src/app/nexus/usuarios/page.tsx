"use client";

import { useState, useEffect, useCallback } from "react";
import { NexusSidebar } from "../_components/nexus-sidebar";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Input } from "@/components/ui/input";
import { Loader2, Search, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

interface Profile {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string;
  role: "admin" | "master" | "usuario";
  registration_status: string;
  totp_configured: boolean;
  created_at: string;
}

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  master: "Armeiro",
  usuario: "Cadete",
};

const STATUS_COLOR: Record<string, string> = {
  active: "text-emerald-400 bg-emerald-500/10",
  pending: "text-yellow-400 bg-yellow-500/10",
  inactive: "text-red-400 bg-red-500/10",
};

export default function NexusUsuariosPage() {
  const { ready } = useNexusGuard();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const supabase = createClient();
      let query = supabase
        .from("profiles")
        .select("id, nome_completo, matricula, posto, role, registration_status, totp_configured, created_at")
        .order("created_at", { ascending: false })
        .limit(100);

      if (q) {
        query = query.or(`nome_completo.ilike.%${q}%,matricula.ilike.%${q}%`);
      }

      const { data } = await query;
      setProfiles((data as Profile[]) ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load(search);
  }, [ready, load, search]);

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
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Usuários</h1>
            <p className="text-xs text-gray-500 mt-0.5">{profiles.length} registros</p>
          </div>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-gray-500" />
            <Input
              placeholder="Nome ou matrícula..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 bg-[#12121A] border-[#1E1E2E] text-white text-xs"
            />
          </div>
        </div>

        <div className="bg-[#12121A] border border-[#1E1E2E] rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-indigo-400" />
            </div>
          ) : profiles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Users className="size-8 text-gray-700" />
              <p className="text-sm text-gray-500">Nenhum usuário encontrado</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1E1E2E]">
                  <th className="text-left text-gray-600 font-medium px-4 py-2.5">Nome</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5 w-28">Matrícula</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5 w-20">Posto</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5 w-20">Role</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5 w-24">Status</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5 w-16">TOTP</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5 w-32">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b border-[#1E1E2E]/50 hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-gray-200">{p.nome_completo}</td>
                    <td className="px-2 py-2 text-gray-500 font-mono">{p.matricula}</td>
                    <td className="px-2 py-2 text-gray-500">{p.posto ?? "—"}</td>
                    <td className="px-2 py-2">
                      <span className="text-indigo-400">{ROLE_LABEL[p.role] ?? p.role}</span>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[p.registration_status] ?? "text-gray-400"}`}>
                        {p.registration_status}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      {p.totp_configured
                        ? <span className="text-emerald-400">✓</span>
                        : <span className="text-gray-600">—</span>
                      }
                    </td>
                    <td className="px-2 py-2 text-gray-600">
                      {new Date(p.created_at).toLocaleDateString("pt-BR")}
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
