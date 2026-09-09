// Debounce do reenvio de e-mail de acesso. Cada `generateLink({type:"recovery"})`
// invalida o token anterior (uso único) — dois cliques ou dois admins em
// sequência queimariam o link recém-enviado. O guard só morde quando um envio
// ANTERIOR foi de fato concluído (admin.ts grava `invite_sent_at` só após
// `sendEmail` ok), então uma re-tentativa depois de falha de rede não é barrada.
export const INVITE_DEBOUNCE_MS = 30_000;

export function isInviteDebounced(
  inviteSentAt: string | null | undefined,
  now: number = Date.now(),
  windowMs: number = INVITE_DEBOUNCE_MS,
): boolean {
  if (!inviteSentAt) return false;
  const sentAt = new Date(inviteSentAt).getTime();
  if (Number.isNaN(sentAt)) return false;
  return now - sentAt >= 0 && now - sentAt < windowMs;
}
