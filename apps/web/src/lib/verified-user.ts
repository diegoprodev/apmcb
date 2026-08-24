const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? "https://api.apmcb.pmpb.online";

/**
 * Chama GET {BFF}/api/auth/me com o cookie apmcb_session fornecido e retorna
 * o user_id que o BFF (iron-session) resolve para essa sessão — SSOT usado
 * por middleware.ts (verificação cruzada por request). NÃO é usada pelo
 * recheck de session-mismatch em (dashboard)/layout.tsx — esse recheck
 * precisa de uma leitura NOVA e independente via supabase.auth.getUser()
 * direto, nunca deste cache (ver PERF-01/PERF-02 na spec abaixo).
 *
 * fail-open (retorna null em erro/timeout/não-ok) — instabilidade externa
 * não deve travar navegação; o call site em middleware.ts trata null como
 * "sem dado para comparar", nunca como "usuário confirmado".
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
 *
 * PERF-01 (docs/enterprise/specs/navegacao-performance-enterprise.md):
 * cache de curtíssimo prazo (10s) por valor de cookie — middleware.ts roda
 * em toda navegação (inclusive RSC payload fetch client-side), fazendo este
 * round-trip real ao BFF do zero a cada troca de página, mesmo para o mesmo
 * usuário/sessão poucos segundos depois. Só armazena resultado POSITIVO
 * (userId resolvido com sucesso) — falha/timeout/null NUNCA é cacheado,
 * continua revalidando do zero em toda request, preservando exatamente o
 * comportamento fail-open de hoje no caminho de erro (sem isso, um hiccup
 * do BFF desligaria a checagem de mismatch por até 10s, não só pra essa
 * request). Chave = valor bruto do cookie de sessão (não a identidade do
 * isolate) — um cookie diferente (o cenário real do incidente de
 * session-bleed) nunca reaproveita o cache de outro, não há reintrodução
 * de risco.
 */
const verifiedUserCache = new Map<string, { userId: string; expiresAt: number }>();
const CACHE_TTL_MS = 10_000;
const CACHE_MAX_ENTRIES = 500;

export async function fetchVerifiedUserId(sessionCookieValue: string): Promise<string | null> {
  const cached = verifiedUserCache.get(sessionCookieValue);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

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
    const userId = data.user?.id ?? null;

    if (userId) {
      // Salvaguarda de memória em isolates de vida longa — clear() completo
      // (não LRU parcial) ao ultrapassar o teto: simplicidade sobre
      // eficiência marginal, já que o TTL de 10s já limita o tamanho útil
      // do Map na prática.
      if (verifiedUserCache.size >= CACHE_MAX_ENTRIES) {
        verifiedUserCache.clear();
      }
      verifiedUserCache.set(sessionCookieValue, { userId, expiresAt: Date.now() + CACHE_TTL_MS });
    }

    return userId;
  } catch (error) {
    console.warn("[verified-user] falha de rede/timeout", error);
    return null;
  }
}
