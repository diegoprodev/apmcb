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
import {
  Loader2, ShieldCheck, CheckCircle2, UserPlus,
  Mail, AlertTriangle, Pencil, Trash2, XCircle,
} from "lucide-react";
import { csrfHeaders } from "@/lib/csrf";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";

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

const STATUS_LABEL: Record<string, string> = {
  complete: "Ativo",
  pending_biometric: "Pendente",
  inactive: "Inativo",
  impedimento_administrativo: "Impedido",
};

const STATUS_COLOR: Record<string, string> = {
  complete:   "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10",
  pending_biometric: "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-500/10",
  inactive:   "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10",
  impedimento_administrativo: "text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-500/10",
};

export default function NexusSuperadminsPage() {
  const { ready } = useNexusGuard();
  const [admins, setAdmins] = useState<Superadmin[]>([]);
  const [loading, setLoading] = useState(false);

  // Convite
  const [showInvite, setShowInvite] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "", nome_completo: "", matricula: "", totp_code: "",
  });

  // Editar
  const [editTarget, setEditTarget] = useState<Superadmin | null>(null);
  const [editForm, setEditForm] = useState({ nome_completo: "", matricula: "", posto: "", registration_status: "" });
  const [saving, setSaving] = useState(false);

  // Remover
  const [deleteTarget, setDeleteTarget] = useState<Superadmin | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/users?role=superadmin&limit=200`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setAdmins(data.users ?? []);
    } catch {
      toast.error("Falha ao carregar superadmins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (ready) load(); }, [ready, load]);

  function openEdit(a: Superadmin) {
    setEditTarget(a);
    setEditForm({
      nome_completo: a.nome_completo,
      matricula: a.matricula,
      posto: a.posto ?? "",
      registration_status: a.registration_status,
    });
  }

  async function saveEdit() {
    if (!editTarget) return;
    setSaving(true);
    try {
      const body: Record<string, string | null> = {
        nome_completo: editForm.nome_completo,
        matricula: editForm.matricula,
        registration_status: editForm.registration_status,
      };
      if (editForm.posto !== undefined) body.posto = editForm.posto || null;
      const res = await fetch(`${BFF_URL}/api/nexus/superadmins/${editTarget.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao salvar");
      toast.success("Superadmin atualizado");
      setEditTarget(null);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/superadmins/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "include",
        headers: csrfHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao remover");
      toast.success(`Acesso de ${deleteTarget.nome_completo} removido`);
      setDeleteTarget(null);
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    } finally {
      setDeleting(false);
    }
  }

  async function submitInvite() {
    setInviting(true);
    try {
      const res = await fetch(`${BFF_URL}/api/nexus/superadmins/invite`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(inviteForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Erro ao convidar");
      toast.success(`Convite enviado para ${inviteForm.email}`);
      setConfirmOpen(false);
      setShowInvite(false);
      setInviteForm({ email: "", nome_completo: "", matricula: "", totp_code: "" });
      load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro ao enviar convite");
    } finally {
      setInviting(false);
    }
  }

  if (!ready) return (
    <div className="min-h-dvh bg-white dark:bg-[#0A0A0F] flex items-center justify-center">
      <Loader2 className="size-6 animate-spin text-indigo-400" />
    </div>
  );

  return (
    <NexusShell>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">Superadmins</h1>
            <p className="text-xs text-gray-500 mt-0.5">{admins.length} operador(es) com acesso Nexus</p>
          </div>
          <Button size="sm" onClick={() => setShowInvite((v) => !v)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5">
            <UserPlus className="size-3.5" />
            {showInvite ? "Cancelar" : "Convidar Superadmin"}
          </Button>
        </div>

        {/* Form convite inline */}
        {showInvite && (
          <div className="bg-white dark:bg-[#0D0D14] border border-indigo-500/30 rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="size-6 rounded bg-indigo-500/10 flex items-center justify-center">
                <Mail className="size-3.5 text-indigo-400" />
              </div>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">Novo Superadmin</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: "E-mail *", field: "email" as const, type: "email", placeholder: "operador@nexus.mil.br" },
                { label: "Nome completo *", field: "nome_completo" as const, placeholder: "Cap. João Silva" },
                { label: "Matrícula *", field: "matricula" as const, placeholder: "000000", mono: true },
                { label: "Seu código TOTP *", field: "totp_code" as const, placeholder: "000000", mono: true, center: true },
              ].map(({ label, field, type, placeholder, mono, center }) => (
                <div key={field} className="space-y-1.5">
                  <Label className="text-gray-600 dark:text-gray-300 text-xs">{label}</Label>
                  <Input
                    type={type ?? "text"}
                    value={inviteForm[field]}
                    onChange={(e) => setInviteForm((f) => ({ ...f, [field]: field === "totp_code" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value }))}
                    placeholder={placeholder}
                    maxLength={field === "totp_code" ? 6 : undefined}
                    className={cn("bg-white dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white text-sm", mono && "font-mono", center && "text-center tracking-widest")}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-amber-500">
              <AlertTriangle className="size-3 shrink-0" />
              <span>Um e-mail de convite será enviado. O novo superadmin terá acesso total ao Nexus após aceitar e configurar 2FA.</span>
            </div>
            <div className="flex justify-end">
              <Button onClick={() => {
                if (!inviteForm.email || !inviteForm.nome_completo || !inviteForm.matricula) { toast.error("Preencha todos os campos obrigatórios"); return; }
                if (inviteForm.totp_code.length !== 6) { toast.error("Código TOTP deve ter 6 dígitos"); return; }
                setConfirmOpen(true);
              }} className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm">
                Enviar Convite
              </Button>
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="bg-white dark:bg-[#12121A] border border-gray-200 dark:border-[#1E1E2E] rounded-xl overflow-hidden shadow-sm dark:shadow-none">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="size-5 animate-spin text-indigo-400" />
            </div>
          ) : admins.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <ShieldCheck className="size-8 text-gray-300 dark:text-gray-700" />
              <p className="text-sm text-gray-500">Nenhum superadmin encontrado</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-[#1E1E2E]">
                  <th className="text-left text-gray-500 font-medium px-4 py-3">Nome</th>
                  <th className="text-left text-gray-500 font-medium px-4 py-3 w-32">Matrícula</th>
                  <th className="text-left text-gray-500 font-medium px-2 py-3 w-28">Status</th>
                  <th className="text-center text-gray-500 font-medium px-2 py-3 w-16">TOTP</th>
                  <th className="text-left text-gray-500 font-medium px-4 py-3 w-28">Cadastro</th>
                  <th className="text-right text-gray-500 font-medium px-4 py-3 w-20">Ações</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className="border-b border-gray-100 dark:border-[#1E1E2E]/50 hover:bg-gray-50 dark:hover:bg-white/2 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="size-7 rounded-full bg-purple-100 dark:bg-purple-600/20 border border-purple-200 dark:border-purple-500/30 flex items-center justify-center text-[10px] font-bold text-purple-700 dark:text-purple-300 shrink-0">
                          {a.nome_completo.split(" ").map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
                        </div>
                        <div>
                          <p className="text-gray-900 dark:text-gray-200 font-medium">{a.nome_completo}</p>
                          {a.posto && <p className="text-[10px] text-gray-500 dark:text-gray-600">{a.posto}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500 font-mono">{a.matricula}</td>
                    <td className="px-2 py-3">
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-medium", STATUS_COLOR[a.registration_status] ?? "text-gray-500")}>
                        {STATUS_LABEL[a.registration_status] ?? a.registration_status}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-center">
                      {a.totp_configured
                        ? <CheckCircle2 className="size-3.5 text-emerald-500 dark:text-emerald-400 inline" />
                        : <XCircle className="size-3.5 text-gray-300 dark:text-gray-600 inline" />}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {formatDate(a.created_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(a)}
                          title="Editar superadmin"
                          className="p-1.5 rounded-md text-gray-400 hover:text-indigo-500 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-colors"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(a)}
                          title="Remover acesso Nexus"
                          className="p-1.5 rounded-md text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Dialog: Confirmar convite */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!o) setConfirmOpen(false); }}>
        <DialogContent className="bg-white dark:bg-[#0D0D14] border-gray-200 dark:border-[#1E1E2E] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="size-4 text-indigo-500" />
              Confirmar Convite
            </DialogTitle>
            <DialogDescription className="text-gray-500 text-sm mt-1">
              Criando <span className="text-gray-900 dark:text-white font-semibold">Superadmin</span> com acesso total ao Nexus.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 rounded-lg bg-white dark:bg-[#0A0A0F] border border-gray-200 dark:border-[#1E1E2E] p-3 space-y-1 text-xs">
            <p><span className="text-gray-500">Email:</span> <span className="text-gray-900 dark:text-white">{inviteForm.email}</span></p>
            <p><span className="text-gray-500">Nome:</span> <span className="text-gray-900 dark:text-white">{inviteForm.nome_completo}</span></p>
            <p><span className="text-gray-500">Matrícula:</span> <span className="text-gray-900 dark:text-white font-mono">{inviteForm.matricula}</span></p>
          </div>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={inviting} className="flex-1">Cancelar</Button>
            <Button onClick={submitInvite} disabled={inviting} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white">
              {inviting ? <Loader2 className="size-4 animate-spin" /> : "Confirmar e Enviar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: Editar superadmin */}
      <Dialog open={!!editTarget} onOpenChange={(o) => { if (!o) setEditTarget(null); }}>
        <DialogContent className="bg-white dark:bg-[#0D0D14] border-gray-200 dark:border-[#1E1E2E] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-gray-900 dark:text-white">Editar Superadmin</DialogTitle>
            <DialogDescription className="text-gray-500 text-sm">Atualize os dados do operador Nexus.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-gray-600 dark:text-gray-300 text-sm">Nome completo</Label>
              <Input value={editForm.nome_completo} onChange={(e) => setEditForm((f) => ({ ...f, nome_completo: e.target.value }))}
                className="bg-white dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-gray-600 dark:text-gray-300 text-sm">Matrícula</Label>
                <Input value={editForm.matricula} onChange={(e) => setEditForm((f) => ({ ...f, matricula: e.target.value }))}
                  className="bg-white dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-gray-600 dark:text-gray-300 text-sm">Posto / Cargo</Label>
                <Input value={editForm.posto} onChange={(e) => setEditForm((f) => ({ ...f, posto: e.target.value }))}
                  placeholder="Ex: Cap., Maj., Cel."
                  className="bg-white dark:bg-[#0A0A0F] border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-gray-600 dark:text-gray-300 text-sm">Status</Label>
              <select value={editForm.registration_status} onChange={(e) => setEditForm((f) => ({ ...f, registration_status: e.target.value }))}
                className="w-full h-9 rounded-md bg-white dark:bg-[#0A0A0F] border border-gray-200 dark:border-[#1E1E2E] text-gray-900 dark:text-white text-sm px-3">
                <option value="complete">Ativo</option>
                <option value="inactive">Inativo</option>
                <option value="pending_biometric">Pendente</option>
                <option value="impedimento_administrativo">Impedimento Administrativo</option>
              </select>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" onClick={() => setEditTarget(null)} disabled={saving} className="flex-1">Cancelar</Button>
              <Button onClick={saveEdit} disabled={saving} className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white">
                {saving ? <Loader2 className="size-4 animate-spin" /> : "Salvar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: Remover superadmin */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <DialogContent className="bg-white dark:bg-[#0D0D14] border-gray-200 dark:border-[#1E1E2E] max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 dark:text-red-400 flex items-center gap-2">
              <Trash2 className="size-4" />
              Remover acesso Nexus
            </DialogTitle>
            <DialogDescription className="text-gray-500 text-sm mt-1">
              <span className="font-semibold text-gray-900 dark:text-white">{deleteTarget?.nome_completo}</span> perderá o acesso ao painel Nexus. O usuário será movido para role <code className="text-xs">usuario</code> e desativado.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting} className="flex-1">Cancelar</Button>
            <Button onClick={confirmDelete} disabled={deleting} className="flex-1 bg-red-600 hover:bg-red-700 text-white">
              {deleting ? <Loader2 className="size-4 animate-spin" /> : "Confirmar Remoção"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </NexusShell>
  );
}
