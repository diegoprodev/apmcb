"use client";

import { useRoleGuard } from "@/hooks/use-role-guard";

export function RoleWatcher() {
  useRoleGuard();
  return null;
}
