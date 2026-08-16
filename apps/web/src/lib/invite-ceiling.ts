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

// Teto PRÓPRIO para trocar o e-mail de acesso de alguém que JÁ tem conta
// ativa (perda de acesso: saiu da unidade, e-mail invadido, erro de
// digitação no cadastro) — mais estreito que canInvite/allowedRoles acima e
// NUNCA inclui armeiro, mesmo quando o alvo está dentro do teto geral dele
// (ex: armeiro tem teto sobre role "usuario", mas trocar o e-mail de login
// de alguém que já tem acesso ativo é uma ação mais sensível, que revoga o
// acesso pelo e-mail antigo imediatamente). Única cópia — usada tanto no
// client (_edit-dialog.tsx, esconder o controle) quanto no servidor
// (/api/admin/users route.ts, 403), achado de code review: a mesma
// expressão booleana estava duplicada solta nos dois arquivos. Esta ação só
// existe em apps/web (endpoint /api/admin/users é uma rota Next edge, não
// BFF) — não precisa de espelho em apps/bff/src/lib/invite-ceiling.ts.
export function canChangeUserEmail(callerRole: string): boolean {
  return callerRole === "admin_global" || callerRole === "admin_reserva";
}

// Labels PT-BR — SSOT usada por todo dropdown de papel (cadastro e edição de
// usuário), pra nunca ter rótulo divergente entre as duas telas.
export const ROLE_LABELS: Record<string, string> = {
  admin_global: "Admin Global",
  admin_reserva: "Admin Reserva",
  armeiro: "Armeiro",
  usuario: "Usuário",
  auditor: "Auditor",
};
