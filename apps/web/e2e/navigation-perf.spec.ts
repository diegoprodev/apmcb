/**
 * APMCB — PERF-02 network call counting (spec §8, mandatory)
 *
 * getSessionUser()/getSessionProfile() (apps/web/src/lib/session-profile.ts)
 * only pay off if React's cache() actually dedupes them between
 * (dashboard)/layout.tsx and each page.tsx within the same RSC render — "the
 * code looks right" is not evidence (CRÍTICO finding from code review). A
 * Vitest/mock harness cannot prove this: cache() only truly dedupes inside
 * Next's real render dispatcher (confirmed empirically — an isolated harness
 * built with react-server-dom-webpack directly produces a false negative on
 * the second chained cache() call even with correct production code). This
 * test proves it against the real `next dev` pipeline.
 *
 * Reads a hidden DOM marker instead of a separate debug API route — an
 * earlier version of this test tried a `/api/debug/...` route and always
 * saw 0 regardless of real dedup: Next.js compiles Server Components
 * (layout/page) and Route Handlers into SEPARATE module graphs even in dev,
 * so a route.ts import of session-profile.ts never sees the counters that
 * layout.tsx/page.tsx actually incremented. The marker (reserva/arsenal/page.tsx,
 * data-testid="perf02-debug-counters") stays inside the SAME module graph as
 * the real calls, sidestepping that. Counters are reset at the top of
 * (dashboard)/layout.tsx on every request (dev-only), so the value read here
 * is exactly this one request's real (non-cache-hit) call count.
 *
 * Targets reserva/arsenal/page.tsx specifically — the real route from the
 * original user-reported slowness, not a synthetic one (a generic route
 * could pass after migrating only 1-2 of the 28 PERF-02 pages).
 *
 * Run: npx playwright test e2e/navigation-perf.spec.ts --project=chromium
 * Requires E2E_BASE_URL pointed at a local `next dev` — never run this
 * against production (the marker never renders there — NODE_ENV==="production"
 * — but the shared Supabase project behind BASE_URL/global-teardown makes ANY
 * Playwright test-runner invocation against it risky regardless of spec content).
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

test.describe("PERF-02 — dedup real de getSessionUser/getSessionProfile em reserva/arsenal", () => {
  test("layout.tsx + reserva/arsenal/page.tsx no MESMO request somam 1 chamada de getUser() e 1 de profiles, não 2", async ({
    page,
  }) => {
    await login(page, "reserva"); // armeiro — dono da rota reserva/arsenal

    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /arsenal/i }).first()).toBeVisible({ timeout: 10_000 });

    const marker = page.getByTestId("perf02-debug-counters");
    await expect(
      marker,
      "marcador de debug ausente — página rodando com NODE_ENV=production, ou reserva/arsenal/page.tsx mudou de estrutura",
    ).toBeAttached();
    const counters = JSON.parse((await marker.textContent()) ?? "{}");

    expect(
      counters.getUserCalls,
      `getSessionUser() rodou ${counters.getUserCalls}x para 1 navegação (layout+page) — esperado 1. Regressão do PERF-02: dedup do cache() quebrou.`,
    ).toBe(1);
    expect(
      counters.getSessionProfileCalls,
      `getSessionProfile() rodou ${counters.getSessionProfileCalls}x para 1 navegação (layout+page) — esperado 1. Regressão do PERF-02: dedup do cache() quebrou.`,
    ).toBe(1);
  });
});
