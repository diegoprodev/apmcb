export type Role = "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor" | "usuario";

export type HonoVariables = {
  userId: string;
  role: Role;
  tenantId: string | null;
  reserveId: string | null;
  originalRole?: Role;
  activeMode?: "usuario";
  nexusAuthorized?: boolean;
};
