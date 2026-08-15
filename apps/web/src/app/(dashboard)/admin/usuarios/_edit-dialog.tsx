"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { csrfHeaders } from "@/lib/csrf";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, X, Mail } from "lucide-react";
import { ApiError, friendlyApiError } from "@/lib/api-error";
import { POSTOS, POSTO_SELECT_CLASS } from "@/lib/postos";
import { ProfileAvatar } from "@/components/profile-avatar";
import { CheckboxCard } from "./_cadastrar-militar-dialog";
import { sendLoginInvite } from "@/lib/send-login-invite";

export interface UserData {
  id: string;
  nome_completo: string;
  matricula: string;
  email: string | null;
  role: "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor" | "usuario";
  registration_status: "pending_biometric" | "complete" | "inactive" | "impedimento_administrativo";
  posto: string | null;
  nome_de_guerra: string | null;
  unidade: string | null;
  telefone: string | null;
  foto_url?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  user: UserData | null;
  currentUserId: string;
  onUserUpdated?: (updated: Partial<UserData> & { id: string }) => void;
}

const STATUSES = [
  { value: "complete", label: "Completo" },
  { value: "pending_biometric", label: "Pendente biometria" },
  { value: "inactive", label: "Inativo" },
  { value: "impedimento_administrativo", label: "Impedimento Administrativo" },
];

const selectClass = POSTO_SELECT_CLASS;

