import { supabase } from "../services/supabase";

// D-04 (docs/auditoria/EVIDENCE_D04_RESERVE_REQUIRES_ADMIN.md): uma reserva não
// existe sem um admin_reserva e só pode ser acessada se tiver um. Consulta
// `reserve_memberships` (role = admin_reserva). Falha de banco NUNCA vira
// "sem admin" nem "tem admin": lança ReserveAdminLookupError e o caller responde
// 500 fail-closed com log.
export class ReserveAdminLookupError extends Error {
  readonly code?: string;
  constructor(code?: string) {
    super("reserve admin lookup failed");
    this.name = "ReserveAdminLookupError";
    this.code = code;
  }
}

/**
 * Dos `reserveIds`, os que TÊM um admin_reserva além de `excludeUserId`. Conta só
 * quem ainda é admin_reserva de verdade (profiles.role): uma membership
 * `admin_reserva` "fantasma" de alguém já rebaixado não cobre a reserva.
 */
export async function reservesCoveredByAdmin(reserveIds: string[], excludeUserId: string | null): Promise<Set<string>> {
  if (reserveIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, user_id")
    .eq("role", "admin_reserva")
    .in("reserve_id", reserveIds);
  if (error) throw new ReserveAdminLookupError(error.code);
  const rows = (data ?? []).filter((r) => r.user_id !== excludeUserId);
  if (rows.length === 0) return new Set();
  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const { data: admins, error: profErr } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin_reserva")
    .in("id", userIds);
  if (profErr) throw new ReserveAdminLookupError(profErr.code);
  const realAdmins = new Set((admins ?? []).map((p) => p.id as string));
  return new Set(rows.filter((r) => realAdmins.has(r.user_id as string)).map((r) => r.reserve_id as string));
}

/** Dos `reserveIds`, os que NÃO teriam nenhum admin_reserva além de `excludeUserId`. */
export async function reservesWithoutOtherAdmin(reserveIds: string[], excludeUserId: string | null): Promise<string[]> {
  const covered = await reservesCoveredByAdmin(reserveIds, excludeUserId);
  return reserveIds.filter((id) => !covered.has(id));
}

export async function reserveHasAdmin(reserveId: string): Promise<boolean> {
  return (await reservesWithoutOtherAdmin([reserveId], null)).length === 0;
}

/** Login/exchange: só reservas COM admin_reserva podem virar reserva ativa (D-04). */
export async function onlyReservesWithAdmin<T extends { reserve_id: string }>(memberships: T[]): Promise<T[]> {
  const covered = await reservesCoveredByAdmin([...new Set(memberships.map((m) => m.reserve_id))], null);
  return memberships.filter((m) => covered.has(m.reserve_id));
}
