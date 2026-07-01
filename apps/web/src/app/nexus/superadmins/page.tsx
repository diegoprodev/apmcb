"use client";

import { useState, useEffect, useCallback } from "react";
import { NexusShell } from "../_components/nexus-shell";
import { useNexusGuard } from "../_components/use-nexus-guard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, ShieldCheck, CheckCircle2, UserPlus, Mail, AlertTriangle } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "";

interface Superadmin {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
  registration_status: string;
  totp_configured: boolean;
  created_at: string;
}

const STATUS_COLOR: Record<string, string> = {
  active:   "text-emerald-400 bg-emerald-500/10",
  pending:  "text-yellow-400 bg-yellow-500/10",
  inactive: "text-red-400 bg-red-500/10",
};

export default function NexusSuperadminsPage() {
  const { ready } = useNexusGuard();
  const [admins, setAdmins] = useState<Superadmin[]>([]);
  const [loading, setLoading] = useState(false);

  // Convite
  const [showInvite, setShowInvite] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({
    email: "",
    nome_completo: "",
    matricula: "",
    totp_code: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${BFF_URL}/api/nexus/users?role=superadmin&limit=200`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAdmins(data.users ?? []);
    } catch {
      toast.error("Falha ao carregar superadmins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  function handleFormChange(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function validateForm() {
    if (!form.email.trim() || !form.nome_completo.trim() || !form.matricula.trim()) {
      toast.error("Preencha email, nome e matrícula");
      return false;
    }
    if (form.totp_code.length !== 6) {
      toast.error("Digite o código TOTP de 6 dígitos");
      return false;
    }
    return true;
  }

  function openConfirm() {
    if (!validateForm()) return;
    setConfirmOpen(true);
  }

  async function submitInvite() {
    setInviting(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/superadmins/invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao convidar");
      toast.success(`Convite enviado para ${form.email}`);
      setConfirmOpen(false);
      setShowInvite(false);
      setForm({ email: "", nome_completo: "", matricula: "", totp_code: "" });
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar convite");
    } finally {
      setInviting(false);
    }
  }

  if (!ready) {
    return (
      <div className="min-h-dvh bg-gray-50 dark:bg-[#0A0A0F] flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-indigo-400" />
      </div>
    );
  }

  return (
    <NexusShell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-white">Superadmins</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {admins.length} operador(es) com acesso Nexus
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => setShowInvite((v) => !v)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
          >
            <UserPlus className="size-3.5" />
            {showInvite ? "Cancelar" : "Convidar Superadmin"}
          </Button>
        </div>

        {/* Form de convite inline */}
        {showInvite && (
          <div className="bg-white dark:bg-[#0D0D14] border border-indigo-500/30 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <div className="size-6 rounded bg-indigo-500/10 flex items-center justify-center">
                <Mail className="size-3.5 text-indigo-400" />
              </div>
              <p className="text-sm font-medium text-white">Novo Superadmin</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">E-mail *</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => handleFormChange("email", e.target.value)}
                  placeholder="operador@nexus.mil.br"
                  className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-white text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Nome completo *</Label>
                <Input
                  value={form.nome_completo}
                  onChange={(e) => handleFormChange("nome_completo", e.target.value)}
                  placeholder="Cap. João Silva"
                  className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-white text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Matrícula *</Label>
                <Input
                  value={form.matricula}
                  onChange={(e) => handleFormChange("matricula", e.target.value)}
                  placeholder="000000"
                  className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-white font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-300 text-xs">Seu código TOTP *</Label>
                <Input
                  value={form.totp_code}
                  onChange={(e) =>
                    handleFormChange("totp_code", e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="000000"
                  maxLength={6}
                  className="bg-gray-50 dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-white font-mono text-center tracking-widest text-sm"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 mt-1 text-[10px] text-amber-400/80">
              <AlertTriangle className="size-3 shrink-0" />
              <span>
                Um e-mail de convite será enviado. O novo superadmin terá acesso total ao Nexus após aceitar e configurar 2FA.
              </span>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={openConfirm}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm"
              >
                Enviar Convite
              </Button>
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="bg-gray-100 dark:bg-[#12121A] border border-gray-200 dark:border-[#1E1E2E] rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-indigo-400" />
            </div>
          ) : admins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <ShieldCheck className="size-8 text-gray-700" />
              <p className="text-sm text-gray-500">Nenhum superadmin encontrado</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-[#1E1E2E]">
                  <th className="text-left text-gray-500 font-medium px-4 py-2.5">Nome</th>
                  <th className="text-left text-gray-500 font-medium px-4 py-2.5 w-28">Matrícula</th>
                  <th className="text-left text-gray-500 font-medium px-2 py-2.5 w-24">Status</th>
                  <th className="text-center text-gray-500 font-medium px-2 py-2.5 w-16">TOTP</th>
                  <th className="text-left text-gray-500 font-medium px-4 py-2.5 w-28">Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className="border-b border-gray-200 dark:border-[#1E1E2E]/50 hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="size-7 rounded-full bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-[10px] font-bold text-purple-300 shrink-0">
                          {a.nome_completo.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div>
                          <p className="text-gray-200">{a.nome_completo}</p>
                          {a.posto && <p className="text-[10px] text-gray-600">{a.posto}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 font-mono">{a.matricula}</td>
                    <td className="px-2 py-2.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_COLOR[a.registration_status] ?? "text-gray-400"}`}
                      >
                        {a.registration_status}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      {a.totp_configured ? (
                        <CheckCircle2 className="size-3.5 text-emerald-400 inline" />
                      ) : (
                        <span className="text-gray-600 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {new Date(a.created_at).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Confirmação de convite */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) setConfirmOpen(false); }}>
        <DialogContent className="bg-white dark:bg-[#0D0D14] border-gray-200 dark:border-[#1E1E2E] text-white max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <ShieldCheck className="size-4 text-indigo-400" />
              Confirmar Convite
            </DialogTitle>
            <DialogDescription className="text-gray-400 text-sm mt-2 space-y-1">
              <span className="block">
                Você está criando um <span className="text-white font-semibold">Superadmin</span> com acesso total ao painel Nexus.
              </span>
              <span className="block text-amber-400/80 text-xs mt-1">
                Esta ação não pode ser desfeita sem intervenção manual no banco.
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="mt-3 rounded-lg bg-gray-50 dark:bg-[#0A0A0F] border border-gray-200 dark:border-[#1E1E2E] p-3 space-y-1 text-xs">
            <p><span className="text-gray-500">Email:</span> <span className="text-white">{form.email}</span></p>
            <p><span className="text-gray-500">Nome:</span> <span className="text-white">{form.nome_completo}</span></p>
            <p><span className="text-gray-500">Matrícula:</span> <span className="text-white font-mono">{form.matricula}</span></p>
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              className="flex-1 border-gray-200 dark:border-[#1E1E2E] text-gray-400 hover:text-white"
              disabled={inviting}
            >
              Cancelar
            </Button>
            <Button
              onClick={submitInvite}
              disabled={inviting}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {inviting ? <Loader2 className="size-4 animate-spin" /> : "Confirmar e Enviar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </NexusShell>
  );
}
