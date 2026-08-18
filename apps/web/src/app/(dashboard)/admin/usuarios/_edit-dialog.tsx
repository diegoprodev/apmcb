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
import { Loader2, X, Mail, ShieldAlert, Building2 } from "lucide-react";
import { ApiError, friendlyApiError } from "@/lib/api-error";
import { POSTOS, POSTO_SELECT_CLASS } from "@/lib/postos";
import { ProfileAvatar } from "@/components/profile-avatar";
import { CheckboxCard } from "./_cadastrar-militar-dialog";
import { sendLoginInvite } from "@/lib/send-login-invite";
import { RoleSelect } from "@/components/shared/role-select";
import { allowedRoles, canInvite, canChangeUserEmail } from "@/lib/invite-ceiling";

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
  callerRole?: "admin_global" | "admin_reserva" | "armeiro";
  onUserUpdated?: (updated: Partial<UserData> & { id: string }) => void;
}

const STATUS_LABELS: Record<string, string> = {
  complete: "Completo",
  pending_biometric: "Pendente biometria",
  inactive: "Inativo",
  impedimento_administrativo: "Impedimento Administrativo",
  reactivate: "Reativar conta",
};

// "Completo"/"Pendente biometria" são DERIVADOS do cadastro biométrico real
// (só a RPC de enrollment seta "complete" de verdade, ao consumir um
// challenge de biometria com sucesso — ver PATCH /api/profiles/:id no BFF,
// que agora rejeita qualquer tentativa manual de setar esses 2 valores).
// Achado real de produção reportado pelo dono do produto, com screenshot:
// "quem deve definir status deve ser o sistema, nunca o usuário — ele
// apenas pode colocar impedimento administrativo ou inativo". O <select>
// sempre mostra o valor ATUAL como opção (senão o próprio <select> ficaria
// com um value sem <option> correspondente), mas só oferece os 2 estados
// administrativos como novo alvo — mais "Reativar conta" quando o alvo já
// está suspenso, que o backend resolve pro estado biométrico real (nunca um
// valor escolhido livremente pelo cliente).
//
// "impedimento_administrativo" como ALVO só entra na lista para
// callerRole==="admin_global" — achado real de bug (2026-08-16): o BFF
// (PATCH /api/profiles/:id e /:id/status) já rejeitava com 403 essa
// transição para admin_reserva/armeiro ("Apenas administradores podem
// aplicar impedimento administrativo"), mas este <select> oferecia a opção
// pra QUALQUER callerRole — a UI prometia uma ação que o backend sempre
// recusava. "Inativo" continua disponível pra admin_reserva/armeiro (o
// backend permite).
function buildStatusOptions(
  current: string,
  callerRole: "admin_global" | "admin_reserva" | "armeiro"
): { value: string; label: string }[] {
  const canApplyImpedimento = callerRole === "admin_global";
  const options = [{ value: current, label: STATUS_LABELS[current] ?? current }];
  if (current === "inactive" || current === "impedimento_administrativo") {
    const other = current === "inactive" ? "impedimento_administrativo" : "inactive";
    if (other !== "impedimento_administrativo" || canApplyImpedimento) {
      options.push({ value: other, label: STATUS_LABELS[other] });
    }
    options.push({ value: "reactivate", label: STATUS_LABELS.reactivate });
  } else {
    options.push({ value: "inactive", label: STATUS_LABELS.inactive });
    if (canApplyImpedimento) {
      options.push({ value: "impedimento_administrativo", label: STATUS_LABELS.impedimento_administrativo });
    }
  }
  return options;
}

const selectClass = POSTO_SELECT_CLASS;
const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface ReserveOption {
  id: string;
  nome: string;
}

