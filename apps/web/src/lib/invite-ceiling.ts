// Espelha apps/bff/src/lib/invite-ceiling.ts — não importável direto daqui
// (apps/web e apps/bff são apps Next.js/Bun separados, sem pacote
// @apmcb/shared em uso por nenhum dos dois para lógica de negócio; ver
// apps/web/src/lib/material-item-status.ts para o mesmo padrão já aceito
// neste repo). Esta é a ÚNICA cópia dentro de apps/web — antes havia uma
// cópia local em api/admin/users/route.ts E um boolean hardcoded em
// _cadastrar-militar-dialog.tsx (achado de code review: 4 cópias
// independentes do mesmo teto de privilégio no repo inteiro, contando a do
// BFF). Consolidado pra 1 dentro do web; sincronize manualmente com
// invite-ceiling.ts do BFF quando o teto mudar — os dois ainda não
// compartilham um pacote comum.
const INVITE_CEILING: Record<string, string[]> = {
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
