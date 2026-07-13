/**
 * APMCB — Shared test helpers for the new spec files.
 * Re-exports everything from harness.ts and adds lightweight
 * convenience wrappers that take the full USERS object shape.
 */

import { type Page, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// Re-export everything from harness so callers can use either file.
export {
  BASE_URL,
  BFF_URL,
  USERS,
  login,
  logout,
  waitForDashboard,
  collectPerf,
  assertNoJwtInLocalStorage,
  assertHttpOnlyCookies,
  monitorStorageErrors,
  assertAllImagesLoaded,
  type UserKey,
  type PerfSnapshot,
} from "./harness";

// ─── Toast helper ───────────────────────────────────────────────────────────

/**
 * Asserts that a Sonner toast containing `text` becomes visible.
 */
export async function expectToast(page: Page, text: string | RegExp) {
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: text })
  ).toBeVisible({ timeout: 6000 });
}

// ─── Table helper ───────────────────────────────────────────────────────────

/**
 * Waits for at least one tbody row to be visible and returns the row count.
 */
export async function waitForTableRows(page: Page, minRows = 1) {
  await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 8000 });
  const count = await page.locator("tbody tr").count();
  expect(count).toBeGreaterThanOrEqual(minRows);
  return count;
}

// ─── Turno (Livro Digital) helper ───────────────────────────────────────────

/**
 * Garante que o armeiro (por matrícula) tem um turno "ativo" antes de testar
 * páginas atrás do guard de turno (_shift-guard.tsx bloqueia /reserva/saidas/nova
 * inteira sem turno ativo). Usado por specs que testam esse fluxo sem passar
 * pela UI de abrir turno (TOTP real). Se já existir um turno ativo, não mexe
 * (retorna null — não fechar no teardown o turno de outro uso real). Se
 * perder a corrida de criação para outro worker (uq_shifts_armeiro_ativo),
 * trata como sucesso — o turno que importa já está garantido.
 */
export async function ensureActiveShift(matricula: string): Promise<string | null> {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: profile } = await sb
    .from("profiles")
    .select("id, default_tenant_id")
    .eq("matricula", matricula)
    .single();
  const { data: existing } = await sb
    .from("service_shifts")
    .select("id")
    .eq("armeiro_id", profile!.id)
    .eq("status", "ativo")
    .maybeSingle();
  if (existing) return null;

  const { data: membership } = await sb
    .from("reserve_memberships")
    .select("reserve_id")
    .eq("user_id", profile!.id)
    .limit(1)
    .single();
  const { data: shift, error } = await sb
    .from("service_shifts")
    .insert({
      tenant_id: profile!.default_tenant_id,
      reserve_id: membership!.reserve_id,
      armeiro_id: profile!.id,
      status: "ativo",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return null; // outro worker já garantiu — uq_shifts_armeiro_ativo
    throw new Error(`Falha ao abrir turno fixture: ${error.message}`);
  }
  return shift.id;
}

/** Encerra o turno criado por ensureActiveShift — no-op se shiftId for null. */
export async function closeShiftIfOpened(shiftId: string | null): Promise<void> {
  if (!shiftId) return;
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await sb.from("service_shifts").update({ status: "encerrado", ended_at: new Date().toISOString() }).eq("id", shiftId);
}
