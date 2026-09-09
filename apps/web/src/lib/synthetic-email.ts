// E-mail sintético gerado pelo BFF quando um militar é cadastrado SEM login
// (apps/bff/src/routes/admin.ts: `${matricula}.interno@apmcb.sistema`). Não é
// um endereço real — nenhuma UI pode enviar e-mail para ele. Espelho manual
// da regra do BFF (apps/web e apps/bff não compartilham pacote); manter em
// sincronia se o domínio mudar lá.
export const SYNTHETIC_EMAIL_DOMAIN = "@apmcb.sistema";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** É um endereço real e utilizável para envio (não vazio, não sintético). */
export function isRealEmail(email: string | null | undefined): email is string {
  if (!email) return false;
  const t = email.trim().toLowerCase();
  return t.length > 0 && !t.endsWith(SYNTHETIC_EMAIL_DOMAIN) && EMAIL_RE.test(t);
}

/** Validação de formato apenas (usada em inputs onde o usuário digita). */
export function isValidEmailFormat(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}
