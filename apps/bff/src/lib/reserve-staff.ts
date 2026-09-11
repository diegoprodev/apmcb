// Helpers puros do modelo militar↔reserva (SP2).
//
// A partir do SP2, `reserve_memberships` carrega linhas `role='usuario'` (militar
// comum), não só staff. A premissa antiga "tem linha ⇒ é staff" morre — quem
// precisa saber "é staff?" usa `isStaffReserveRole`.

/** Papéis de `reserve_memberships` que contam como staff de uma reserva. */
export const STAFF_RESERVE_ROLES = ["armeiro", "admin_reserva", "auditor_reserva"] as const;

export type StaffReserveRole = (typeof STAFF_RESERVE_ROLES)[number];

/** `true` só para armeiro / admin_reserva / auditor_reserva. `usuario`, papéis
 *  globais (`admin_global`), null e lixo → `false`. */
export function isStaffReserveRole(role: string | null | undefined): role is StaffReserveRole {
  return role != null && (STAFF_RESERVE_ROLES as readonly string[]).includes(role);
}

export interface CreationReserveInput {
  /** papel do CRIADOR (quem está cadastrando o militar) — informativo/futuro;
   *  a decisão hoje depende só de `creatorActiveReserveId` e `explicitReserveId`. */
  creatorRole: string;
  /** `profiles.active_reserve_id` do criador — NULL quando ele está em matriz. */
  creatorActiveReserveId: string | null;
  /** reserva escolhida explicitamente no formulário (seletor), se houver. */
  explicitReserveId: string | null;
}

export interface CreationReserveResult {
  /** reserva onde o militar será vinculado; `null` quando `needsSelector`. */
  reserveId: string | null;
  /** o form precisa exibir/exigir um seletor de reserva antes de submeter. */
  needsSelector: boolean;
}

/**
 * Decide em qual reserva o militar recém-criado entra:
 *  - seletor explícito sempre vence;
 *  - senão, a reserva ativa do criador;
 *  - se o criador não tem reserva ativa (matriz, ou staff sem reserva) e não
 *    escolheu nada → `needsSelector` (fail-closed: nunca cria militar solto).
 */
export function resolveCreationReserveId(input: CreationReserveInput): CreationReserveResult {
  if (input.explicitReserveId) {
    return { reserveId: input.explicitReserveId, needsSelector: false };
  }
  if (input.creatorActiveReserveId) {
    return { reserveId: input.creatorActiveReserveId, needsSelector: false };
  }
  // sem reserva ativa e sem seletor — precisa escolher. Vale pra qualquer
  // criador sem reserva ativa (admin_global/auditor em matriz é o caso comum,
  // mas um armeiro sem reserva vigente cai aqui também — fail-closed).
  return { reserveId: null, needsSelector: true };
}
