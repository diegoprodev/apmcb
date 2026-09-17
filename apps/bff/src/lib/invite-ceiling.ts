const INVITE_CEILING: Record<string, string[]> = {
  superadmin:    ["admin_global"],
  admin_global:  ["admin_global", "admin_reserva", "armeiro", "usuario", "auditor"],
  admin_reserva: ["armeiro", "usuario", "auditor"],
  armeiro:       ["usuario"],
};

export function canInvite(callerRole: string, targetRole: string): boolean {
  return INVITE_CEILING[callerRole]?.includes(targetRole) ?? false;
}

export function allowedRoles(callerRole: string): string[] {
  return INVITE_CEILING[callerRole] ?? [];
}

// Teto PRÓPRIO para trocar o e-mail de acesso de alguém que JÁ tem conta
// ativa — mais estreito que canInvite/allowedRoles acima e NUNCA inclui
// armeiro, mesmo quando o alvo está dentro do teto geral dele (trocar o
// e-mail de login de alguém com acesso ativo revoga o acesso pelo e-mail
// antigo — ação mais sensível que provisionar o primeiro acesso). Espelha
// apps/web/src/lib/invite-ceiling.ts — feature migrada pro BFF (spec
// docs/enterprise/specs/troca-email-acesso-enterprise.md); sincronizar
// manualmente as duas cópias se o teto mudar.
export function canChangeUserEmail(callerRole: string): boolean {
  return callerRole === "admin_global" || callerRole === "admin_reserva";
}
