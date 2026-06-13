/**
 * APMCB — Stress & Load Test Suite
 *
 * Simulates concurrent users, repeated auth cycles, rapid navigation,
 * and sustained BFF load to surface bottlenecks before production traffic.
 *
 * Run: npx playwright test e2e/stress.spec.ts --workers=4 --reporter=html
 *
 * Environment:
 *   E2E_STRESS_CONCURRENCY  number of parallel sessions (default 5)
 *   E2E_STRESS_ITERATIONS   per-user repetitions      (default 10)
 */

import { test, expect, chromium } from "@playwright/test";
import {
  login,
  logout,
  BASE_URL,
  BFF_URL,
  USERS,
  collectPerf,
  type PerfSnapshot,
} from "./harness";

const CONCURRENCY  = Number(process.env.E2E_STRESS_CONCURRENCY ?? 5);
const ITERATIONS   = Number(process.env.E2E_STRESS_ITERATIONS  ?? 10);

// SLA thresholds
const SLA = {
  loginMs:      4_000,
  dashboardMs:  5_000,
  navigationMs: 3_000,
  bffP95Ms:     800,
  errorRatePct: 0,       // zero tolerance for errors
} as const;

// ══════════════════════════════════════════════════════════════════════════
// 1. REPEATED LOGIN / LOGOUT CYCLE (single user)
// ══════════════════════════════════════════════════════════════════════════

