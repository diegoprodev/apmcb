/**
 * APMCB Enterprise Test Harness
 * Centralises credentials, base URLs, helpers and assertions
 * used across all E2E and stress specs.
 */

import fs from "fs";
import path from "path";
import { type Page, type BrowserContext, expect, type Response } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// ─── Config ────────────────────────────────────────────────────────────────

export const BASE_URL = process.env.E2E_BASE_URL ?? "https://apmcb.pmpb.online";
export const BFF_URL  = process.env.E2E_BFF_URL  ?? "https://api.apmcb.pmpb.online";

export const USERS = {
  admin: {
    email:     "admin@apmcb.dev",
    matricula: "000001",
    password:  "Admin@123",
    role:      "admin_global",
    landAt:    "/admin",
  },
  reserva: {
    email:     "armeiro@apmcb.dev",
    matricula: "000002",
    password:  "Armeiro@123",
    role:      "armeiro",
    landAt:    "/reserva",
  },
  adminReserva: {
    email:     "admin_reserva@apmcb.dev",
    matricula: "000004",
    password:  "Admin@123",
    role:      "admin_reserva",
    landAt:    "/reserva",
  },
  efetivo: {
    email:     "cadete@apmcb.dev",
    matricula: "000003",
    password:  "Cadete@123",
    role:      "usuario",
    landAt:    "/efetivo",
  },
} as const;

export type UserKey = keyof typeof USERS;

// ─── Token cache (pre-authenticated in global-setup, avoids rate-limiting) ─

const TOKEN_CACHE_FILE = path.join(process.cwd(), ".auth", "e2e-tokens.json");
type TokenEntry = { access_token: string; refresh_token: string };
let _tokenCache: Record<string, TokenEntry> | null = null;

function readTokenCache(): Record<string, TokenEntry> {
  if (!_tokenCache) {
    try { _tokenCache = JSON.parse(fs.readFileSync(TOKEN_CACHE_FILE, "utf-8")); }
    catch { _tokenCache = {}; }
  }
  return _tokenCache!;
}

// ─── Timeouts ──────────────────────────────────────────────────────────────

export const T = {
  navigation:   20_000,
  apiResponse:  5_000,
  animation:    500,
} as const;

// ─── Auth helpers ──────────────────────────────────────────────────────────

/**
 * Login via cached token → /auth/exchange#tokens → BFF iron-session.
 *
 * Tokens are pre-minted once in global-setup.ts (signInWithPassword x4) and
 * cached in .auth/e2e-tokens.json. This eliminates per-test Supabase Auth API
 * calls that were triggering rate-limiting after ~36 logins in 7.4 minutes.
 *
 * Falls back to fresh signInWithPassword if cache is missing (e.g., local runs
 * without global-setup credentials). The /auth/exchange flow is exercised in
 * full: BFF iron-session + Supabase SSR HttpOnly cookie via upgrade-session.
 */
export async function login(page: Page, user: UserKey) {
  const u = USERS[user];

  const cached = readTokenCache()[user];
  let access_token: string;
  let refresh_token: string;

  if (cached?.access_token) {
    ({ access_token, refresh_token } = cached);
  } else {
    // Fallback: fresh sign-in (local dev without global-setup credentials)
    const adminSupabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
    const { data, error } = await adminSupabase.auth.signInWithPassword({
      email: u.email,
      password: u.password,
    });
    if (error || !data?.session) {
      throw new Error(`login() failed for ${user}: ${error?.message ?? "sem session"}`);
    }
    ({ access_token, refresh_token } = data.session);
  }

  // Clear stale session cookies before switching users.
  await page.context().clearCookies();

  // Navigate to /auth/exchange — exercises BFF iron-session + HttpOnly upgrade.
  // Skipping the /login pre-navigation: Phase 2 uses HttpOnly cookies (not
  // localStorage) so clearing it is unnecessary and saves one CF Pages round-trip.
  await page.goto(
    `${BASE_URL}/auth/exchange#access_token=${access_token}&refresh_token=${refresh_token}&token_type=bearer`,
    { waitUntil: "load" }
  );
  await page.waitForURL(`**${u.landAt}**`, { timeout: T.navigation });
}

/**
 * Signs out via header dropdown and asserts redirect to /login.
 */
export async function logout(page: Page) {
  const trigger = page.locator('header [aria-haspopup="menu"]').last();
  await expect(trigger).toBeVisible({ timeout: T.navigation });
  await trigger.click({ force: true });
  await page.getByRole("menuitem", { name: /sair/i }).click({ force: true });
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

// ─── Storage health assertions ─────────────────────────────────────────────

/**
 * Captures Supabase Storage 4xx/5xx responses during a page interaction.
 * USAGE: call BEFORE navigation, then call the returned fn after to assert.
 *
 * Example:
 *   const assertStorage = monitorStorageErrors(page);
 *   await page.goto("/admin");
 *   await assertStorage(); // throws if any storage request returned 4xx
 */
export function monitorStorageErrors(page: Page): () => void {
  const failures: string[] = [];
  const handler = (response: Response) => {
    if (response.url().includes(".supabase.co/storage") && response.status() >= 400) {
      failures.push(`HTTP ${response.status()} — ${response.url()}`);
    }
  };
  page.on("response", handler);
  return () => {
    page.off("response", handler);
    expect(
      failures,
      `Storage requests retornaram erro:\n${failures.join("\n")}`,
    ).toHaveLength(0);
  };
}

/**
 * Asserts all <img> elements with Supabase Storage hrefs loaded (naturalWidth > 0).
 * Call after page has fully rendered.
 */
export async function assertAllImagesLoaded(page: Page) {
  const brokenImgs = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img"));
    return imgs
      .filter((img) => img.src.includes(".supabase.co/storage") && img.naturalWidth === 0)
      .map((img) => img.src);
  });
  expect(
    brokenImgs,
    `Imagens do Supabase Storage não carregaram:\n${brokenImgs.join("\n")}`,
  ).toHaveLength(0);
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
