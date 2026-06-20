export type Role = "admin" | "master" | "usuario" | "superadmin" | "admin_global" | "admin_reserva" | "armeiro" | "auditor";

export type HonoVariables = {
  userId: string;
  role: Role;
  tenantId: string | null;
  reserveId: string | null;
};
