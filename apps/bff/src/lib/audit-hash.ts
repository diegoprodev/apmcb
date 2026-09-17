import { createHash } from "crypto";
import { logger } from "./logger.ts";

interface HashParams {
  seq: number;
  actor_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  before_snapshot: unknown;
  after_snapshot: unknown;
  created_at: string;       // ISO 8601 string
  previous_hash: string | null;
}

/**
 * Computes SHA-256 hash for an audit event.
 * Fields are sorted alphabetically to ensure canonical JSON representation.
 * This makes the hash deterministic regardless of insertion order.
 */
export function computeEventHash(params: HashParams): string {
  const sorted = Object.fromEntries(
    Object.entries(params).sort(([a], [b]) => a.localeCompare(b))
  );
  const payload = JSON.stringify(sorted);
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * Fetches the hash of the last audit event for a given tenant.
 * Returns null if no events exist yet (first event in chain).
 */
export async function getLastEventHash(
  supabase: Parameters<typeof computeEventHash>[0] extends infer _
    ? import("@supabase/supabase-js").SupabaseClient
    : never,
  tenantId: string | null
): Promise<string | null> {
  // Eventos sem tenant (ex: confirmação de troca de e-mail via token, sem
  // sessão, tenant desconhecido antes do lookup) formam sua PRÓPRIA cadeia
  // (partição tenant_id IS NULL) em vez de sempre previous_hash=null — senão
  // N eventos anônimos ficam sem encadeamento entre si, o que esconderia
  // remoção/reordenação exatamente na classe de evento mais provável de
  // representar abuso (força bruta de token).
  let query = supabase
    .from("audit_events")
    .select("event_hash")
    .order("seq", { ascending: false })
    .limit(1);
  query = tenantId ? query.eq("tenant_id", tenantId) : query.is("tenant_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) {
    logger.error("audit.get_last_event_hash.failure", { tenant_id: tenantId, error: error.message });
  }
  return data?.event_hash ?? null;
}
