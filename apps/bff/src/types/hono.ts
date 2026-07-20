import type { Logger } from "../lib/logger.ts";

export type Role = "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor" | "usuario";

export type HonoVariables = {
  userId: string;
  role: Role;
  tenantId: string | null;
  reserveId: string | null;
  originalRole?: Role;
  activeMode?: "usuario";
  nexusAuthorized?: boolean;
  requestId: string;
  log: Logger;
  // Biometric Bridge Phase 1B — identidade do bridge Windows autenticado por
  // deviceAuthMiddleware (nunca coexiste com userId/role de sessão de
  // usuário: rotas bridge-facing não têm ator humano logado).
  bridgeDeviceId?: string;
  bridgeTenantId?: string;
  bridgeReserveId?: string;
  // Corpo cru já lido (para computar o hash da assinatura do request) e
  // reaproveitado pelo handler — o stream do body só pode ser lido uma vez.
  bridgeRawBody?: string;
};
