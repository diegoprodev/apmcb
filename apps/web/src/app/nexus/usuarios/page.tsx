"use client";

import { useState, useEffect, useCallback } from "react";
import { NexusSidebar } from "../_components/nexus-sidebar";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Loader2,
  Search,
  Users,
  ShieldOff,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Profile {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
  role: string;
  registration_status: string;
  totp_configured: boolean;
  created_at: string;
}

const ROLE_LABEL: Record<string, string> = {
  superadmin:    "Superadmin",
  admin_global:  "Admin Global",
  admin_reserva: "Admin Reserva",
  armeiro:       "Armeiro",
  usuario:       "Cadete / Usuário",
  auditor:       "Auditor",
  // legado
  admin:  "Admin (legado)",
  master: "Armeiro (legado)",
};

const ROLE_COLOR: Record<string, string> = {
  superadmin:    "text-purple-400 bg-purple-500/10 border-purple-500/30",
  admin_global:  "text-indigo-400 bg-indigo-500/10 border-indigo-500/30",
  admin_reserva: "text-blue-400 bg-blue-500/10 border-blue-500/30",
  armeiro:       "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  usuario:       "text-gray-400 bg-gray-500/10 border-gray-500/30",
  auditor:       "text-amber-400 bg-amber-500/10 border-amber-500/30",
  admin:         "text-indigo-300 bg-indigo-500/10 border-indigo-400/20",
  master:        "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
};

const STATUS_COLOR: Record<string, string> = {
  active:   "text-emerald-400 bg-emerald-500/10",
  pending:  "text-yellow-400 bg-yellow-500/10",
  inactive: "text-red-400 bg-red-500/10",
};

export default function NexusUsuariosPage() {
  const { ready } = useNexusGuard();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  // Dialog de confirmação de reset TOTP
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (q) params.set("q", q);
      const res = await fetch(`${BFF_URL}/api/nexus/users?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Erro ao buscar usuários");
      const data = await res.json();
      setProfiles(data.users ?? []);
    } catch {
      toast.error("Falha ao carregar usuários");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load(search);
  }, [ready, load, search]);

  async function confirmResetTotp() {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/users/${resetTarget.id}/reset-totp`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao resetar TOTP");
        return;
      }
      toast.success(`TOTP de ${resetTarget.nome_completo} resetado. O militar deve reconfigurar o autenticador.`);
      setResetTarget(null);
      load(search);
    } catch {
      toast.error("Erro de rede");
    } finally {
      setResetting(false);
    }
  }

  if (!ready) {
    return (
      <div className="min-h-dvh bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  const totpConfigured = profiles.filter((p) => p.totp_configured).length;
  const totpPct = profiles.length > 0 ? Math.round((totpConfigured / profiles.length) * 100) : 0;

  return (
    <div className="flex h-screen overflow-hidden">
      <NexusSidebar />

      <main className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-white">Usuários</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {profiles.length} registros · TOTP configurado:{" "}
              <span className={totpPct >= 80 ? "text-emerald-400" : "text-yellow-400"}>
                {totpConfigured}/{profiles.length} ({totpPct}%)
              </span>
            </p>
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

        {/* Alerta se TOTP baixo */}
        {profiles.length > 0 && totpPct < 80 && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-300 text-xs">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              <strong>{profiles.length - totpConfigured} usuário(s)</strong> sem TOTP configurado — risco de segurança.
              Reforce o onboarding de 2FA.
            </span>
          </div>
        )}

        {/* Tabela */}
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
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5 w-32">Role</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5 w-24">Status</th>
                  <th className="text-center text-gray-600 font-medium px-2 py-2.5 w-16">TOTP</th>
                  <th className="text-left text-gray-600 font-medium px-2 py-2.5 w-28">Cadastro</th>
                  <th className="text-right text-gray-600 font-medium px-4 py-2.5 w-28">Ações</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => (
                  <tr key={p.id} className="border-b border-[#1E1E2E]/50 hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-gray-200 max-w-50 truncate">{p.nome_completo}</td>
                    <td className="px-2 py-2 text-gray-500 font-mono">{p.matricula}</td>
                    <td className="px-2 py-2 text-gray-500">{p.posto ?? "—"}</td>
                    <td className="px-2 py-2">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${ROLE_COLOR[p.role] ?? "text-gray-400 bg-gray-500/10 border-gray-500/30"}`}>
                        {ROLE_LABEL[p.role] ?? p.role}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[p.registration_status] ?? "text-gray-400"}`}>
                        {p.registration_status}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {p.totp_configured
                        ? <CheckCircle2 className="size-3.5 text-emerald-400 inline" />
                        : <span className="text-gray-600 text-[10px]">—</span>
                      }
                    </td>
                    <td className="px-2 py-2 text-gray-600">
                      {new Date(p.created_at).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {p.totp_configured && (
                        <button
                          onClick={() => setResetTarget(p)}
                          className="inline-flex items-center gap-1 text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
                          title="Resetar TOTP deste usuário"
                        >
                          <ShieldOff className="size-3" />
                          Reset TOTP
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>

      {/* Dialog: Confirmar reset de TOTP */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent className="bg-[#0D0D14] border-[#1E1E2E] text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <ShieldOff className="size-4 text-red-400" />
              Resetar TOTP
            </DialogTitle>
            <DialogDescription className="text-gray-400 text-sm mt-2">
              O TOTP de{" "}
              <span className="text-white font-medium">{resetTarget?.nome_completo}</span>{" "}
              ({resetTarget?.matricula}) será apagado. O militar precisará reconfigurar o
              Google Authenticator no próximo login.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setResetTarget(null)}
              className="flex-1 border-[#1E1E2E] text-gray-400 hover:text-white"
              disabled={resetting}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmResetTotp}
              disabled={resetting}
              className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            >
              {resetting ? <Loader2 className="size-4 animate-spin" /> : "Confirmar Reset"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
