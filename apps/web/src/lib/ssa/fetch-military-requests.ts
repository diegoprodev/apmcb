import type { createClient } from "@/lib/supabase/server";
import type { Status, RequestItem } from "@/types/ssa";

export interface MilitaryRequestRow {
  id: string;
  status: Status;
  requested_at: string;
  approved_at: string | null;
  expires_at: string | null;
  denial_reason: string | null;
  cancellation_reason: string | null;
  armeiro_nota: string | null;
  items: RequestItem[];
}

export interface FetchMilitaryRequestsResult {
  requests: MilitaryRequestRow[];
  /** Non-null when the query failed — a small inline notice, never a
   * silently-empty list (a failed query used to render identically to
   * "you have no requests", which is misleading for something users are
   * anxious about). Null on success, including a genuinely empty result. */
  error: string | null;
}

/**
 * Shared `material_requests` query for a military's own requests — used by
 * both /efetivo (dashboard preview, limit 5) and /efetivo/solicitacoes
 * (full list, paginated). Previously duplicated independently in both
 * Server Components with the exact same column list and `.eq("military_id", ...)`
 * filter, differing only in order/limit (still left to the caller).
 */
export async function fetchMilitaryRequests(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  limit: number
): Promise<FetchMilitaryRequestsResult> {
  const { data, error } = await supabase
    .from("material_requests")
    .select(`
      id, status, requested_at, approved_at, expires_at, denial_reason, cancellation_reason, armeiro_nota,
      items:material_request_items(
        material_nome_snapshot, requested_quantity
      )
    `)
    .eq("military_id", userId)
    .order("requested_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[fetchMilitaryRequests] falha ao buscar solicitações", error);
    return { requests: [], error: "Não foi possível carregar suas solicitações agora." };
  }

  // Achado de code review: o cast `as unknown as MilitaryRequestRow[]` não
  // verificava nada em runtime — um drift de schema (rename de coluna,
  // mudança na FK do embed) não quebraria o build nem falharia alto, só
  // vazaria como `undefined` silencioso na UI. Não vale um parser completo
  // pra isso (schema já é o mesmo que rodava em produção antes deste
  // refactor), mas um warn no formato mais estrutural que pode drifar de
  // verdade — `items` deixar de ser array — dá sinal cedo sem exigir
  // validação de cada campo escalar.
  const rows = (data ?? []) as unknown as MilitaryRequestRow[];
  for (const row of rows) {
    if (!Array.isArray(row.items)) {
      console.warn("[fetchMilitaryRequests] items não é array — possível drift de schema", { id: row.id });
    }
  }

  return { requests: rows, error: null };
}
