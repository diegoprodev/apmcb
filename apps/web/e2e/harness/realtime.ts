/**
 * Realtime Test Harness
 * Helpers for triggering DB changes used in realtime-suite.spec.ts.
 * All mutations use the service_role key (supabaseAdmin) to bypass RLS —
 * tests verify that UI updates are triggered by the DB event, not by the actor's own action.
 */

import { createClient } from "@supabase/supabase-js";
import { USERS } from "../harness";

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

/**
 * Returns the first active lending for the cadete (military_id = cadete profile id).
 * Returns null if none exist.
 */
export async function getActiveLendingForCadete(): Promise<{ id: string; military_id: string } | null> {
  const db = supabaseAdmin();
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("matricula", USERS.efetivo.matricula)
    .single();
  if (!profile) return null;

  const { data } = await db
    .from("lendings")
    .select("id, military_id")
    .eq("military_id", profile.id)
    .eq("status_legacy", "ativo")
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Marks a lending as returned via direct DB update.
 * Triggers an UPDATE event on `lendings` table — picked up by Realtime subscribers.
 */
export async function triggerLendingReturn(lendingId: string): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("lendings")
    .update({ status_legacy: "devolvido", returned_at: new Date().toISOString() })
    .eq("id", lendingId);
}

/**
 * Inserts a minimal material_request row directly in the DB.
 * Triggers an INSERT event on `material_requests` — picked up by armeiro's Realtime.
 * Returns the new request id.
 */
export async function triggerSSAInsert(): Promise<string> {
  const db = supabaseAdmin();

  const { data: cadete } = await db
    .from("profiles")
    .select("id, default_tenant_id")
    .eq("matricula", USERS.efetivo.matricula)
    .single();
  if (!cadete) throw new Error("Cadete profile not found");

  const { data: req, error } = await db
    .from("material_requests")
    .insert({
      military_id: cadete.id,
      tenant_id: cadete.default_tenant_id,
      status: "pendente",
      totp_validated: true,
      totp_validated_at: new Date().toISOString(),
      requested_at: new Date().toISOString(),
      // expires_at omitted: constraint expires_requires_approval requires approved_at NOT NULL
    })
    .select("id")
    .single();
  if (error || !req) throw new Error(`Failed to insert material_request: ${error?.message}`);
  return req.id;
}

/**
 * Approves a material_request via direct DB UPDATE.
 * Triggers an UPDATE event on `material_requests`.
 */
export async function triggerSSAApproval(requestId: string): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("material_requests")
    .update({ status: "aprovado", approved_at: new Date().toISOString() })
    .eq("id", requestId);
}

/**
 * Cancels a material_request via direct DB UPDATE (cleanup helper).
 */
export async function cancelSSARequest(requestId: string): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("material_requests")
    .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
    .eq("id", requestId);
}

/**
 * Toggles a material_item's status to trigger an UPDATE event on `material_items`.
 * This causes material_availability view to recompute, refreshing arsenal pages.
 * Returns the item to its original status after the trigger.
 */
export async function triggerMaterialItemUpdate(): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: item } = await db
    .from("material_items")
    .select("id, status")
    .limit(1)
    .maybeSingle();
  if (!item) return false;

  // Touch the updated_at to fire a CDC event without actually changing business state
  await db
    .from("material_items")
    .update({ updated_at: new Date().toISOString() } as Record<string, unknown>)
    .eq("id", item.id);
  return true;
}
