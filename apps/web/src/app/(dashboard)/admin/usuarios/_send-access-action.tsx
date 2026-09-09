"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useConfirm } from "@/hooks/use-confirm";
import { classifyAccountStatus, minutesSince } from "@/lib/account-status";
import { sendLoginInvite } from "@/lib/send-login-invite";
import { isRealEmail, isValidEmailFormat } from "@/lib/synthetic-email";
import { canInvite } from "@/lib/invite-ceiling";

export interface SendAccessTarget {
  id: string;
  nome_completo: string;
  email: string | null;
  role: "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor" | "usuario";
  registration_status: "pending_biometric" | "complete" | "inactive" | "impedimento_administrativo";
  totp_configured: boolean;
  invite_sent_at: string | null;
  account_activated_at: string | null;
}

/**
 * Ação de card (usada dentro de UserRowActions, portanto em /admin/usuarios
 * e /reserva/militares): envia o e-mail de acesso pela 1ª vez para quem tem
 * cadastro mas nunca logou ("Sem acesso"), ou reenvia para quem está com
 * "Convite enviado"/"Convite expirado". Não renderiza nada para quem já tem
 * conta ativa nem para contas inativas.
 *
 * Endpoint (POST /api/admin/users/enviar-acesso via sendLoginInvite) é
 * tratado como caixa preta estável — está sendo reescrito no PR #7. Body
 * `{ user_id, email }`; 200 `{ ok, email_sent }`; erro `{ error }` com
 * 400/403/404/409/429/500. O 429 é o debounce anti-flood — vira um toast de
 * "aguarde", sem vazar a mensagem crua.
 */
export function SendAccessAction({
  user,
  callerRole = "admin_global",
  onSent,
}: {
  user: SendAccessTarget;
  callerRole?: string;
  onSent?: (patch: { id: string; invite_sent_at: string; email: string }) => void;
}) {
  const router = useRouter();
  const { pending, request, cancel } = useConfirm<true>();
  const [loading, setLoading] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  // `loading` é state assíncrono — dois cliques rápidos em "Enviar" passam
  // ambos pelo guard antes do re-render. `inFlight` (síncrono) barra o 2º.
  const inFlight = useRef(false);

  const { accountActive, noInvite, inviteSent, inviteExpired } = classifyAccountStatus(user);

  // Nada a fazer: já tem acesso, ou a conta está desativada (reenviar acesso
  // a quem foi desativado seria contraditório — reative primeiro).
  if (accountActive || user.registration_status === "inactive") return null;
  if (!noInvite && !inviteSent && !inviteExpired) return null;
  // Teto de privilégio (mesma checagem que o BFF faz e devolve 403): não
  // mostrar uma ação que sempre falharia — ex: admin_reserva não provisiona
  // acesso a admin_global. O backend continua sendo a autoridade.
  if (!canInvite(callerRole, user.role)) return null;

  const isResend = inviteSent || inviteExpired;
  const emailOnFile = isRealEmail(user.email) ? user.email : null;
  const needsEmail = !emailOnFile;
  const effectiveEmail = (emailOnFile ?? emailInput).trim();
  const canSubmit = !loading && isValidEmailFormat(effectiveEmail);

  function open() {
    setEmailInput("");
    request(true);
  }

  async function submit() {
    if (!isValidEmailFormat(effectiveEmail) || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const res = await sendLoginInvite({ email: effectiveEmail, existingUserId: user.id });
      if (res.ok) {
        toast.success("E-mail de acesso enviado");
        cancel();
        onSent?.({ id: user.id, invite_sent_at: new Date().toISOString(), email: effectiveEmail });
        router.refresh();
        return;
      }
      if (res.status === 429) {
        toast.error("Aguarde alguns segundos antes de enviar de novo.");
        return;
      }
      toast.error(res.message ?? "Não foi possível enviar o e-mail de acesso.");
    } catch (err) {
      console.error("[send-access-action] falha inesperada", err);
      toast.error("Erro de conexão. Tente novamente.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  const minsAgo = minutesSince(user.invite_sent_at);
  const lastSentLabel =
    minsAgo === null ? null
    : minsAgo < 60 ? `há ${minsAgo} min`
    : `há ${Math.floor(minsAgo / 60)} h`;

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10"
        onClick={open}
        title={isResend ? "Reenviar e-mail de acesso" : "Enviar e-mail de acesso"}
        aria-label={isResend ? `Reenviar acesso para ${user.nome_completo}` : `Enviar acesso para ${user.nome_completo}`}
        data-testid="send-access-btn"
      >
        {isResend ? <RotateCw className="size-3.5" /> : <Send className="size-3.5" />}
      </Button>

      <AlertDialog open={!!pending} onOpenChange={(next) => { if (!loading && !next) cancel(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isResend ? "Reenviar e-mail de acesso?" : "Enviar e-mail de acesso?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isResend && inviteExpired && "O convite anterior expirou. "}
              {isResend && !inviteExpired && lastSentLabel && `Último envio ${lastSentLabel}. `}
              {user.nome_completo} vai receber um link para definir a senha e ativar a conta.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5 py-1">
            <Label htmlFor="send-access-email">E-mail do usuário</Label>
            {needsEmail ? (
              <Input
                id="send-access-email"
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                disabled={loading}
                placeholder="usuario@orgao.gov.br"
                autoFocus
                data-testid="send-access-email"
              />
            ) : (
              <p className="text-sm font-mono text-muted-foreground" data-testid="send-access-email-static">
                {emailOnFile}
              </p>
            )}
            {needsEmail && (
              <p className="text-xs text-muted-foreground">
                Este usuário não tem um e-mail real cadastrado. Informe um para enviar o acesso.
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void submit()} disabled={!canSubmit} variant="default">
              {loading && <Loader2 className="size-4 animate-spin mr-1.5" />}
              {isResend ? "Reenviar" : "Enviar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
