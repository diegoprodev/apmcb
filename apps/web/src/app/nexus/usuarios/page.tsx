"use client";

import { useState, useEffect, useCallback } from "react";
import { NexusShell } from "../_components/nexus-shell";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useGridState } from "@/components/shared/use-grid-state";
import { GridSearchInput } from "@/components/shared/grid-search-input";
import { GridPdfButton } from "@/components/shared/grid-pdf-button";
import {
  Loader2,
  Users,
  ShieldOff,
  CheckCircle2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  MoreHorizontal,
  UserX,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";
const PAGE_SIZE = 50;

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

interface TenantOption {
  id: string;
  nome: string;
  slug: string;
}

const ROLE_LABEL: Record<string, string> = {
  superadmin:    "Superadmin",
  admin_global:  "Admin Global",
  admin_reserva: "Admin Reserva",
  armeiro:       "Armeiro",
  usuario:       "Cadete / Usuário",
  auditor:       "Auditor",
  admin:         "Admin (legado)",
  master:        "Armeiro (legado)",
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
  complete:                  "text-emerald-400 bg-emerald-500/10",
  active:                    "text-emerald-400 bg-emerald-500/10",
  pending:                   "text-yellow-400 bg-yellow-500/10",
  pending_biometric:         "text-yellow-400 bg-yellow-500/10",
  inactive:                  "text-red-400 bg-red-500/10",
  impedimento_administrativo:"text-red-500 bg-red-500/10",
};

type SortField = "nome_completo" | "matricula" | "role" | "registration_status" | "created_at";

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField | null; sortDir: "asc" | "desc" }) {
  if (sortField !== field) return <ChevronsUpDown className="size-3 shrink-0 text-gray-600" />;
  return sortDir === "asc"
    ? <ChevronUp className="size-3 shrink-0 text-indigo-400" />
    : <ChevronDown className="size-3 shrink-0 text-indigo-400" />;
}

