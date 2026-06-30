// SRP: verificação de validade de sessão isolada do middleware de autenticação.
// Usa injeção de dependência (fetcher) para ser testável sem mock de módulos.

export interface SessionInput {
  userId: string;
  role: string;
  issuedAt: number; // Date.now() no momento do login
}

export interface GuardResult {
  valid: boolean;
  reason?: "session_invalidated" | "role_changed";
}

export interface ProfileSnapshot {
  role: string;
  invalidatedAt: string | null;
}

export type ProfileFetcher = (userId: string) => Promise<ProfileSnapshot>;

interface CacheEntry extends ProfileSnapshot {
  checkedAt: number;
}

const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, CacheEntry>();

export async function checkSessionValid(
  session: SessionInput,
  fetcher: ProfileFetcher,
): Promise<GuardResult> {
  const cached = _cache.get(session.userId);
  const profile: ProfileSnapshot =
    cached && Date.now() - cached.checkedAt < CACHE_TTL_MS
      ? cached
      : await (async () => {
          const p = await fetcher(session.userId);
          _cache.set(session.userId, { ...p, checkedAt: Date.now() });
          return p;
        })();

  if (profile.role !== session.role) {
    return { valid: false, reason: "role_changed" };
  }

  if (profile.invalidatedAt) {
    const invalidatedMs = new Date(profile.invalidatedAt).getTime();
    if (session.issuedAt < invalidatedMs) {
      return { valid: false, reason: "session_invalidated" };
    }
  }

  return { valid: true };
}

// Fetcher de produção — usa cliente Supabase service role (bypassa RLS)
export function makeSupabaseFetcher(
  supabase: { from: (t: string) => unknown },
): ProfileFetcher {
  return async (userId: string) => {
    const { data } = await (supabase
      .from("profiles") as any)
      .select("role, sessions_invalidated_at")
      .eq("id", userId)
      .single();
    return {
      role: data?.role ?? "",
      invalidatedAt: data?.sessions_invalidated_at ?? null,
    };
  };
}
