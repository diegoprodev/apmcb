/**
 * APMCB — Shared test helpers for the new spec files.
 * Re-exports everything from harness.ts and adds lightweight
 * convenience wrappers that take the full USERS object shape.
 */

import { type Page, expect } from "@playwright/test";

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