test.describe("Stress — auth cycle", () => {
  test(`admin login/logout × ${ITERATIONS} — all under ${SLA.loginMs}ms`, async ({ page }) => {
    const durations: number[] = [];

    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = Date.now();
      await login(page, "admin");
      durations.push(Date.now() - t0);
      await logout(page);
    }

    const max = Math.max(...durations);
    const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
    console.log(`Auth cycle — avg: ${avg}ms  max: ${max}ms  samples: ${durations.length}`);

    expect(max, `Max login time ${max}ms exceeded SLA ${SLA.loginMs}ms`).toBeLessThan(SLA.loginMs);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. RAPID NAVIGATION (single session)
// ══════════════════════════════════════════════════════════════════════════

test.describe("Stress — rapid navigation", () => {
  test("admin navigates all routes rapidly without error", async ({ page }) => {
    await login(page, "admin");

    const routes = [
      "/admin",
      "/admin/usuarios",
      "/admin/arsenal",
      "/admin/relatorios",
      "/admin/auditoria",
    ];

    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    for (let round = 0; round < 3; round++) {
      for (const route of routes) {
        const t0 = Date.now();
        await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
        const elapsed = Date.now() - t0;
        expect(elapsed, `${route} took ${elapsed}ms`).toBeLessThan(SLA.navigationMs);
      }
    }

    const realErrors = errors.filter((e) => !e.includes("preload") && !e.includes("404"));
    expect(realErrors, `Console errors: ${realErrors.join(" | ")}`).toHaveLength(0);
  });

  test("armeiro navigates all routes rapidly without error", async ({ page }) => {
    await login(page, "armeiro");

    const routes = ["/armeiro", "/armeiro/emprestimos", "/armeiro/militares", "/armeiro/relatorios"];
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    for (let round = 0; round < 3; round++) {
      for (const route of routes) {
        await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
      }
    }

    const realErrors = errors.filter((e) => !e.includes("preload") && !e.includes("404"));
    expect(realErrors).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. CONCURRENT SESSIONS (multi-browser)
// ══════════════════════════════════════════════════════════════════════════

test.describe("Stress — concurrent sessions", () => {
  test(`${CONCURRENCY} simultaneous admin sessions`, async () => {
    const browser = await chromium.launch();
    const results: { ok: boolean; ms: number; error?: string }[] = [];

    const tasks = Array.from({ length: CONCURRENCY }, async (_, i) => {
      const ctx  = await browser.newContext();
      const page = await ctx.newPage();
      const t0   = Date.now();
      try {
        await login(page, "admin");
        await page.waitForLoadState("networkidle");
        results.push({ ok: true, ms: Date.now() - t0 });
      } catch (err) {
        results.push({ ok: false, ms: Date.now() - t0, error: String(err) });
      } finally {
        await ctx.close();
      }
    });

    await Promise.all(tasks);
    await browser.close();

    const failures = results.filter((r) => !r.ok);
    const times    = results.filter((r) => r.ok).map((r) => r.ms);
    const p95      = times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)] ?? 0;

    console.log(
      `Concurrent sessions — success: ${results.length - failures.length}/${results.length}  p95: ${p95}ms`
    );

    expect(failures.length, `Failures: ${failures.map((f) => f.error).join(", ")}`).toBe(0);
    expect(p95, `p95 ${p95}ms exceeded SLA ${SLA.dashboardMs}ms`).toBeLessThan(SLA.dashboardMs);
  });

  test("mixed-role concurrent sessions (admin + armeiro + cadete)", async () => {
    const browser = await chromium.launch();
    const userKeys = Object.keys(USERS) as (keyof typeof USERS)[];
    const results: boolean[] = [];

    const tasks = userKeys.map(async (key) => {
      const ctx  = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await login(page, key);
        await page.waitForLoadState("networkidle");
        results.push(true);
      } catch {
        results.push(false);
      } finally {
        await ctx.close();
      }
    });

    await Promise.all(tasks);
    await browser.close();

    expect(results.every(Boolean), "One or more role sessions failed").toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. BFF ENDPOINT LOAD
// ══════════════════════════════════════════════════════════════════════════

test.describe("Stress — BFF load", () => {
  test(`BFF /health × ${ITERATIONS} concurrent — p95 < ${SLA.bffP95Ms}ms`, async ({ page }) => {
    const durations: number[] = [];
    const errors: number[] = [];

    const tasks = Array.from({ length: ITERATIONS }, async () => {
      const t0 = Date.now();
      try {
        const resp = await page.request.get(`${BFF_URL}/health`);
        durations.push(Date.now() - t0);
        if (resp.status() !== 200) errors.push(resp.status());
      } catch {
        errors.push(0);
      }
    });

    await Promise.all(tasks);

    const sorted = [...durations].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const errorRate = (errors.length / ITERATIONS) * 100;

    console.log(`BFF /health — p50: ${p50}ms  p95: ${p95}ms  errors: ${errors.length}/${ITERATIONS}`);

    expect(p95, `p95 ${p95}ms exceeded ${SLA.bffP95Ms}ms`).toBeLessThan(SLA.bffP95Ms);
    expect(errorRate, `Error rate ${errorRate}% exceeded ${SLA.errorRatePct}%`).toBe(SLA.errorRatePct);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. PERFORMANCE REGRESSION SUITE
// ══════════════════════════════════════════════════════════════════════════

test.describe("Stress — perf regression", () => {
  const PERF_BUDGET: Record<string, { ttfb: number; dom: number }> = {
    "/login":             { ttfb: 600,  dom: 2500 },
    "/admin":             { ttfb: 1000, dom: 4000 },
    "/armeiro":           { ttfb: 1000, dom: 4000 },
    "/registro-pendente": { ttfb: 800,  dom: 3000 },
  };

  for (const [route, budget] of Object.entries(PERF_BUDGET)) {
    test(`${route} — TTFB < ${budget.ttfb}ms, DOM < ${budget.dom}ms`, async ({ page }) => {
      const snapshots: PerfSnapshot[] = [];

      // 3 warm samples
      for (let i = 0; i < 3; i++) {
        if (route === "/login") {
          await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
        } else if (route === "/registro-pendente") {
          await login(page, "cadete");
        } else if (route === "/admin") {
          await login(page, "admin");
        } else if (route === "/armeiro") {
          await login(page, "armeiro");
        }
        snapshots.push(await collectPerf(page));
        if (route !== "/login") await page.goto(`${BASE_URL}/login`);
      }

      const avgTtfb = Math.round(snapshots.reduce((s, p) => s + p.ttfb, 0) / snapshots.length);
      const avgDom  = Math.round(snapshots.reduce((s, p) => s + p.domLoad, 0) / snapshots.length);

      console.log(`${route} — TTFB avg: ${avgTtfb}ms  DOM avg: ${avgDom}ms`);

      expect(avgTtfb, `TTFB avg ${avgTtfb}ms > budget ${budget.ttfb}ms`).toBeLessThan(budget.ttfb);
      expect(avgDom,  `DOM avg ${avgDom}ms > budget ${budget.dom}ms`).toBeLessThan(budget.dom);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// 6. SERVICE WORKER / PWA RESILIENCE
// ══════════════════════════════════════════════════════════════════════════

test.describe("Stress — SW resilience", () => {
  test("page recovers after SW is bypassed (hard reload)", async ({ page }) => {
    await login(page, "admin");

    // Force hard reload bypassing SW cache
    await page.evaluate(() => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations().then((regs) =>
          regs.forEach((r) => r.unregister())
        );
      }
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    // Should still show the dashboard (session cookie persists)
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("login page renders correctly in offline-like scenario (no SW)", async ({ browser }) => {
    const ctx  = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel(/e-mail ou matrícula/i)).toBeVisible();
    await ctx.close();
  });
});
