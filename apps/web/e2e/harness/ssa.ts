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
// @supabase/ssr stores the session in chunked cookies (not localStorage).
// Cookie names: sb-<project-ref>-auth-token, sb-<project-ref>-auth-token.0, .1, ...
const SUPABASE_PROJECT_REF = "jepitcrkicwmvzrmllpn";

async function getSupabaseToken(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  const prefix = `sb-${SUPABASE_PROJECT_REF}-auth-token`;
  const chunks = cookies
    .filter((c) => c.name === prefix || c.name.startsWith(`${prefix}.`))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (!chunks.length) return null;
  try {
    const raw = chunks.map((c) => c.value).join("");
    let json: string;
    if (raw.startsWith("base64-")) {
      // cookieEncoding:"base64url" path — convert base64url → standard base64 then decode
      const b64 = raw.slice(7).replace(/-/g, "+").replace(/_/g, "/");
      json = Buffer.from(b64, "base64").toString("utf-8");
    } else {
      // Default @supabase/ssr path: cookie value IS the plain JSON session string
      json = raw;
    }
    const session = JSON.parse(json);
    return (session?.access_token as string) ?? null;
  } catch {
    return null;
  }
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
  const fetchOpts = {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    data: body !== undefined ? JSON.stringify(body) : undefined,
  };

  // Retry up to 7 times on 503 (transient BFF restarts up to ~56s; 7×8s coverage).
  for (let attempt = 0; attempt < 7; attempt++) {
    const res = await page.request.fetch(url, fetchOpts);
    let data: unknown;
    try { data = await res.json(); } catch { data = null; }
    const status = res.status();
    if (status !== 503 || attempt === 6) return { status, data };
    await page.waitForTimeout(8_000);
  }
  return { status: 503, data: null };
}

// ─── TOTP setup ───────────────────────────────────────────────────────────

/**
 * Configure TOTP for the cadete user via BFF (idempotent).
 */
export async function setupTOTP(page: Page): Promise<void> {
  const { status } = await bffCall(page, "POST", "/api/totp/setup");
  if (status !== 200 && status !== 201) throw new Error(`TOTP setup failed: HTTP ${status}`);
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

  // Retry up to 3 times: on TOTP "Código inválido" wait for next window.
  // Needed when anti-replay blocks a code reused within the same 30s period.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await getTOTPCode(page);
    const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
      items: [{ material_type_id: material.id, quantity: overrides?.quantity ?? 1 }],
      totp_token: code,
    });
    if (status === 201) return { request_id: (data as { request_id: string }).request_id };
    const err = JSON.stringify(data);
    if (status === 400 && err.includes("nválido") && attempt < 2) {
      await page.waitForTimeout(31_000);
      continue;
    }
    throw new Error(`Failed to create request: HTTP ${status} — ${err}`);
  }
  throw new Error("Failed to create material request after 3 attempts");
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

  // Cancel ALL pending/approved requests (any user) to fully restore stock
  await db
    .from("material_requests")
    .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
    .in("status", ["pendente", "aprovado"]);

  // Reset TOTP anti-replay so next test can reuse the same code period
  await db
    .from("totp_secrets")
    .update({ last_used_token: null, failure_count: 0, last_failure_at: null })
    .eq("user_id", profile.id);

  // Return ALL active lendings (any user) so materials go back to full stock
  await db
    .from("lendings")
    .update({ status: "devolvido", returned_at: new Date().toISOString() })
    .eq("status", "ativo");
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
