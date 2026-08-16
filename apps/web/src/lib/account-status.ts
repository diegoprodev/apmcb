/**
 * Classifica o status de acesso de um profile (pendência de biometria, TOTP,
 * convite/login) — SSOT usada por toda tela que lista militares/usuários.
 *
 * Extraído depois de um bug real em produção: `/reserva/militares` (MilitarCard)
 * mostrava "Completo" olhando só biometria+TOTP, ignorando se a conta de
 * login sequer foi criada (`account_activated_at`) — um usuário podia
 * aparecer "Completo"/"Ativo" no card e, ao abrir o detalhe, mostrar "Conta
 * não criada" com um botão de reenviar convite. `/admin/usuarios` já tinha a
 * lógica certa (considera os 4 campos); consolidado aqui para as duas telas
 * nunca mais divergirem sobre o que "completo" significa.
 */
export interface AccountStatusInput {
  registration_status: "pending_biometric" | "complete" | "inactive" | "impedimento_administrativo";
  totp_configured: boolean;
  invite_sent_at: string | null;
  account_activated_at: string | null;
}

export function classifyAccountStatus(input: AccountStatusInput) {
  const { registration_status: status, totp_configured, invite_sent_at, account_activated_at } = input;
  const bioPending = status === "pending_biometric";
  const totpPending = !totp_configured;
  const accountActive = !!account_activated_at;
  const inviteExpired = !!invite_sent_at && !account_activated_at &&
    (Date.now() - new Date(invite_sent_at).getTime()) > 24 * 3600 * 1000;
  const inviteSent = !!invite_sent_at && !account_activated_at;
  const noInvite = !invite_sent_at && !account_activated_at;
  const allComplete = status !== "inactive" && !bioPending && !totpPending && accountActive;
  return { bioPending, totpPending, accountActive, inviteExpired, inviteSent, noInvite, allComplete };
}

export function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}
