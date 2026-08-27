"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FingerSelector } from "@/components/ui/finger-selector";
import {
  Loader2, CheckCircle2, Camera, X, Fingerprint, Mail, KeyRound,
  Search, AlertTriangle, UserPlus, UserCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { csrfHeaders } from "@/lib/csrf";
import { ApiError, friendlyApiError } from "@/lib/api-error";
import { POSTOS, POSTO_SELECT_CLASS } from "@/lib/postos";
import { sendLoginInvite } from "@/lib/send-login-invite";
import { allowedRoles, ROLE_LABELS } from "@/lib/invite-ceiling";
import { RoleSelect } from "@/components/shared/role-select";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:3001";

interface Props {
  open: boolean;
  onClose: () => void;
  callerRole?: "admin_global" | "admin_reserva" | "armeiro";
}

interface ProfileHit {
  id: string;
  nome_completo: string;
  matricula: string;
  posto: string | null;
  unidade: string | null;
  email: string | null;
  invite_sent_at: string | null;
  account_activated_at: string | null;
  role: string;
}

function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

/**
 * Checkbox customizado com input nativo cobrindo 100% da área clicável do
 * label (em vez de sr-only). Padrão anterior tinha o <input sr-only> por
 * baixo da <div> decorativa do quadradinho — cliques automatizados (e, em
 * alguns navegadores, cliques reais em certas posições) eram interceptados
 * pela div, que ficava por cima na pilha de empilhamento. Cobrindo a área
 * inteira com o input real (opacity-0 em vez de sr-only) o ponto de clique
 * e o alvo do evento sempre coincidem.
 */
export function CheckboxCard({
  id, checked, onChange, disabled, icon, iconColor, title, description,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  description: string;
}) {
  return (
    <label htmlFor={id} className="relative flex items-center gap-3 cursor-pointer group">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      />
      <div
        className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors shrink-0
          ${checked ? "bg-primary border-primary" : "border-border group-hover:border-primary/50"}`}
      >
        {checked && (
          <svg className="w-3 h-3 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </div>
      <div className={iconColor}>{icon}</div>
      <div>
        <span className="text-sm font-semibold">{title}</span>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </label>
  );
}

/**
 * Cadastro de militar unificado com provisionamento de acesso.
 *
 * Substitui o antigo par de dialogs "Cadastrar Usuário" (registro sem
 * login) + "Criar Login" (busca militar existente e provisiona acesso).
 * Eram duas entradas separadas para uma mesma tarefa lógica — cadastrar
 * (ou localizar) um militar e, opcionalmente, dar acesso a ele — o que o
 * dono do produto reportou como redundante e confuso.
 *
 * Toggle "Novo militar" / "Militar já cadastrado" no topo decide o modo:
 *  - Novo militar: formulário completo (dados, foto, biometria) + convite
 *    de acesso opcional no mesmo passo (checkbox "Enviar convite agora").
 *  - Militar já cadastrado: busca por nome/matrícula (mesma lógica da
 *    extinta CreateUserDialog) e provisiona acesso ao selecionado.
 *
 * callerRole "armeiro": só pode criar/conceder acesso a role "usuario".
 * callerRole "admin_reserva": "usuario" e "armeiro".
 * callerRole "admin_global": sem restrição adicional aqui (endpoints
 * de backend replicam o mesmo teto — ver privilege ceiling em
 * apps/bff/src/routes/admin.ts e apps/web/src/app/api/admin/users/route.ts).
 */
export function CadastrarUsuarioDialog({ open, onClose, callerRole = "admin_global" }: Props) {
  const router = useRouter();

  const [mode, setMode] = useState<"novo" | "existente">("novo");

  // ── Campos do militar novo ────────────────────────────────────────────
  const [nomeCompleto, setNomeCompleto] = useState("");
  const [matricula, setMatricula] = useState("");
  const [posto, setPosto] = useState("");
  const [nomeDeGuerra, setNomeDeGuerra] = useState("");
  const [unidade, setUnidade] = useState("");
  const [telefone, setTelefone] = useState("");

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [captureBio, setCaptureBio] = useState(false);
  const [fingerIndex, setFingerIndex] = useState<number | null>(null);

  // Deriva do teto canônico (invite-ceiling.ts) em vez de uma lista
  // hardcoded — achado de code review: a versão anterior era uma 4ª cópia
  // independente do mesmo teto (BFF + route.ts + este boolean), sem
  // nenhuma ligação com allowedRoles(); se o teto mudasse, era fácil
  // esquecer de atualizar aqui também. Achado real de produção: o seletor
  // só oferecia Usuário/Armeiro mesmo para admin_global/admin_reserva, que
  // deveriam poder atribuir qualquer papel do próprio teto (Admin Reserva,
  // Auditor etc.) já na criação — não só via edição posterior.
  const roleOptions = allowedRoles(callerRole);
  const canPickRole = roleOptions.length > 1;
  // "usuario" só é um default seguro porque hoje é sempre o menor papel do
  // teto de qualquer caller — deriva de roleOptions em vez de hardcoded
  // pra não quebrar silenciosamente se o teto mudar (achado de code review).
  const [initialRole, setInitialRole] = useState(roleOptions[0] ?? "usuario");

  // ── Busca de militar existente ────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<ProfileHit | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Convite de acesso (compartilhado pelos dois modos) ────────────────
  const [sendInvite, setSendInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMethod, setInviteMethod] = useState<"magic_link" | "password">("magic_link");
  const [invitePassword, setInvitePassword] = useState("");

  const [loading, setLoading] = useState(false);
  // Achado MÉDIO de code review (DRY/SSOT): useConfirm<T>() extrai o par
  // useState+abrir/cancelar repetido em 5 arquivos. Sem alvo por item aqui
  // (o dado real é selectedProfile, já em state) — useConfirm<true>() como
  // sinalizador puro, mesmo padrão de _criar-armeiro-client.tsx.
  const { pending: resendConfirmPending, request: requestResend, cancel: cancelResend } = useConfirm<true>();
  const [done, setDone] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  function reset() {
    setMode("novo");
    setNomeCompleto(""); setMatricula(""); setPosto("");
    setNomeDeGuerra(""); setUnidade(""); setTelefone("");
    setPhotoFile(null); setPhotoPreview(null);
    setCaptureBio(false); setFingerIndex(null);
    setInitialRole("usuario");
    setSearchQuery(""); setSearchResults([]); setSelectedProfile(null);
    setSendInvite(false); setInviteEmail(""); setInviteMethod("magic_link"); setInvitePassword("");
    setDone(false); setInviteSent(false);
    // Achado MÉDIO de code review: mesmo motivo do reset de pendingEmailChange
    // em _edit-dialog.tsx — showResendConfirm controla o `open` do AlertDialog
    // e não tinha nenhum ponto de reset, apesar deste componente ficar
    // permanentemente montado entre aberturas (`open` é só uma prop).
    cancelResend();
  }

  function handleClose() { reset(); onClose(); }

  function switchMode(next: "novo" | "existente") {
    if (next === mode) return;
    setMode(next);
    // Campos de um modo não fazem sentido pro outro — evita submeter estado velho.
    setSearchQuery(""); setSearchResults([]); setSelectedProfile(null);
    setSendInvite(false); setInviteEmail(""); setInvitePassword("");
  }

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Foto deve ter no máximo 5 MB"); return; }
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  function clearPhoto() {
    setPhotoFile(null); setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function uploadPhoto(targetProfileId: string): Promise<void> {
    if (!photoFile) return;
    const fd = new FormData();
    fd.append("file", photoFile);
    const res = await fetch(`${BFF_URL}/api/profiles/${targetProfileId}/photo`, {
      method: "POST",
      credentials: "include",
      headers: { ...csrfHeaders() },
      body: fd,
    });
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      console.error("[cadastrar-militar] falha ao enviar foto", { status: res.status, error: data.error });
      throw new ApiError(friendlyApiError(res.status, data.error, "Erro ao enviar foto"), res.status);
    }
  }

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        // role=any: busca em todos os papéis dentro do teto do caller — achado
        // real de produção (2026-08-15): antes só encontrava role=usuario, então
        // um admin_global não conseguia achar um admin_reserva/admin_global/
        // auditor JÁ CADASTRADO pra reenviar convite.
        const res = await fetch(`/api/admin/search-profiles?role=any&q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data : []);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  function selectProfile(p: ProfileHit) {
    setSelectedProfile(p);
    setSearchResults([]);
    setSearchQuery("");
    if (p.email) setInviteEmail(p.email);
  }

  function clearSelected() {
    setSelectedProfile(null);
    setInviteEmail("");
  }

  async function handleCadastrarNovo() {
    if (!nomeCompleto.trim() || !matricula.trim()) {
      toast.error("Nome completo e matrícula são obrigatórios");
      return;
    }
    if (captureBio && fingerIndex === null) {
      toast.error("Selecione o dedo para captura biométrica");
      return;
    }
    if (sendInvite && !inviteEmail.trim()) {
      toast.error("Informe o e-mail para envio do convite");
      return;
    }
    if (sendInvite && inviteMethod === "password" && invitePassword.length < 6) {
      toast.error("Senha deve ter ao menos 6 caracteres");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${BFF_URL}/api/admin/militares`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          nome_completo: nomeCompleto.trim(),
          matricula: matricula.trim(),
          posto: posto || null,
          nome_de_guerra: nomeDeGuerra.trim() || null,
          role: initialRole,
          unidade: unidade.trim() || null,
          telefone: telefone.trim() || null,
          biometria_pendente: captureBio,
          finger_index: captureBio ? fingerIndex : null,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        console.error("[cadastrar-militar] falha ao cadastrar usuário", { status: res.status, error: body.error });
        throw new ApiError(friendlyApiError(res.status, body.error, "Erro ao cadastrar usuário"), res.status);
      }

      const userId = body.user_id as string;

      if (photoFile && userId) {
        try {
          await uploadPhoto(userId);
        } catch (error) {
          console.error("[cadastrar-militar] usuário criado, mas foto falhou", error);
          toast.warning("Militar cadastrado, mas a foto não foi salva");
        }
      }

      // Always provision TOTP for the new military user
      if (userId) {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        const authHeader: Record<string, string> = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        await fetch(`${BFF_URL}/api/totp/admin-provision`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...authHeader, ...csrfHeaders() },
          body: JSON.stringify({ user_id: userId }),
        });
      }

      // Send login invite if requested — sendLoginInvite nunca rejeita, então
      // uma falha aqui não derruba o try inteiro (usuário já foi criado).
      if (sendInvite && userId && inviteEmail.trim()) {
        const inviteResult = await sendLoginInvite({
          email: inviteEmail.trim(),
          existingUserId: userId,
          method: inviteMethod,
          password: inviteMethod === "password" ? invitePassword : undefined,
        });
        if (!inviteResult.ok) {
          console.error("[cadastrar-militar] usuário criado, mas convite de acesso falhou", inviteResult.message);
          toast.warning(`Usuário cadastrado, mas convite falhou: ${inviteResult.message} — tente reenviar mais tarde`);
        } else {
          setInviteSent(true);
        }
      }

      setDone(true);
      router.refresh();
    } catch (err: unknown) {
      console.error("[cadastrar-militar] falha ao cadastrar usuário", err);
      toast.error(err instanceof ApiError ? err.message : "Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function handleProvisionarExistente() {
    if (!selectedProfile) {
      toast.error("Selecione um militar já cadastrado");
      return;
    }
    // Achado real de produção (2026-08-15): busca por role=any agora também
    // encontra admin_reserva/admin_global/auditor JÁ ATIVOS — sem este guard,
    // este fluxo (pensado pra PRIMEIRO acesso) sobrescreveria silenciosamente
    // o e-mail de login de uma conta admin já em uso ativo. Contas com
    // account_activated_at só devem ter o e-mail trocado pelo fluxo dedicado
    // de edição de usuário (com confirmação explícita).
    if (selectedProfile.account_activated_at) {
      toast.error("Esta conta já está ativa — use a edição de usuário pra alterar o e-mail.");
      return;
    }
    if (!inviteEmail.trim()) {
      toast.error("Informe o e-mail do usuário");
      return;
    }
    if (inviteMethod === "password" && invitePassword.length < 6) {
      toast.error("Senha deve ter ao menos 6 caracteres");
      return;
    }
    // Achado de code review: migrado de window.confirm pro AlertDialog
    // compartilhado — abre o diálogo e para aqui; doProvisionarExistente só
    // roda no clique de confirmar.
    if (selectedProfile.invite_sent_at) {
      const mins = minutesSince(selectedProfile.invite_sent_at);
      if (mins !== null && mins < 10) {
        requestResend(true);
        return;
      }
    }
    void doProvisionarExistente();
  }

  async function doProvisionarExistente() {
    // Achado de code review: guard defensivo — handleProvisionarExistente já
    // valida selectedProfile antes de chegar aqui, mas se o estado divergir
    // (ex: confirmResendExistente chamado com selectedProfile já limpo),
    // "Reenviar" não deve falhar em silêncio.
    if (!selectedProfile) {
      toast.error("Selecione um militar já cadastrado");
      return;
    }
    setLoading(true);
    try {
      const inviteResult = await sendLoginInvite({
        email: inviteEmail.trim(),
        existingUserId: selectedProfile.id,
        method: inviteMethod,
        password: inviteMethod === "password" ? invitePassword : undefined,
      });
      if (!inviteResult.ok) {
        console.error("[cadastrar-militar] falha ao provisionar acesso", inviteResult.message);
        throw new ApiError(inviteResult.message ?? "Erro ao provisionar acesso", 500);
      }
      // Limpa o pending de confirmação só no sucesso (mesmo padrão de
      // _edit-dialog.tsx) — em erro, o AlertDialog permanece aberto pra
      // retry; onOpenChange abaixo já bloqueia fechar via Esc/backdrop
      // enquanto `loading`.
      cancelResend();
      setInviteSent(true);
      setDone(true);
      router.refresh();
    } catch (err: unknown) {
      console.error("[cadastrar-militar] falha ao provisionar acesso", err);
      toast.error(err instanceof ApiError ? err.message : "Erro de conexão. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  function confirmResendExistente() {
    void doProvisionarExistente();
  }

  function handleSubmit() {
    if (mode === "novo") return handleCadastrarNovo();
    return handleProvisionarExistente();
  }

  const canSubmitNovo = !loading && !!nomeCompleto.trim() && !!matricula.trim() && !(captureBio && fingerIndex === null);
  const canSubmitExistente = !loading && !!selectedProfile && !selectedProfile.account_activated_at && !!inviteEmail.trim() &&
    !(inviteMethod === "password" && invitePassword.length < 6);
  const canSubmit = mode === "novo" ? canSubmitNovo : canSubmitExistente;
  const isResend = mode === "existente" && !!selectedProfile;

  return (
    // BAIXO de code review (mesma simetria aplicada em _edit-dialog.tsx):
    // sem o `!loading`, Esc/backdrop fechava o Dialog pai — e aqui
    // handleClose() chama reset() antes de onClose(), o que apagaria todo o
    // formulário e resetaria showResendConfirm/loading enquanto uma request
    // (handleCadastrarNovo/doProvisionarExistente) ainda estava em voo.
    <Dialog open={open} onOpenChange={(o) => { if (!o && !loading) handleClose(); }}>
      {/* sm:max-w-2xl (não max-w-2xl puro) — DialogContent base define
          sm:max-w-sm, que vence um max-w-2xl sem prefixo em qualquer tela
          ≥640px (mesmo achado do modal de solicitar material). */}
      <DialogContent className="max-h-[94dvh] sm:max-w-2xl overflow-y-auto p-0" data-testid="cadastrar-usuario-dialog">
        <div className="sticky top-0 z-10 bg-card border-b border-border px-6 py-4">
          <DialogHeader>
            <DialogTitle className="text-xl">Cadastrar Usuário</DialogTitle>
          </DialogHeader>
        </div>

        {done ? (
          <div className="py-16 flex flex-col items-center gap-4 text-center px-6">
            <CheckCircle2 className="size-14 text-emerald-500" />
            <div>
              <p className="font-semibold text-lg">
                {mode === "existente" ? "Convite enviado com sucesso!" : "Usuário cadastrado com sucesso!"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {inviteSent
                  ? <>Convite enviado para <span className="font-mono font-medium">{inviteEmail}</span>. O usuário deve clicar no link para ativar a conta.</>
                  : captureBio
                  ? "Biometria marcada como pendente — capture na próxima oportunidade presencial."
                  : "Militar cadastrado sem acesso ao sistema. Abra este dialog novamente e escolha \"Militar já cadastrado\" quando quiser provisionar o login."
                }
              </p>
            </div>
            <Button onClick={handleClose} size="lg" className="mt-2">Fechar</Button>
          </div>
        ) : (
          <div className="px-6 py-5 space-y-5">
            {/* Toggle: novo militar x militar já cadastrado */}
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/20 p-1.5">
              <button
                type="button"
                data-testid="cm-mode-novo"
                onClick={() => switchMode("novo")}
                disabled={loading}
                className={`flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50
                  ${mode === "novo" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                <UserPlus className="size-4" />
                Novo militar
              </button>
              <button
                type="button"
                data-testid="cm-mode-existente"
                onClick={() => switchMode("existente")}
                disabled={loading}
                className={`flex items-center justify-center gap-2 h-10 rounded-lg text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50
                  ${mode === "existente" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}
              >
                <UserCheck className="size-4" />
                Militar já cadastrado
              </button>
            </div>

            {mode === "novo" ? (
              <>
                {/* Two-column layout on desktop; single column below sm to avoid cramped fields */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Foto */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Foto (opcional)
                    </Label>
                    {photoPreview ? (
                      <div className="relative w-fit">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photoPreview} alt="Prévia" className="w-24 h-24 rounded-xl object-cover border border-border" />
                        <button
                          type="button"
                          onClick={clearPhoto}
                          aria-label="Remover foto"
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center shadow cursor-pointer"
                        >
                          <X className="size-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        data-testid="cm-foto-btn"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-50 cursor-pointer"
                      >
                        <Camera className="size-4" />
                        Selecionar foto
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      data-testid="cm-foto-input"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handlePhotoChange}
                      disabled={loading}
                    />
                  </div>

                  {/* Nome completo */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="cm-nome">Nome completo *</Label>
                    <Input id="cm-nome" value={nomeCompleto} onChange={(e) => setNomeCompleto(e.target.value)} disabled={loading} autoFocus />
                  </div>

                  {/* Matrícula */}
                  <div className="space-y-1.5">
                    <Label htmlFor="cm-matricula">Matrícula *</Label>
                    <Input id="cm-matricula" value={matricula} onChange={(e) => setMatricula(e.target.value)} disabled={loading} placeholder="Ex: 20250001" className="font-mono" />
                  </div>

                  {/* Posto/Graduação */}
                  <div className="space-y-1.5">
                    <Label htmlFor="cm-posto">Posto/Graduação</Label>
                    <div className="relative">
                      <select
                        id="cm-posto"
                        className={POSTO_SELECT_CLASS}
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

                  {/* Nome de guerra */}
                  <div className="space-y-1.5">
                    <Label htmlFor="cm-nome-guerra">Nome de guerra</Label>
                    <Input id="cm-nome-guerra" value={nomeDeGuerra} onChange={(e) => setNomeDeGuerra(e.target.value)} disabled={loading} placeholder="Ex: Silva, Rodrigues..." />
                  </div>

                  {/* Unidade */}
                  <div className="space-y-1.5">
                    <Label htmlFor="cm-unidade">Unidade</Label>
                    <Input id="cm-unidade" value={unidade} onChange={(e) => setUnidade(e.target.value)} disabled={loading} placeholder="1ª Cia, APMCB..." />
                  </div>

                  {/* Telefone */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="cm-telefone">Telefone</Label>
                    <Input id="cm-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} disabled={loading} placeholder="(83) 9 9999-9999" />
                  </div>

                  {/* Perfil inicial — dropdown com TODO o teto do caller
                      (invite-ceiling.ts), não só Usuário/Armeiro. Quem só
                      pode conceder um papel (ex: armeiro → usuário) nem vê
                      seletor, só o indicador fixo — teto de privilégio já
                      bloqueava no backend, mas mostrar uma escolha que
                      sempre daria 403 não é intuitivo. */}
                  <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-3 sm:col-span-2">
                    <Label htmlFor="cm-perfil-inicial" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Perfil inicial
                    </Label>
                    {canPickRole ? (
                      <RoleSelect
                        id="cm-perfil-inicial"
                        value={initialRole}
                        onChange={setInitialRole}
                        options={roleOptions}
                        disabled={loading}
                      />
                    ) : (
                      <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                        <p className="text-sm font-medium">Usuário</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Armeiro só pode cadastrar usuários — apenas o admin da reserva cria outro armeiro
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Convite de login */}
                <div className="rounded-2xl border-2 border-dashed border-border p-4 bg-muted/20 space-y-3">
                  <CheckboxCard
                    id="cm-invite"
                    checked={sendInvite}
                    onChange={setSendInvite}
                    disabled={loading}
                    icon={<Mail className="size-5" />}
                    iconColor="text-blue-500"
                    title="Enviar convite de login agora"
                    description="Envia link ou senha para o usuário acessar o sistema"
                  />

                  {sendInvite && (
                    <div className="space-y-3 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        <button type="button" onClick={() => setInviteMethod("magic_link")}
                          className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors text-sm cursor-pointer
                            ${inviteMethod === "magic_link" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
                          <Mail className="size-3.5 shrink-0" />
                          <span className="text-xs font-semibold">Magic Link</span>
                        </button>
                        <button type="button" onClick={() => setInviteMethod("password")}
                          className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors text-sm cursor-pointer
                            ${inviteMethod === "password" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
                          <KeyRound className="size-3.5 shrink-0" />
                          <span className="text-xs font-semibold">Senha</span>
                        </button>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cm-invite-email">E-mail do usuário *</Label>
                        <Input id="cm-invite-email" type="email" value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                          disabled={loading} placeholder="usuario@orgao.gov.br" />
                      </div>
                      {inviteMethod === "password" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="cm-invite-password">Senha temporária *</Label>
                          <Input id="cm-invite-password" type="password" value={invitePassword}
                            onChange={(e) => setInvitePassword(e.target.value)}
                            disabled={loading} placeholder="Mínimo 6 caracteres" />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Biometria */}
                <div className="rounded-2xl border-2 border-dashed border-border p-4 space-y-3 bg-muted/20">
                  <CheckboxCard
                    id="cm-biometria"
                    checked={captureBio}
                    onChange={(v) => { setCaptureBio(v); if (!v) setFingerIndex(null); }}
                    disabled={loading}
                    icon={<Fingerprint className="size-5" />}
                    iconColor="text-violet-500"
                    title="Capturar biometria agora"
                    description="Selecione o dedo e capture a digital do usuário no ato do cadastro"
                  />

                  {captureBio && (
                    <div className="pt-2 space-y-3">
                      <p className="text-xs text-center text-muted-foreground font-medium">
                        Selecione o dedo para a captura inicial
                      </p>
                      <div className="flex justify-center overflow-x-auto py-1">
                        <FingerSelector value={fingerIndex} onChange={setFingerIndex} disabled={loading} />
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Busca de militar existente */}
                <div className="space-y-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Buscar militar cadastrado
                  </Label>
                  {selectedProfile ? (
                    <div className="flex items-center gap-2 rounded-xl border border-primary/40 bg-primary/5 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-sm font-medium truncate">{selectedProfile.nome_completo}</p>
                          {selectedProfile.role !== "usuario" && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">{ROLE_LABELS[selectedProfile.role] ?? selectedProfile.role}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">{selectedProfile.posto ? `${selectedProfile.posto} · ` : ""}{selectedProfile.matricula}</p>
                        {selectedProfile.invite_sent_at && !selectedProfile.account_activated_at && (
                          <p className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                            <AlertTriangle className="size-3" />
                            Convite enviado há {minutesSince(selectedProfile.invite_sent_at)} min — re-enviar?
                          </p>
                        )}
                        {selectedProfile.account_activated_at && (
                          <p className="text-[10px] text-destructive mt-0.5 flex items-center gap-1">
                            <AlertTriangle className="size-3" />
                            Esta conta já está ativa — use a edição de usuário pra alterar e-mail.
                          </p>
                        )}
                      </div>
                      <button type="button" onClick={clearSelected} className="text-muted-foreground hover:text-foreground p-1 rounded cursor-pointer">
                        <X className="size-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                        {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                      </div>
                      <Input
                        data-testid="cm-search-input"
                        value={searchQuery}
                        onChange={(e) => handleSearchChange(e.target.value)}
                        placeholder="Nome ou matrícula..."
                        className="pl-9"
                        disabled={loading}
                        autoFocus
                      />
                      {searchResults.length > 0 && (
                        <div className="absolute z-20 left-0 right-0 mt-1 bg-card border border-border rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                          {searchResults.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              data-testid="cm-search-result"
                              onClick={() => selectProfile(p)}
                              className="w-full text-left px-3 py-2 hover:bg-muted/50 transition-colors border-b border-border/50 last:border-0 cursor-pointer"
                            >
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-sm font-medium">{p.nome_completo}</p>
                                {p.role !== "usuario" && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{ROLE_LABELS[p.role] ?? p.role}</span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">{p.posto ? `${p.posto} · ` : ""}{p.matricula}</p>
                            </button>
                          ))}
                        </div>
                      )}
                      {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
                        <p className="text-xs text-muted-foreground mt-1.5">Nenhum militar encontrado para &ldquo;{searchQuery}&rdquo;.</p>
                      )}
                    </div>
                  )}
                </div>

                {selectedProfile && (
                  <div className="rounded-2xl border-2 border-dashed border-border p-4 bg-muted/20 space-y-3">
                    <div className="flex items-center gap-2">
                      <Mail className="size-5 text-blue-500" />
                      <div>
                        <span className="text-sm font-semibold">Provisionar acesso ao sistema</span>
                        <p className="text-xs text-muted-foreground">
                          Envia link ou senha para o militar selecionado acessar o sistema
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setInviteMethod("magic_link")}
                        className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors text-sm cursor-pointer
                          ${inviteMethod === "magic_link" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
                        <Mail className="size-3.5 shrink-0" />
                        <span className="text-xs font-semibold">Magic Link</span>
                      </button>
                      <button type="button" onClick={() => setInviteMethod("password")}
                        className={`flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors text-sm cursor-pointer
                          ${inviteMethod === "password" ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-muted-foreground"}`}>
                        <KeyRound className="size-3.5 shrink-0" />
                        <span className="text-xs font-semibold">Senha</span>
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="cm-invite-email-existente">E-mail do usuário *</Label>
                      <Input id="cm-invite-email-existente" type="email" value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        disabled={loading} placeholder="usuario@orgao.gov.br" />
                    </div>
                    {inviteMethod === "password" && (
                      <div className="space-y-1.5">
                        <Label htmlFor="cm-invite-password-existente">Senha temporária *</Label>
                        <Input id="cm-invite-password-existente" type="password" value={invitePassword}
                          onChange={(e) => setInvitePassword(e.target.value)}
                          disabled={loading} placeholder="Mínimo 6 caracteres" />
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <DialogFooter className="gap-2 pt-2">
              <Button variant="outline" onClick={handleClose} disabled={loading}>Cancelar</Button>
              <Button
                data-testid="cm-submit-btn"
                onClick={handleSubmit}
                disabled={!canSubmit}
                size="lg"
              >
                {loading ? <Loader2 className="size-4 animate-spin mr-1.5" /> : null}
                {mode === "novo" ? "Cadastrar Usuário" : isResend ? "Re-enviar convite" : "Enviar convite"}
              </Button>
            </DialogFooter>
          </div>
        )}
        {/* Aninhado dentro do DialogContent (não irmão do Dialog) — mesmo
            motivo documentado em _edit-dialog.tsx: fora daqui, Esc no
            AlertDialog fecharia o Dialog pai junto. */}
        <AlertDialog
          open={!!resendConfirmPending}
          // BAIXO de code review: alinhado com o mesmo padrão de
          // _edit-dialog.tsx (`if (!loading && !next)`) — `next` só chega
          // `true` se algo externo tentasse reabrir via onOpenChange, o que
          // não acontece aqui (quem abre é handleProvisionarExistente via
          // requestResend(true) direto); só reagir ao fechamento deixa a
          // intenção explícita em vez de aceitar os dois sentidos.
          onOpenChange={(next) => { if (!loading && !next) cancelResend(); }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reenviar convite?</AlertDialogTitle>
              <AlertDialogDescription>
                {selectedProfile?.invite_sent_at && (
                  <>Convite enviado há {minutesSince(selectedProfile.invite_sent_at)} min. Tem certeza que quer re-enviar?</>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
              {/* variant="default" — reenviar convite não é ação destrutiva */}
              <AlertDialogAction onClick={confirmResendExistente} disabled={loading} variant="default">
                {loading && <Loader2 className="size-4 animate-spin mr-1.5" />}
                Reenviar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
