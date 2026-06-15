/**
 * APMCB Enterprise Test Harness
 * Centralises credentials, base URLs, helpers and assertions
 * used across all E2E and stress specs.
 */

import { type Page, type BrowserContext, expect } from "@playwright/test";

// ─── Config ────────────────────────────────────────────────────────────────

export const BASE_URL = process.env.E2E_BASE_URL ?? "https://apmcb.pmpb.online";
export const BFF_URL  = process.env.E2E_BFF_URL  ?? "http://91.99.113.89";

export const USERS = {
  admin: {
    email:     "admin@apmcb.dev",
    matricula: "000001",
    password:  "Admin@123",
    role:      "admin",
    landAt:    "/admin",
  },
  armeiro: {
    email:     "armeiro@apmcb.dev",
    matricula: "000002",
    password:  "Armeiro@123",
    role:      "master",
    landAt:    "/armeiro",
  },
  cadete: {
    email:     "cadete@apmcb.dev",
    matricula: "000003",
    password:  "Cadete@123",
    role:      "military",
    landAt:    "/cadete",
  },
} as const;

export type UserKey = keyof typeof USERS;

// ─── Timeouts ──────────────────────────────────────────────────────────────

export const T = {
  navigation:   20_000,
  apiResponse:  5_000,
  animation:    500,
} as const;

// ─── Auth helpers ──────────────────────────────────────────────────────────

/**
 * Full login flow for a given user; asserts landing page.
 */
export async function login(page: Page, user: UserKey) {
  const u = USERS[user];
  await page.goto(`${BASE_URL}/login`, { waitUntil: "load" });

  // Wait for the input to be enabled (React hydration completes after network idle)
  const emailInput = page.getByLabel(/e-mail ou matrícula/i);
  await emailInput.waitFor({ state: "visible", timeout: T.navigation });
  await emailInput.fill(u.matricula);
  await page.locator('input[type="password"]').fill(u.password);
  const submitBtn = page.getByRole("button", { name: /entrar/i });
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();

  await page.waitForURL(`**${u.landAt}**`, { timeout: T.navigation });
}

/**
 * Signs out via header dropdown and asserts redirect to /login.
 */
export async function logout(page: Page) {
  await page.locator('header [aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: /sair/i }).click();
  await page.waitForURL(`**/login**`, { timeout: T.navigation });
}

/**
 * Returns cookies currently set on the page context.
 */
export async function getCookies(context: BrowserContext) {
  return context.cookies();
}

// ─── Security assertions ───────────────────────────────────────────────────

/**
 * Asserts that no Supabase JWT appears in localStorage (must use HttpOnly cookies).
 * FAILING: current implementation exposes JWT in sb-* storage keys.
 */
export async function assertNoJwtInLocalStorage(page: Page) {
  const keys = await page.evaluate(() => Object.keys(window.localStorage));
  const jwtKeys = keys.filter((k) => k.startsWith("sb-") && k.includes("auth-token"));
  expect(
    jwtKeys,
    `JWT found in localStorage: [${jwtKeys.join(", ")}] — must move to HttpOnly cookie via BFF`
  ).toHaveLength(0);
}

/**
 * Asserts that auth cookies are HttpOnly (not readable by JS).
 * FAILING if Supabase SDK manages cookies directly (they are SameSite=Lax but NOT HttpOnly).
 */
export async function assertHttpOnlyCookies(context: BrowserContext) {
  const cookies = await getCookies(context);
  const authCookies = cookies.filter((c) => c.name.startsWith("sb-") || c.name.includes("session"));
  for (const cookie of authCookies) {
    expect(
      cookie.httpOnly,
      `Cookie "${cookie.name}" is not HttpOnly — JWT accessible via JS`
    ).toBe(true);
  }
}

/**
 * Asserts BFF /health responds and is reachable from tests.
 */
export async function assertBffHealthy(page: Page) {
  const resp = await page.request.get(`${BFF_URL}/health`);
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.ok).toBe(true);
}

// ─── UI helpers ────────────────────────────────────────────────────────────

export async function waitForDashboard(page: Page) {
  await page.waitForLoadState("networkidle");
  // Header is always visible regardless of viewport (sidebar may be hidden on mobile)
  await expect(page.locator("header")).toBeVisible({ timeout: T.navigation });
}

export async function assertNoConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  // Give page a moment to settle
  await page.waitForTimeout(T.animation);
  expect(errors.filter((e) => !e.includes("preload"))).toHaveLength(0);
}

// ─── Metrics collector ─────────────────────────────────────────────────────

export interface PerfSnapshot {
  url: string;
  ttfb: number;       // ms
  domLoad: number;    // ms
  lcp: number | null; // ms
}

export async function collectPerf(page: Page): Promise<PerfSnapshot> {
  return page.evaluate((): PerfSnapshot => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const lcpEntries = performance.getEntriesByType("largest-contentful-paint");
    return {
      url: location.href,
      ttfb: Math.round(nav.responseStart - nav.requestStart),
      domLoad: Math.round(nav.domContentLoadedEventEnd - nav.requestStart),
      lcp: lcpEntries.length
        ? Math.round((lcpEntries[lcpEntries.length - 1] as PerformanceEntry).startTime)
        : null,
    };
  });
}