export function EditUserDialog({ open, onClose, user, currentUserId, callerRole = "admin_global", onUserUpdated }: Props) {
  const router = useRouter();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [posto, setPosto] = useState("");
  const [nomeDeGuerra, setNomeDeGuerra] = useState("");
  const [status, setStatus] = useState<"pending_biometric" | "complete" | "inactive" | "impedimento_administrativo" | "reactivate">("complete");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);
  // Só oferece o campo de papel quando o caller tem teto de privilégio sobre
  // o papel ATUAL do alvo (mesma regra aplicada no backend, PATCH
  // /api/profiles/:id) e quando não é o próprio usuário editando a si mesmo
  // (auto-alteração de papel bloqueada no backend — nem mostrar a UI evita
  // o usuário preencher algo que sempre vai dar 403).
  const isSelf = user?.id === currentUserId;
  const canEditRole = !isSelf && !!user && canInvite(callerRole, user.role);
  const roleOptions = allowedRoles(callerRole);
  // Impedimento administrativo é um estado que só admin_global pode APLICAR
  // (bloqueio deliberado no BFF — PATCH /api/profiles/:id e /:id/status,
  // 403 "Apenas administradores podem aplicar impedimento administrativo").
  // Quando o alvo JÁ está nesse estado e quem edita não é admin_global, o
  // <select> de Status vira texto informativo somente-leitura em vez de
  // oferecer uma transição que o backend sempre rejeitaria — nunca deixar a
  // UI prometer uma ação que dá 403.
  const impedimentoLockedForCaller =
    user?.registration_status === "impedimento_administrativo" && callerRole !== "admin_global";
  // Convite de login — só faz sentido oferecer pra quem ainda não tem
  // e-mail/acesso provisionado. Achado real: não havia NENHUM jeito de
  // conceder login a um usuário existente a partir desta tela — só dava pra
  // fazer isso no fluxo separado de "Cadastrar Usuário", não intuitivo.
  const [sendInvite, setSendInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  // Alterar e-mail de acesso — só para quem JÁ tem e-mail/conta (o oposto do
  // bloco de convite acima) e só admin_global/admin_reserva, nunca armeiro
  // — mesmo que armeiro tenha teto sobre role "usuario" (canInvite), trocar
  // o e-mail de login de alguém que já tem acesso ativo é uma ação mais
  // sensível (revoga o acesso pelo e-mail antigo na hora) e tem um teto
  // PRÓPRIO, independente de canInvite (mesmo gate replicado no backend,
  // ver /api/admin/users route.ts). Achado real do pedido: "só admin_global
  // e admin_reserva podem trocar o e-mail de um usuário se ele perder o
  // acesso" — não existia NENHUM jeito de fazer isso hoje.
  const canChangeEmail = !!user?.email && canChangeUserEmail(callerRole);
  const [changingEmail, setChangingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState("");

  // Seleção de reserva(s) — só relevante quando o PAPEL EFETIVO (o que está
  // selecionado agora, mudando ou não) é armeiro/admin_reserva. Achado real
  // de produto: promover alguém a armeiro/admin_reserva não tinha como
  // escolher em qual reserva do tenant a pessoa vai atuar, nem permitir
  // acesso a mais de uma — um tenant pode ter dezenas de armarias, e um
  // usuário pode legitimamente ser armeiro/admin_reserva de várias (mesmo
  // teto aplicado no backend, ver PATCH /api/profiles/:id).
  const needsReserveSelection = role === "armeiro" || role === "admin_reserva";
  const [availableReserves, setAvailableReserves] = useState<ReserveOption[]>([]);
  const [selectedReserveIds, setSelectedReserveIds] = useState<string[]>([]);
  const [loadingReserves, setLoadingReserves] = useState(false);

  useEffect(() => {
    if (!open || !user || !needsReserveSelection) return;
    let cancelled = false;
    setLoadingReserves(true);
    (async () => {
      try {
        // GET /api/reserves/mine: pra admin_global retorna TODAS as reservas
        // ativas do tenant (opções do picker); pra admin_reserva retorna só
        // a própria reserva ativa da sessão — o backend (PATCH /:id) já
        // reforça esse mesmo teto de qualquer forma, isto é só pra UI não
        // oferecer opção que o backend rejeitaria.
        const [reservesRes, targetRes] = await Promise.all([
          fetch(`${BFF_URL}/api/reserves/mine`, { credentials: "include" }),
          fetch(`${BFF_URL}/api/profiles/${user.id}/reserves`, { credentials: "include" }),
        ]);
        if (cancelled) return;
        if (reservesRes.ok) {
          const data = await reservesRes.json() as { reserves: ReserveOption[] };
          setAvailableReserves(data.reserves ?? []);
        }
        if (targetRes.ok) {
          const data = await targetRes.json() as { reserve_ids: string[] };
          setSelectedReserveIds(data.reserve_ids ?? []);
        } else {
          setSelectedReserveIds([]);
        }
      } catch (err) {
        console.error("[edit-dialog] falha ao carregar reservas", err);
      } finally {
        if (!cancelled) setLoadingReserves(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user, needsReserveSelection]);

  function toggleReserve(id: string) {
    setSelectedReserveIds((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  }

  useEffect(() => {
    if (user && open) {
      setNomeCompleto(user.nome_completo ?? "");
      setPosto(user.posto ?? "");
      setNomeDeGuerra(user.nome_de_guerra ?? "");
      setStatus(user.registration_status);
      setUnidade(user.unidade ?? "");
      setTelefone(user.telefone ?? "");
      setRole(user.role);
      setSendInvite(false);
      setInviteEmail("");
      setChangingEmail(false);
      setNewEmail("");
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
    if (needsReserveSelection && selectedReserveIds.length === 0) {
      toast.error("Selecione ao menos uma reserva para este papel");
      return;
    }
    const trimmedNewEmail = newEmail.trim();
    if (canChangeEmail && changingEmail) {
      if (!trimmedNewEmail) {
        toast.error("Informe o novo e-mail de acesso");
        return;
      }
      if (trimmedNewEmail.toLowerCase() === (user?.email ?? "").toLowerCase()) {
        toast.error("O novo e-mail deve ser diferente do e-mail atual");
        return;
      }
      // Ação sensível e quase irreversível do ponto de vista do usuário
      // afetado (perde o acesso pelo e-mail antigo imediatamente) — exige
      // confirmação explícita, seguindo a regra de UX do projeto
      // ("Confirmação contextual: só para ações destrutivas ou
      // irreversíveis") e o mesmo padrão já usado para reenvio de convite em
      // _cadastrar-militar-dialog.tsx (window.confirm — não existe um
      // AlertDialog dedicado neste repo).
      const confirmed = window.confirm(
        `Alterar o e-mail de acesso de ${user?.nome_completo}?\n\n` +
        `De: ${user?.email}\nPara: ${trimmedNewEmail}\n\n` +
        `O usuário perderá o acesso pelo e-mail antigo e receberá um novo link de acesso no e-mail informado.`
      );
      if (!confirmed) return;
    }
    setLoading(true);
    // Calculado uma vez e reaproveitado no payload de rede e no callback
    // otimista abaixo — evita repetir a mesma condição duas vezes.
    const roleChange = canEditRole && role !== user!.role ? { role } : {};
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
          ...roleChange,
          // Backend decide o papel EFETIVO (novo, se roleChange presente,
          // senão o atual) e aplica o mesmo teto de privilégio na escrita de
          // reserve_memberships — nunca confiar só nesta checagem client-side.
          ...(needsReserveSelection ? { reserve_ids: selectedReserveIds } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        console.error("[edit-dialog] falha ao atualizar usuário", { status: res.status, error: data.error });
        throw new ApiError(friendlyApiError(res.status, data.error, "Erro ao atualizar usuário"), res.status);
      }

      // Convite de login OU troca de e-mail de acesso — mutuamente
      // exclusivos na UI (o bloco de convite só aparece quando !user?.email;
      // o de troca só quando user?.email já existe), então no máximo um dos
      // dois roda por submit. Falha aqui não desfaz a atualização do perfil
      // acima (já persistida com sucesso), só avisa via toast.
      // sendLoginInvite nunca rejeita, então não cai no catch de fora.
      let emailChangedTo: string | null = null;
      if (sendInvite && inviteEmail.trim()) {
        const inviteResult = await sendLoginInvite({ email: inviteEmail.trim(), existingUserId: user!.id });
        if (!inviteResult.ok) {
          console.error("[edit-dialog] usuário atualizado, mas convite de login falhou", inviteResult.message);
          toast.warning(`Usuário atualizado, mas convite falhou: ${inviteResult.message}`);
        } else {
          toast.success(`Usuário atualizado e convite enviado para ${inviteEmail.trim()}`);
        }
      } else if (canChangeEmail && changingEmail && trimmedNewEmail) {
        // Reaproveita o mesmo helper/endpoint do convite (POST /api/admin/users
        // com existing_user_id) — o backend já distingue "primeiro
        // provisionamento" de "troca de e-mail" comparando com o e-mail atual
        // do profile, sem precisar de nenhum client-helper novo aqui.
        const changeResult = await sendLoginInvite({ email: trimmedNewEmail, existingUserId: user!.id });
        if (!changeResult.ok) {
          console.error("[edit-dialog] usuário atualizado, mas troca de e-mail falhou", changeResult.message);
          toast.warning(`Usuário atualizado, mas a troca de e-mail falhou: ${changeResult.message}`);
        } else {
          emailChangedTo = trimmedNewEmail;
          toast.success(`E-mail de acesso alterado para ${trimmedNewEmail}. Novo link de acesso enviado.`);
        }
      } else {
        toast.success("Usuário atualizado com sucesso");
      }

      onUserUpdated?.({
        id: user!.id,
        nome_completo: nomeCompleto.trim(),
        posto: posto || null,
        nome_de_guerra: nomeDeGuerra.trim() || null,
        unidade: unidade.trim() || null,
        telefone: telefone.trim() || null,
        // "reactivate" é um sentinel resolvido pelo servidor (nunca um
        // status real) — passá-lo direto pro estado otimístico da tabela
        // mostraria um valor sem sentido até o router.refresh() corrigir.
        // Omitir aqui deixa a linha com o valor anterior por um instante em
        // vez de um valor errado.
        ...(status !== "reactivate" ? { registration_status: status } : {}),
        ...(roleChange.role ? { role: roleChange.role as UserData["role"] } : {}),
        ...(emailChangedTo ? { email: emailChangedTo } : {}),
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
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs text-muted-foreground">E-mail</Label>
                  {canChangeEmail && (
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline disabled:opacity-50 disabled:pointer-events-none"
                      onClick={() => { setChangingEmail((v) => !v); setNewEmail(""); }}
                      disabled={loading}
                    >
                      {/* "Ocultar" (não "Cancelar") — evita ambiguidade com o
                          botão "Cancelar" do rodapé do dialog, que fecha o
                          modal inteiro; este só recolhe o campo de novo
                          e-mail. */}
                      {changingEmail ? "Ocultar" : "Alterar"}
                    </button>
                  )}
                </div>
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
              {impedimentoLockedForCaller ? (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <ShieldAlert className="size-4 text-destructive shrink-0" />
                  <span className="text-sm font-medium text-destructive">Impedimento Administrativo</span>
                </div>
              ) : (
                <div className="relative">
                  <select
                    id="edit-status"
                    className={selectClass}
                    value={status}
                    onChange={(e) => setStatus(e.target.value as typeof status)}
                    disabled={loading}
                  >
                    {buildStatusOptions(user?.registration_status ?? "complete", callerRole).map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 9l6 6 6-6"/></svg>
                </div>
              )}
            </div>
          </div>

          {/* Papel — só aparece quando o caller tem teto de privilégio sobre
              o papel atual do alvo (ver canEditRole acima); nunca para
              auto-edição. */}
          {canEditRole && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-role">Papel</Label>
              <RoleSelect
                id="edit-role"
                value={role}
                onChange={setRole}
                options={roleOptions}
                disabled={loading}
              />
            </div>
          )}

          {/* Reserva(s) de atuação — só aparece quando o papel selecionado é
              armeiro/admin_reserva. admin_global escolhe entre todas as
              reservas ativas do tenant, com checkbox pra multi-seleção
              (usuário pode ser armeiro/admin_reserva de várias reservas ao
              mesmo tempo — achado real de produto). admin_reserva só vê e só
              pode marcar a própria reserva (o backend rejeitaria qualquer
              outra de qualquer forma — este bloqueio na UI é só pra não
              prometer uma opção que sempre falharia). */}
          {needsReserveSelection && (
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Building2 className="size-3.5" />
                Reserva(s) de atuação *
              </Label>
              {loadingReserves ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Loader2 className="size-3.5 animate-spin" /> Carregando reservas...
                </div>
              ) : availableReserves.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma reserva disponível para atribuir.
                </p>
              ) : (
                <div className="grid gap-1.5 max-h-40 overflow-y-auto rounded-lg border border-border p-2">
                  {availableReserves.map((reserve) => (
                    <label
                      key={reserve.id}
                      className="flex items-center gap-2 text-sm px-2 py-1.5 rounded-md hover:bg-muted/60 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedReserveIds.includes(reserve.id)}
                        onChange={() => toggleReserve(reserve.id)}
                        disabled={loading || (callerRole === "admin_reserva" && availableReserves.length === 1)}
                        className="size-4 rounded border-input accent-primary"
                      />
                      {reserve.nome}
                    </label>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                {callerRole === "admin_reserva"
                  ? "Você só pode atribuir a sua própria reserva."
                  : "Marque uma ou mais reservas onde esta pessoa vai atuar."}
              </p>
            </div>
          )}

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

          {/* Alterar e-mail de acesso — só admin_global/admin_reserva, só
              quando o usuário JÁ tem e-mail/conta (perda de acesso: saiu da
              unidade, e-mail invadido, erro de digitação no cadastro).
              Mesma linguagem visual do bloco de convite abaixo (borda
              tracejada), reaproveitada em vez de inventar um estilo novo. */}
          {canChangeEmail && changingEmail && (
            <div className="rounded-2xl border-2 border-dashed border-border p-4 bg-muted/20 space-y-3">
              <div className="flex items-center gap-3">
                <Mail className="size-5 text-blue-500 shrink-0" />
                <div>
                  <span className="text-sm font-semibold">Alterar e-mail de acesso</span>
                  <p className="text-xs text-muted-foreground">
                    Use quando o usuário perdeu acesso ao e-mail atual. Um novo link de acesso será enviado ao novo e-mail.
                  </p>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <Label htmlFor="edit-new-email">Novo e-mail *</Label>
                <Input
                  id="edit-new-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  disabled={loading}
                  placeholder="novo-email@orgao.gov.br"
                  autoFocus
                />
              </div>
            </div>
          )}

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
