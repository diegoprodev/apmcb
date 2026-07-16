const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

/**
 * Chama GET {BFF}/api/auth/me com o cookie apmcb_session fornecido e retorna
 * o user_id que o BFF (iron-session) resolve para essa sessão — SSOT usado
 * tanto por middleware.ts (verificação cruzada por request) quanto pelo
 * reconfirm de session-mismatch em (dashboard)/layout.tsx.
 *
 * fail-open (retorna null em erro/timeout/não-ok) — instabilidade externa
 * não deve travar navegação; ambos os call sites tratam null como "sem
 * dado para comparar", nunca como "usuário confirmado".
 */
export async function fetchVerifiedUserId(sessionCookieValue: string): Promise<string | null> {
  try {
    const res = await fetch(`${BFF_URL}/api/auth/me`, {
      headers: { cookie: `apmcb_session=${sessionCookieValue}` },
      signal: AbortSignal.timeout(3_000),
    });
    if (!res.ok) {
      console.warn("[verified-user] BFF respondeu", res.status);
      return null;
    }
    const data = await res.json() as { user?: { id?: string } | null };
    return data.user?.id ?? null;
  } catch (error) {
    console.warn("[verified-user] falha de rede/timeout", error);
    return null;
  }
}
