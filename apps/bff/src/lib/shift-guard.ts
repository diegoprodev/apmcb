import { supabase } from "../services/supabase";

// Regra canônica do produto (2026-08-18): "deve ser proibido realizar
// qualquer tipo de movimentação com livro fechado" — aplicável a TODO
// endpoint de mutação operado por um armeiro (saída, recebimento/devolução,
// ocorrência, manutenção, gestão de categoria/material), não só a criação
// de saída, que já tinha o gate. Antes desta extração, a checagem (query em
// service_shifts + 403 "SHIFT_REQUIRED") estava copiada em 4 lugares
// (lendings.ts POST /identify, POST /, POST /bulk-return; cautelamentos.ts
// POST /) e AUSENTE em pelo menos mais 8 (cautelamentos.ts /:id/return,
// /:id/sign-armeiro, /:id/sign-militar, /:id/substitute; ocorrencias.ts
// POST /, PATCH /:id; categories.ts POST/PATCH/DELETE; arsenal.ts
// POST/PATCH/DELETE de material_type e ocorrência de item) — achado real de
// produto, reportado com um caso concreto (armeiro recebeu devolução de
// cautela sem turno aberto). Consolidado num único helper para nunca mais
// divergir entre endpoints.
export type ShiftGuardResult =
  | { ok: true; shift: { id: string; reserve_id: string } | null }
  | { ok: false; body: { error: "SHIFT_REQUIRED"; message: string } };

const SHIFT_REQUIRED_MESSAGE =
  "Inicie um turno no Livro Digital antes de registrar movimentações.";

/**
 * Só admin_global/admin_reserva não operam turno (mesmo escopo já usado nos
 * 4 gates pré-existentes) — para eles, sempre `ok: true, shift: null`.
 */
export async function requireActiveShift(
  role: string,
  armeiroId: string | undefined
): Promise<ShiftGuardResult> {
  if (role !== "armeiro") return { ok: true, shift: null };
  if (!armeiroId) {
    return { ok: false, body: { error: "SHIFT_REQUIRED", message: SHIFT_REQUIRED_MESSAGE } };
  }

  const { data: activeShift } = await supabase
    .from("service_shifts")
    .select("id, reserve_id")
    .eq("armeiro_id", armeiroId)
    .eq("status", "ativo")
    .maybeSingle();

  if (!activeShift) {
    return { ok: false, body: { error: "SHIFT_REQUIRED", message: SHIFT_REQUIRED_MESSAGE } };
  }

  return { ok: true, shift: activeShift };
}
