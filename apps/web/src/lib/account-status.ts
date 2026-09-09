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
 *
 * `accountActive` deriva SÓ de `account_activated_at` — carimbo de primeiro
 * login gravado pelo trigger `handle_user_first_login` (migration
 * 20260617000003, endurecida em 20260908010000). NÃO inferir de
 * `registration_status === 'complete'`: esse valor é setado pela RPC de
 * enrollment biométrico, operada por um armeiro presencialmente
 * (`p_actor_id`), sem exigir nem criar login do militar — existe população
 * real `complete` que nunca logou (cadastro sem login + biometria). O bug
 * real de produção do profile `000003` (badge "Sem acesso" para quem loga
 * todo dia) foi por `account_activated_at` NULL em contas anteriores ao
 * trigger; a correção é a migration de backfill 20260908010000, não um
 * heurístico aqui.
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
