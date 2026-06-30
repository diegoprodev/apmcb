const INVITE_CEILING: Record<string, string[]> = {
  superadmin:    ["admin_global"],
  admin_global:  ["admin_global", "admin_reserva", "armeiro", "usuario"],
  admin_reserva: ["armeiro", "usuario", "auditor"],
  armeiro:       ["usuario"],
};

export function canInvite(callerRole: string, targetRole: string): boolean {
  return INVITE_CEILING[callerRole]?.includes(targetRole) ?? false;
}

export function allowedRoles(callerRole: string): string[] {
  return INVITE_CEILING[callerRole] ?? [];
}
