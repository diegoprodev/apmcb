/**
 * SSA Enterprise Test Harness
 * Shared helpers for TOTP + SSA spec files.
 *
 * Deps: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.test
 */

import { type Page, type APIRequestContext, type APIResponse, expect } from "@playwright/test";
import { BASE_URL, BFF_URL, USERS, login } from "../harness";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase admin client (service_role) ─────────────────────────────────

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ─── BFF API helpers ──────────────────────────────────────────────────────

/**
 * Make an authenticated call to the BFF using the page's session cookies.
 * The page must be logged in before calling this.
 */
/**
 * Extract the Supabase access token from the browser's localStorage.
 * Supabase JS stores it under keys like "sb-<ref>-auth-token".
 */
async function getSupabaseToken(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        try {
          const val = JSON.parse(localStorage.getItem(key) ?? "{}");
          return val?.access_token ?? null;
        } catch { /* ignore */ }
      }
    }
    return null;
  });
}

export async function bffCall(
  page: Page,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const url = `${BFF_URL}${path}`;

  // Use Bearer token so the BFF auth middleware accepts us without iron-session.
  // This also skips CSRF (Bearer = no cookie-based session = no CSRF surface).
  const token = await getSupabaseToken(page);

  const res = await page.request.fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    data: body ? JSON.stringify(body) : undefined,
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status(), data };
}

// ─── TOTP setup ───────────────────────────────────────────────────────────

/**
 * Configure TOTP for the cadete user via BFF (idempotent).
 */
export async function setupTOTP(page: Page): Promise<void> {
  const { status } = await bffCall(page, "POST", "/api/totp/setup");
  if (status !== 200) throw new Error(`TOTP setup failed: HTTP ${status}`);
}

/**
 * Get the current TOTP code for the logged-in cadete.
 * Waits if the code has < 5s remaining to avoid boundary flakiness.
 */
export async function getTOTPCode(page: Page): Promise<string> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { status, data } = await bffCall(page, "GET", "/api/totp/code");
    if (status !== 200) throw new Error(`Failed to get TOTP code: HTTP ${status}`);
    const body = data as { code: string; seconds_remaining: number };
    if (body.seconds_remaining > 5) return body.code;
    // Code expires very soon — wait for next window to avoid race
    await page.waitForTimeout((body.seconds_remaining + 1) * 1000);
  }
  throw new Error("Failed to get stable TOTP code after 4 attempts");
}

// ─── Material helpers ─────────────────────────────────────────────────────

/**
 * Get the first available material from the SSA endpoint.
 */
export async function getFirstAvailableMaterial(
  page: Page
): Promise<{ id: string; nome: string; categoria: string }> {
  const { status, data } = await bffCall(page, "GET", "/api/ssa/available-materials");
  if (status !== 200) throw new Error(`Failed to get materials: HTTP ${status}`);
  const materials = data as { id: string; nome: string; categoria: string }[];
  if (!materials.length) throw new Error("No available materials in fixture");
  return materials[0];
}

// ─── Request lifecycle ────────────────────────────────────────────────────

/**
 * Create a material request for the logged-in cadete.
 * Returns { request_id, status }.
 */
export async function createMaterialRequest(
  page: Page,
  overrides?: { quantity?: number }
): Promise<{ request_id: string }> {
  const material = await getFirstAvailableMaterial(page);
  const code = await getTOTPCode(page);

  const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
    items: [{ material_type_id: material.id, quantity: overrides?.quantity ?? 1 }],
    totp_token: code,
  });

  if (status !== 201) {
    throw new Error(`Failed to create request: HTTP ${status} — ${JSON.stringify(data)}`);
  }
  return { request_id: (data as { request_id: string }).request_id };
}

/**
 * Cancel all pending/approved requests for the cadete (DB-direct cleanup).
 */
export async function cleanupRequests(): Promise<void> {
  const db = supabaseAdmin();
  const cadeteMatricula = USERS.cadete.matricula;

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("matricula", cadeteMatricula)
    .single();

  if (!profile) return;

  await db
    .from("material_requests")
    .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
    .eq("military_id", profile.id)
    .in("status", ["pendente", "aprovado"]);
}

/**
 * Force-expire a request by backdating expires_at by 7 hours.
 * Then call expire_material_requests() to flip the status.
 */
export async function forceExpireRequest(requestId: string): Promise<void> {
  const db = supabaseAdmin();
  await db
    .from("material_requests")
    .update({ expires_at: new Date(Date.now() - 7 * 3600 * 1000).toISOString() })
    .eq("id", requestId);

  await db.rpc("expire_material_requests");
}

/**
 * Reset TOTP failure count for the cadete (unlock after rate-limit tests).
 */
export async function resetTOTPFailures(): Promise<void> {
  const db = supabaseAdmin();
  const cadeteMatricula = USERS.cadete.matricula;

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("matricula", cadeteMatricula)
    .single();

  if (!profile) return;

  await db
    .from("totp_secrets")
    .update({ failure_count: 0, last_failure_at: null })
    .eq("user_id", profile.id);
}

/**
 * Return the cadete's profile ID (cached lookup).
 */
let _cadeteId: string | undefined;
export async function getCadeteId(): Promise<string> {
  if (_cadeteId) return _cadeteId;
  const db = supabaseAdmin();
  const { data } = await db
    .from("profiles")
    .select("id")
    .eq("matricula", USERS.cadete.matricula)
    .single();
  if (!data) throw new Error("Cadete profile not found in DB");
  _cadeteId = data.id as string;
  return _cadeteId;
}

/**
 * Verify audit trail for a given request contains the expected action.
 */
export async function assertAuditLog(requestId: string, action: string): Promise<void> {
  const db = supabaseAdmin();
  const { data } = await db
    .from("audit_logs")
    .select("action")
    .eq("resource_id", requestId)
    .eq("action", action);
  expect(data?.length ?? 0, `Expected audit log action "${action}" for request ${requestId}`).toBeGreaterThan(0);
}
