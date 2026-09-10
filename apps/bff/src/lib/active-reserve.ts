// SP1 do isolamento por reserva — resolve o default de `profiles.active_reserve_id`
// no login/exchange (apps/bff/src/routes/auth.ts). Puro, sem I/O: quem consulta o
// banco é o caller. Ver docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.6.

export interface ResolveInput {
  role: string;
  /** valor já salvo em profiles.active_reserve_id */
  current: string | null;
  memberships: { reserve_id: string; created_at: string }[];
  preferences: { reserve_id: string; selection_count: number; last_selected_at: string | null }[];
}

export type ResolveReason = "kept" | "matriz" | "preference" | "oldest_membership" | "none";

// admin_global / auditor / superadmin operam em modo matriz (visão de tenant) por
// padrão — não precisam de reserva ativa nem de membership.
const MATRIX_ROLES = new Set(["admin_global", "auditor", "superadmin"]);

export function resolveDefaultActiveReserve(
  input: ResolveInput,
): { active: string | null; reason: ResolveReason } {
  const memberIds = new Set(input.memberships.map((m) => m.reserve_id));

  // 1. valor salvo ainda válido?
  if (input.current) {
    if (MATRIX_ROLES.has(input.role) || memberIds.has(input.current)) {
      return { active: input.current, reason: "kept" };
    }
  }

  if (MATRIX_ROLES.has(input.role)) return { active: null, reason: "matriz" };

  // 2. preferência mais usada, restrita às memberships atuais
  const prefRanked = input.preferences
    .filter((p) => memberIds.has(p.reserve_id))
    .sort(
      (a, b) =>
        b.selection_count - a.selection_count ||
        (b.last_selected_at ?? "").localeCompare(a.last_selected_at ?? ""),
    );
  if (prefRanked.length > 0) return { active: prefRanked[0].reserve_id, reason: "preference" };

  // 3. membership mais antiga
  const oldest = [...input.memberships].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
  if (oldest) return { active: oldest.reserve_id, reason: "oldest_membership" };

  // 4. sem vínculo — o caller emite reserve.active.none_for_staff
  return { active: null, reason: "none" };
}

// ─── Fiação de login/exchange ───────────────────────────────────────────────
// Resolve o default, persiste em profiles.active_reserve_id se mudou, e devolve
// o valor para espelhar em session.reserveId. `db` é o cliente service_role
// (passa pelo trigger profiles_validate_active_reserve como belt).

export interface ReserveLoginDeps {
  userId: string;
  role: string;
  currentActive: string | null;
  memberships: { reserve_id: string; created_at: string }[];
  preferences: { reserve_id: string; selection_count: number; last_selected_at: string | null }[];
  persist: (activeReserveId: string | null) => Promise<{ error: { message: string } | null }>;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}

export async function resolveAndPersistActiveReserve(
  d: ReserveLoginDeps,
): Promise<string | null> {
  const { active, reason } = resolveDefaultActiveReserve({
    role: d.role,
    current: d.currentActive,
    memberships: d.memberships,
    preferences: d.preferences,
  });

  if (reason === "none") {
    d.log.warn({ userId: d.userId, role: d.role }, "reserve.active.none_for_staff");
  }

  if (active !== d.currentActive) {
    const { error } = await d.persist(active);
    if (error) {
      d.log.warn({ userId: d.userId, err: error.message }, "reserve.active.persist_failed");
      // não bloqueia o login — session.reserveId ainda recebe o resolvido
    }
  }

  return active;
}
