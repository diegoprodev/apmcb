import { createHash } from "crypto";

interface HashParams {
  seq: number;
  actor_id: string;
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
  if (!tenantId) return null;
  const { data } = await (supabase as import("@supabase/supabase-js").SupabaseClient)
    .from("audit_events")
    .select("event_hash")
    .eq("tenant_id", tenantId)
    .order("seq", { ascending: false })
    .limit(1)
    .single();
  return data?.event_hash ?? null;
}
