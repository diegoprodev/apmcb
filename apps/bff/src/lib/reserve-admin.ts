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

export type ReserveAdminState = "ok" | "pending_invite" | "no_admin";

type AdminProfile = {
  id: string;
  registration_status: string | null;
  invite_sent_at: string | null;
  account_activated_at: string | null;
};

// Admin ATIVO (decisão do dono do produto): papel admin_reserva de verdade
// (profiles.role), conta não suspensa (inactive/impedimento_administrativo) e
// convite aceito — convite enviado e ainda não ativado = pendente.
// "complete" (cadastro biométrico concluído) = pessoa em operação: um reenvio de
// acesso a um admin legado sem account_activated_at não o torna "pendente".
function isPendingInvite(p: AdminProfile): boolean {
  return !!p.invite_sent_at && !p.account_activated_at && p.registration_status !== "complete";
}
function isActiveAdmin(p: AdminProfile): boolean {
  if (p.registration_status === "inactive" || p.registration_status === "impedimento_administrativo") return false;
  return !isPendingInvite(p);
}

/**
 * Estado de cada reserva de `reserveIds` quanto ao admin_reserva (além de
 * `excludeUserId`): "ok" = há admin ativo; "pending_invite" = só há admin com
 * convite ainda não aceito; "no_admin" = nenhum. Conta só quem ainda é
 * admin_reserva de verdade (profiles.role): uma membership "fantasma" de alguém
 * já rebaixado não cobre a reserva.
 */
export async function reserveAdminStates(reserveIds: string[], excludeUserId: string | null): Promise<Map<string, ReserveAdminState>> {
  const states = new Map<string, ReserveAdminState>(reserveIds.map((id) => [id, "no_admin"]));
  if (reserveIds.length === 0) return states;
  const { data, error } = await supabase
    .from("reserve_memberships")
    .select("reserve_id, user_id")
    .eq("role", "admin_reserva")
    .in("reserve_id", reserveIds);
  if (error) throw new ReserveAdminLookupError(error.code);
  const rows = (data ?? []).filter((r) => r.user_id !== excludeUserId);
  if (rows.length === 0) return states;
  const userIds = [...new Set(rows.map((r) => r.user_id as string))];
  const { data: admins, error: profErr } = await supabase
    .from("profiles")
    .select("id, registration_status, invite_sent_at, account_activated_at")
    .eq("role", "admin_reserva")
    .in("id", userIds);
  if (profErr) throw new ReserveAdminLookupError(profErr.code);
  const byId = new Map((admins ?? []).map((p) => [p.id as string, p as AdminProfile]));
  for (const r of rows) {
    const p = byId.get(r.user_id as string);
    if (!p) continue;
    const rid = r.reserve_id as string;
    if (isActiveAdmin(p)) states.set(rid, "ok");
    else if (isPendingInvite(p) && states.get(rid) !== "ok") states.set(rid, "pending_invite");
  }
  return states;
}

export async function reservesCoveredByAdmin(reserveIds: string[], excludeUserId: string | null): Promise<Set<string>> {
  const states = await reserveAdminStates(reserveIds, excludeUserId);
  return new Set([...states].filter(([, st]) => st === "ok").map(([id]) => id));
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

export const RESERVE_NOT_OPERABLE_MESSAGES: Record<Exclude<ReserveAdminState, "ok">, string> = {
  pending_invite: "Esta reserva ainda não está disponível: o convite do administrador da reserva ainda não foi aceito.",
  no_admin: "Esta reserva não tem um administrador de reserva ativo.",
};

/**
 * Reserva operável (admin ativo)? `null` = sim. Senão, resposta amigável (409)
 * para quem tenta adicionar material ou membros. Falha de banco lança
 * ReserveAdminLookupError (o caller responde 500 fail-closed).
 */
export async function reserveNotOperable(reserveId: string): Promise<{ status: 409; error: string; code: ReserveAdminState } | null> {
  const state = (await reserveAdminStates([reserveId], null)).get(reserveId) ?? "no_admin";
  return state === "ok" ? null : { status: 409, error: RESERVE_NOT_OPERABLE_MESSAGES[state], code: state };
}

/** Primeira reserva de `reserveIds` sem admin ativo (null = todas operáveis). */
export async function firstNotOperable(reserveIds: string[]): Promise<{ reserveId: string; status: 409; error: string; code: Exclude<ReserveAdminState, "ok"> } | null> {
  const states = await reserveAdminStates([...new Set(reserveIds)], null);
  for (const [reserveId, state] of states) {
    if (state !== "ok") return { reserveId, status: 409, error: RESERVE_NOT_OPERABLE_MESSAGES[state], code: state };
  }
  return null;
}

/** O usuário é admin_reserva ATIVO (papel, conta não suspensa, convite aceito)? */
export async function isActiveReserveAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, registration_status, invite_sent_at, account_activated_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new ReserveAdminLookupError(error.code);
  if (!data || data.role !== "admin_reserva") return false;
  return isActiveAdmin(data as AdminProfile);
}