export default function NexusUsuariosPage() {
  useNexusGuard();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantFilter, setTenantFilter] = useState<string>("");
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const grid = useGridState(profiles, {
    searchFields: ["nome_completo", "matricula"],
    defaultSort: { field: "nome_completo", dir: "asc" },
  });

  // Carregar lista de tenants para o dropdown
  useEffect(() => {
    fetch(`${BFF_URL}/api/nexus/tenants`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.tenants) setTenants(d.tenants); })
      .catch(() => {});
  }, []);

  // Debounce da busca
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(grid.searchText);
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [grid.searchText]);

  // Reset página ao trocar tenant
  useEffect(() => { setPage(0); }, [tenantFilter]);

  const load = useCallback(async (q: string, p: number, tenant: string, sf: SortField | null, sd: "asc" | "desc") => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(p * PAGE_SIZE),
      });
      if (q) params.set("q", q);
      if (tenant) params.set("tenant_id", tenant);
      if (sf) { params.set("sort", sf); params.set("dir", sd); }
      const res = await fetch(`${BFF_URL}/api/nexus/users?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Erro ao buscar usuários");
      const data = await res.json();
      setProfiles(data.users ?? []);
      setTotal(data.total ?? 0);
    } catch {
      toast.error("Falha ao carregar usuários");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(debouncedQ, page, tenantFilter, sortField, sortDir);
  }, [load, debouncedQ, page, tenantFilter, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(0);
  }

  // Dialog: Confirmar reset TOTP
  const [resetTarget, setResetTarget] = useState<Profile | null>(null);
  const [resetting, setResetting] = useState(false);

  // Dialog: Suspender conta
  const [suspendTarget, setSuspendTarget] = useState<Profile | null>(null);
  const [suspending, setSuspending] = useState(false);

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
      if (!res.ok) { toast.error(data.error ?? "Erro ao resetar TOTP"); return; }
      toast.success(`TOTP de ${resetTarget.nome_completo} resetado.`);
      setResetTarget(null);
      load(debouncedQ, page, tenantFilter, sortField, sortDir);
    } catch {
      toast.error("Erro de rede");
    } finally {
      setResetting(false);
    }
  }

  async function confirmSuspend() {
    if (!suspendTarget) return;
    setSuspending(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/users/${suspendTarget.id}/suspend`, {
        method: "POST",
        credentials: "include",
        headers: csrfHeaders(),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error ?? "Erro ao suspender conta"); return; }
      toast.success(`Conta de ${suspendTarget.nome_completo} suspensa.`);
      setSuspendTarget(null);
      load(debouncedQ, page, tenantFilter, sortField, sortDir);
    } catch {
      toast.error("Erro de rede");
    } finally {
      setSuspending(false);
    }
  }

  const totpConfigured = profiles.filter((p) => p.totp_configured).length;
  const totpPct = total > 0 ? Math.round((totpConfigured / total) * 100) : 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const startIdx = page * PAGE_SIZE + 1;
  const endIdx = Math.min((page + 1) * PAGE_SIZE, total);

  const thClass = "px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-900 dark:hover:text-white transition-colors whitespace-nowrap";
  const thClassStatic = "px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap";

  return (
    <NexusShell>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">Usuários</h1>
            <p className="text-xs text-gray-500 mt-1">
              {total.toLocaleString("pt-BR")} registros · TOTP:{" "}
              <span className={totpPct >= 80 ? "text-emerald-600 dark:text-emerald-400" : "text-yellow-600 dark:text-yellow-400"}>
                {totpConfigured}/{total} ({totpPct}%)
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Dropdown por tenant */}
            <select
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              className="h-9 px-3 text-xs rounded-lg border border-gray-200 dark:border-[#1E1E2E] bg-white dark:bg-[#12121A] text-gray-800 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">Todos os tenants</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.nome}</option>
              ))}
            </select>
            <GridSearchInput
              value={grid.searchText}
              onChange={grid.setSearchText}
              placeholder="Nome ou matrícula..."
              className="w-56 [&_input]:bg-white dark:[&_input]:bg-[#12121A] [&_input]:border-gray-200 dark:[&_input]:border-[#1E1E2E] [&_input]:text-gray-900 dark:[&_input]:text-white [&_input]:placeholder:text-gray-400 dark:[&_input]:placeholder:text-gray-500"
            />
            <GridPdfButton
              printTargetId="nexus-usuarios-table"
              label="PDF"
              selectedCount={grid.selectedIds.size}
            />
          </div>
        </div>

        {/* Alerta TOTP */}
        {total > 0 && totpPct < 80 && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/20 text-yellow-700 dark:text-yellow-300 text-xs">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              <strong>{total - totpConfigured} usuário(s)</strong> sem TOTP configurado — risco de segurança.
            </span>
          </div>
        )}

        {/* Tabela */}
        <div className="bg-white dark:bg-[#12121A] border border-gray-200 dark:border-[#1E1E2E] rounded-xl overflow-hidden shadow-sm dark:shadow-none">
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
            <div id="nexus-usuarios-table">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-[#1E1E2E]">
                    <th className={thClass} onClick={() => toggleSort("nome_completo")}>
                      <span className="inline-flex items-center gap-1.5">
                        Nome <SortIcon field="nome_completo" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={thClass} onClick={() => toggleSort("matricula")}>
                      <span className="inline-flex items-center gap-1.5">
                        Matrícula <SortIcon field="matricula" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={thClassStatic}>Posto</th>
                    <th className={thClass} onClick={() => toggleSort("role")}>
                      <span className="inline-flex items-center gap-1.5">
                        Role <SortIcon field="role" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={thClass} onClick={() => toggleSort("registration_status")}>
                      <span className="inline-flex items-center gap-1.5">
                        Status <SortIcon field="registration_status" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={`${thClassStatic} text-center w-16`}>TOTP</th>
                    <th className={thClass} onClick={() => toggleSort("created_at")}>
                      <span className="inline-flex items-center gap-1.5">
                        Cadastro <SortIcon field="created_at" sortField={sortField} sortDir={sortDir} />
                      </span>
                    </th>
                    <th className={`${thClassStatic} text-right w-16`}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100 dark:border-[#1E1E2E]/50 hover:bg-gray-50 dark:hover:bg-white/2 transition-colors">
                      <td className="px-4 py-2.5 text-gray-900 dark:text-gray-100 font-medium max-w-50 truncate">{p.nome_completo}</td>
                      <td className="px-4 py-2.5 text-gray-600 dark:text-gray-500 font-mono">{p.matricula}</td>
                      <td className="px-4 py-2.5 text-gray-500">{p.posto ?? "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${ROLE_COLOR[p.role] ?? "text-gray-400 bg-gray-500/10 border-gray-500/30"}`}>
                          {ROLE_LABEL[p.role] ?? p.role}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[p.registration_status] ?? "text-gray-400"}`}>
                          {p.registration_status}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        {p.totp_configured
                          ? <CheckCircle2 className="size-3.5 text-emerald-400 inline" />
                          : <span className="text-gray-600 text-[10px]">—</span>
                        }
                      </td>
                      <td className="px-4 py-2.5 text-gray-500 dark:text-gray-600">
                        {new Date(p.created_at).toLocaleDateString("pt-BR")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label="Ações do usuário"
                            className="inline-flex items-center justify-center size-7 rounded-md text-gray-500 hover:text-gray-200 hover:bg-white/10 transition-colors"
                          >
                            <MoreHorizontal className="size-3.5" />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="min-w-40 dark:bg-[#0D0D14] bg-white border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white"
                          >
                            {p.totp_configured && (
                              <>
                                <DropdownMenuItem
                                  onClick={() => setResetTarget(p)}
                                  className="text-xs text-red-400 hover:text-red-300 focus:text-red-300 hover:bg-red-500/10 cursor-pointer gap-2"
                                >
                                  <ShieldOff className="size-3.5" />
                                  Resetar TOTP
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="dark:bg-[#1E1E2E] bg-gray-200" />
                              </>
                            )}
                            <DropdownMenuItem
                              onClick={() => setSuspendTarget(p)}
                              className="text-xs text-orange-400 hover:text-orange-300 focus:text-orange-300 hover:bg-orange-500/10 cursor-pointer gap-2"
                            >
                              <UserX className="size-3.5" />
                              Suspender conta
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              Mostrando {startIdx}–{endIdx} de {total.toLocaleString("pt-BR")}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0 || loading}
                className="h-7 gap-1 border-gray-200 dark:border-[#1E1E2E] text-gray-400 hover:text-white hover:bg-white/5"
              >
                <ChevronLeft className="size-3.5" />
                Anterior
              </Button>
              <span className="px-3 text-gray-600">
                {page + 1} / {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1 || loading}
                className="h-7 gap-1 border-gray-200 dark:border-[#1E1E2E] text-gray-400 hover:text-white hover:bg-white/5"
              >
                Próximo
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Dialog: Confirmar reset de TOTP */}
      <Dialog open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <DialogContent className="bg-white dark:bg-[#0D0D14] border-gray-200 dark:border-[#1E1E2E] text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <ShieldOff className="size-4 text-red-400" />
              Resetar TOTP
            </DialogTitle>
            <DialogDescription className="text-gray-400 text-sm mt-2">
              O TOTP de{" "}
              <span className="text-white font-medium">{resetTarget?.nome_completo}</span>{" "}
              ({resetTarget?.matricula}) será apagado. O militar precisará reconfigurar o
              autenticador no próximo login.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setResetTarget(null)}
              className="flex-1 border-gray-200 dark:border-[#1E1E2E] text-gray-400 hover:text-white"
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

      {/* Dialog: Suspender conta */}
      <Dialog open={!!suspendTarget} onOpenChange={(o) => { if (!o) setSuspendTarget(null); }}>
        <DialogContent className="bg-white dark:bg-[#0D0D14] border-gray-200 dark:border-[#1E1E2E] text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <UserX className="size-4 text-orange-400" />
              Suspender Conta
            </DialogTitle>
            <DialogDescription className="text-gray-400 text-sm mt-2">
              A conta de{" "}
              <span className="text-white font-medium">{suspendTarget?.nome_completo}</span>{" "}
              ({suspendTarget?.matricula}) será suspensa temporariamente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setSuspendTarget(null)}
              className="flex-1 border-gray-200 dark:border-[#1E1E2E] text-gray-400 hover:text-white"
              disabled={suspending}
            >
              Cancelar
            </Button>
            <Button
              onClick={confirmSuspend}
              disabled={suspending}
              className="flex-1 bg-orange-600 hover:bg-orange-700 text-white"
            >
              {suspending ? <Loader2 className="size-4 animate-spin" /> : "Confirmar Suspensão"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </NexusShell>
  );
}
