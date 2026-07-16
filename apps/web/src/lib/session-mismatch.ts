export type MismatchDecision =
  | { kind: "confirmed-ok"; confirmedUserId: string }
  | { kind: "redirect"; reason: "persistent" | "inconclusive" };

/**
 * Decide se uma divergência entre a identidade resolvida pelo Supabase
 * (`supabase.auth.getUser()`) e a verificada pelo BFF (`x-verified-user-id`,
 * via iron-session) é um incidente real de vazamento de sessão entre
 * usuários, ou uma corrida de propagação transitória logo após login.
 *
 * O lado do BFF é determinístico por cookie (iron-session é um cookie
 * selado, decodificado localmente — o mesmo valor de cookie sempre resolve
 * para o mesmo user_id) — por isso o recheck é feito no lado que PODE
 * legitimamente variar entre duas leituras: uma segunda chamada a
 * `supabase.auth.getUser()`, que faz um round-trip real de validação de JWT
 * contra o Supabase Auth a cada chamada.
 *
 * Falha ao revalidar (`recheckedSupabaseUserId` ausente — timeout, erro de
 * rede) NUNCA é tratada como "ok". Mantém o fail-closed original: sem
 * confirmação POSITIVA de que a divergência era transitória, trata como
 * incidente.
 */
export function decideSessionMismatch(
  bffVerifiedUserId: string,
  recheckedSupabaseUserId: string | null | undefined
): MismatchDecision {
  if (!recheckedSupabaseUserId) {
    return { kind: "redirect", reason: "inconclusive" };
  }
  if (recheckedSupabaseUserId !== bffVerifiedUserId) {
    return { kind: "redirect", reason: "persistent" };
  }
  return { kind: "confirmed-ok", confirmedUserId: recheckedSupabaseUserId };
}
