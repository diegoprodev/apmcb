/**
 * Interpreta a resposta de GET /api/shifts/active para os pré-checks de guard
 * de turno usados antes de abrir modais/forms de movimentação de armeiro
 * (cautelas, ocorrências, solicitações de material — ver requireActiveShift
 * em apps/bff/src/lib/shift-guard.ts, que é a fonte de verdade real).
 *
 * Achado de code review (2026-08-24): as primeiras implementações deste
 * pré-check (incluindo o molde original, openEmitir) só olhavam `data?.shift`,
 * ignorando `ok`/`status` — uma falha HTTP (401 sessão expirada, 500
 * transitório no Supabase) também tem `data` vazio, então era tratada como
 * "turno não aberto" e mostrava o ShiftRequiredDialog errado (mandando o
 * armeiro "abrir turno no Livro Digital" quando o problema real era sessão
 * expirada ou erro de conexão). Centralizado aqui para nunca mais divergir
 * entre os pontos de chamada.
 */
export type ShiftCheckOutcome = "active" | "shift_required" | "error";

export function shiftCheckOutcome(
  ok: boolean,
  data: { shift?: unknown } | null | undefined,
): ShiftCheckOutcome {
  if (!ok) return "error";
  return data?.shift ? "active" : "shift_required";
}