export function EditUserDialog({ open, onClose, user, currentUserId: _currentUserId, onUserUpdated }: Props) {
  const router = useRouter();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [posto, setPosto] = useState("");
  const [nomeDeGuerra, setNomeDeGuerra] = useState("");
  const [status, setStatus] = useState<"pending_biometric" | "complete" | "inactive" | "impedimento_administrativo">("complete");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");
  const [loading, setLoading] = useState(false);
  // Convite de login — só faz sentido oferecer pra quem ainda não tem
  // e-mail/acesso provisionado. Achado real: não havia NENHUM jeito de
  // conceder login a um usuário existente a partir desta tela — só dava pra
  // fazer isso no fluxo separado de "Cadastrar Usuário", não intuitivo.
  const [sendInvite, setSendInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(() => {
    if (user && open) {
      setNomeCompleto(user.nome_completo ?? "");
      setPosto(user.posto ?? "");
      setNomeDeGuerra(user.nome_de_guerra ?? "");
      setStatus(user.registration_status);
      setUnidade(user.unidade ?? "");
      setTelefone(user.telefone ?? "");
      setSendInvite(false);
      setInviteEmail("");
    }
  }, [user, open]);

  async function handleSave() {
    if (!nomeCompleto.trim()) {
      toast.error("Nome completo é obrigatório");
      return;
    }
    if (sendInvite && !inviteEmail.trim()) {
      toast.error("Informe o e-mail para enviar o convite de login");
      return;
    }
    setLoading(true);
    try {
      const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";
      const res = await fetch(`${BFF_URL}/api/profiles/${user!.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          nome_completo:       nomeCompleto.trim(),
          posto:               posto || null,
          nome_de_guerra:      nomeDeGuerra.trim() || null,
          registration_status: status,
          unidade:             unidade.trim() || null,
          telefone:            telefone.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        console.error("[edit-dialog] falha ao atualizar usuário", { status: res.status, error: data.error });
        throw new ApiError(friendlyApiError(res.status, data.error, "Erro ao atualizar usuário"), res.status);
      }

      // Convite de login opcional — falha aqui não desfaz a atualização do
      // perfil acima (já persistida com sucesso), só avisa via toast.
      // sendLoginInvite nunca rejeita, então não cai no catch de fora.
      if (sendInvite && inviteEmail.trim()) {
        const inviteResult = await sendLoginInvite({ email: inviteEmail.trim(), existingUserId: user!.id });
        if (!inviteResult.ok) {
          console.error("[edit-dialog] usuário atualizado, mas convite de login falhou", inviteResult.message);
          toast.warning(`Usuário atualizado, mas convite falhou: ${inviteResult.message}`);
        } else {
          toast.success(`Usuário atualizado e convite enviado para ${inviteEmail.trim()}`);
        }
      } else {
        toast.success("Usuário atualizado com sucesso");
      }

      onUserUpdated?.({
        id: user!.id,
        nome_completo: nomeCompleto.trim(),
        posto: posto || null,
        nome_de_guerra: nomeDeGuerra.trim() || null,
        registration_status: status,
        unidade: unidade.trim() || null,
        telefone: telefone.trim() || null,
      });
      onClose();
      router.refresh();
    } catch (err: unknown) {
      toast.error(err instanceof ApiError ? err.message : "Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      {/* sm:max-w-lg (não max-w-lg puro) — mesmo achado do modal de
          solicitar material: DialogContent base define sm:max-w-sm, que
          vence qualquer max-w-* sem prefixo em telas ≥640px. */}
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Usuário</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Foto + info imutável */}
          <div className="flex items-center gap-4">
            {user?.foto_url ? (
              <>
                <ProfileAvatar
                  profileId={user.id}
                  photoPath={user.foto_url}
                  name={user.nome_completo}
                  className="h-16 w-16 shrink-0 cursor-zoom-in rounded-xl transition-opacity hover:opacity-90"
                  onClick={() => setPhotoOpen(true)}
                />
                {photoOpen && createPortal(
                  <div
                    className="fixed inset-0 z-300 flex items-center justify-center"
                    style={{ backgroundColor: "rgba(0,0,0,0.92)" }}
                    onClick={() => setPhotoOpen(false)}
                  >
                    <ProfileAvatar
                      profileId={user.id}
                      photoPath={user.foto_url}
                      name={user.nome_completo}
                      className="h-[min(88vw,88vh)] w-[min(88vw,88vh)] rounded-2xl shadow-2xl"
                      imageClassName="object-contain"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button
                      className="absolute top-5 right-5 text-white/70 hover:text-white transition-colors"
                      onClick={() => setPhotoOpen(false)}
                    >
                      <X className="size-8" />
                    </button>
                  </div>,
                  document.body
                )}
              </>
            ) : (
              <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-xl font-bold shrink-0">
                {user?.nome_completo?.slice(0, 2).toUpperCase() ?? "?"}
              </div>
            )}
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Matrícula (imutável)</Label>
                <p className="font-mono text-sm bg-muted px-3 py-2 rounded-lg">{user?.matricula}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">E-mail</Label>
                <p className="text-sm bg-muted px-3 py-2 rounded-lg truncate text-muted-foreground">
                  {user?.email ?? "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Nome */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-nome">Nome completo *</Label>
            <Input
              id="edit-nome"
              value={nomeCompleto}
              onChange={(e) => setNomeCompleto(e.target.value)}
              disabled={loading}
              autoFocus
            />
          </div>

          {/* Posto/Graduação + Status */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-posto">Posto/Graduação</Label>
              <div className="relative">
                <select
                  id="edit-posto"
                  className={selectClass}
                  value={posto}
                  onChange={(e) => setPosto(e.target.value)}
                  disabled={loading}
                >
                  <option value="">Sem graduação</option>
                  {POSTOS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="edit-status">Status</Label>
              <div className="relative">
                <select
                  id="edit-status"
                  className={selectClass}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as typeof status)}
                  disabled={loading}
                >
                  {STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
              </div>
            </div>
          </div>

          {/* Nome de guerra */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-nome-guerra">Nome de guerra</Label>
            <Input
              id="edit-nome-guerra"
              value={nomeDeGuerra}
              onChange={(e) => setNomeDeGuerra(e.target.value)}
              disabled={loading}
              placeholder="Ex: Silva, Rodrigues..."
            />
          </div>

          {/* Unidade */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-unidade">Unidade (local de trabalho)</Label>
            <Input
              id="edit-unidade"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              disabled={loading}
              placeholder="Ex: 1ª Cia, APMCB, Comando..."
            />
          </div>

          {/* Telefone */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-telefone">Telefone</Label>
            <Input
              id="edit-telefone"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              disabled={loading}
              placeholder="(83) 9 9999-9999"
              inputMode="tel"
            />
          </div>

          {/* Convite de login — só para quem ainda não tem acesso */}
          {!user?.email && (
            <div className="rounded-2xl border-2 border-dashed border-border p-4 bg-muted/20 space-y-3">
              <CheckboxCard
                id="edit-send-invite"
                checked={sendInvite}
                onChange={setSendInvite}
                disabled={loading}
                icon={<Mail className="size-5" />}
                iconColor="text-blue-500"
                title="Enviar login e permissão de acesso"
                description="Envia um link de acesso por e-mail para este usuário"
              />

              {sendInvite && (
                <div className="space-y-1.5 pt-1">
                  <Label htmlFor="edit-invite-email">E-mail do usuário *</Label>
                  <Input
                    id="edit-invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    disabled={loading}
                    placeholder="usuario@orgao.gov.br"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading || !nomeCompleto.trim()}>
            {loading && <Loader2 className="size-4 animate-spin mr-1.5" />}
            Salvar alterações
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
