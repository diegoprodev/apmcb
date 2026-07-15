// SRP: verificação de validade de sessão isolada do middleware de autenticação.
// Usa injeção de dependência (fetcher) para ser testável sem mock de módulos.

import { logger } from "./logger.ts";

export interface SessionInput {
  userId: string;
  role: string;
  issuedAt: number; // Date.now() no momento do login
  // Ausente em sessões seladas antes da introdução de revoked_sessions
  // (2026-07-15) — tratadas como não-revogáveis individualmente até
  // expirarem naturalmente pelo maxAge do cookie.
  sessionId?: string;
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
// Denylist por sessão individual (revoked_sessions) — separado da
// invalidação em massa por usuário (profiles.sessions_invalidated_at).
// Logout normal usa só isso; sessions_invalidated_at fica reservado para
// revogação administrativa em massa (ban, reset de senha).
export type RevokedSessionChecker = (sessionId: string) => Promise<boolean>;

interface CacheEntry extends ProfileSnapshot {
  checkedAt: number;
}

const CACHE_TTL_MS = 60_000;
const _cache = new Map<string, CacheEntry>();

export async function checkSessionValid(
  session: SessionInput,
  fetcher: ProfileFetcher,
  isRevoked: RevokedSessionChecker,
): Promise<GuardResult> {
  // Checagem por sessão individual primeiro — é um lookup por PK (rápido),
  // não cacheado de propósito: uma revogação precisa surtir efeito na
  // requisição seguinte, não até 60s depois.
  if (session.sessionId && (await isRevoked(session.sessionId))) {
    return { valid: false, reason: "session_invalidated" };
  }

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

// Checker de produção — PK lookup em revoked_sessions, sem cache de propósito.
export function makeSupabaseRevokedChecker(
  supabase: { from: (t: string) => unknown },
): RevokedSessionChecker {
  return async (sessionId: string) => {
    const { data, error } = await (supabase
      .from("revoked_sessions") as any)
      .select("session_id")
      .eq("session_id", sessionId)
      .maybeSingle();
    // Achado de code review: falha aqui (migration não aplicada num
    // ambiente, timeout, blip de rede) não pode falhar aberta em silêncio —
    // isso desligaria o mecanismo de revogação inteiro sem nenhum sinal.
    if (error) {
      logger.error("session_guard.revoked_check_failure", { sessionId, error: error.message });
    }
    return data !== null;
  };
}
