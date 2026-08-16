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
 *
 * NÃO reduzir este timeout (achado de code review, 2026-08-15): a checagem
 * inteira de session-mismatch em (dashboard)/layout.tsx só roda DENTRO do
 * `if (verifiedUserId && ...)` — ou seja, null aqui (timeout) não é
 * "sem dado extra pra comparar", é "nenhuma verificação de mismatch
 * acontece nesta request". Encurtar o timeout não troca segurança por
 * performance; só aumenta a taxa real de vezes que a mitigação do
 * incidente de session-bleed (2026-07-17) fica completamente desligada
 * sob latência normal do BFF. A percepção de lentidão de navegação deve
 * ser resolvida por outras vias (paralelização de queries, barra de
 * progresso — ver navigation-progress.tsx), nunca encurtando este teto.
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
