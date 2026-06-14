/**
 * APMCB — Stress & Concurrency Test Harness
 * Quantitative and qualitative load scenarios.
 *
 * Run: npx playwright test e2e/stress.spec.ts --reporter=html --workers=4
 *
 * Scenarios:
 *   A — Login Storm (10 parallel)
 *   B — 5 concurrent admin dashboards
 *   C — BFF rate limit (65 requests → 429)
 *   D — Arsenal TTI under load
 *   E — Full armeiro end-to-end flow
 *   F — Cross-role data consistency
 *   G — Session resilience after inactivity
 *   H — Dark mode persists across navigation
 *   I — BFF /health sequential load
 *   J — Login/logout cycle (3×)
 *   K — Rapid navigation (admin + armeiro)
 *   L — Performance regression budgets
 *   M — SW resilience (hard reload)
 */

import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  BFF_URL,
  login,
  logout,
  waitForDashboard,
  collectPerf,
  type PerfSnapshot,
  USERS,
} from "./harness";

// ─── SLA thresholds ──────────────────────────────────────────────────────────

const SLA = {
  loginStormMs:        60_000,   // 10 parallel logins total
  concurrentDashMs:    30_000,   // 5 concurrent dashboards
  arsenalTtiMs:         5_000,
  bffHealthSeqMs:      10_000,   // 20 sequential /health
  bffP95Ms:               800,
  navigationMs:         3_000,
  sessionCycleMs:      60_000,   // 3 login/logout cycles
} as const;

// ══════════════════════════════════════════════════════════════════════════════
// A — Login Storm: 10 logins paralelos
// ══════════════════════════════════════════════════════════════════════════════

test("A — Login Storm: 10 logins paralelos completam em < 60s", async ({ browser }) => {
  test.setTimeout(120_000);

  const userKeys = [
    "admin", "armeiro", "admin", "armeiro", "admin",
    "armeiro", "admin", "armeiro", "admin", "armeiro",
  ] as const;

  const start = Date.now();

  await Promise.all(
    userKeys.map(async (key, i) => {
      const ctx  = await browser.newContext();
      const page = await ctx.newPage();
      try {
        await login(page, key);
        await waitForDashboard(page);
        console.log(`[A] session ${i + 1} (${key}) ready`);
      } finally {
        await ctx.close();
      }
    })
  );

  const elapsed = Date.now() - start;
  console.log(`[A] Login Storm total: ${elapsed}ms for 10 parallel logins`);
  expect(elapsed, `Login storm took ${elapsed}ms — expected < ${SLA.loginStormMs}ms`).toBeLessThan(
    SLA.loginStormMs
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// B — Dashboard concorrente: 5 sessões admin simultâneas
// ══════════════════════════════════════════════════════════════════════════════

test("B — Dashboard concorrente: 5 sessões admin em < 30s", async ({ browser }) => {
  test.setTimeout(120_000);

  const contexts = await Promise.all(
    Array.from({ length: 5 }, () => browser.newContext())
  );

  const start = Date.now();
  try {
    await Promise.all(
      contexts.map(async (ctx, i) => {
        const page = await ctx.newPage();
        await login(page, "admin");
        await waitForDashboard(page);
        await expect(page.getByText(/Total de Militares/i)).toBeVisible({ timeout: 10_000 });
        console.log(`[B] admin dashboard ${i + 1} rendered`);
      })
    );

    const elapsed = Date.now() - start;
    console.log(`[B] 5 concurrent admin dashboards: ${elapsed}ms`);
    expect(
      elapsed,
      `Concurrent dashboards took ${elapsed}ms — expected < ${SLA.concurrentDashMs}ms`
    ).toBeLessThan(SLA.concurrentDashMs);
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// C — BFF Rate Limit: 65 requests → 429
// ══════════════════════════════════════════════════════════════════════════════

test("C — BFF rate limit: 65 requests a /api/auth/me disparam 429", async ({ request }) => {
  test.setTimeout(60_000);

  const statuses = await Promise.all(
    Array.from({ length: 65 }, () =>
      request
        .get(`${BFF_URL}/api/auth/me`)
        .then((r) => r.status())
        .catch(() => 0)
    )
  );

  const countByStatus = statuses.reduce<Record<number, number>>((acc, s) => {
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  console.log("[C] Rate limit distribution:", JSON.stringify(countByStatus));

  const has429 = statuses.some((s) => s === 429);
  expect(
    has429,
    `No 429 seen after 65 requests. Distribution: ${JSON.stringify(countByStatus)}`
  ).toBe(true);
});

// ══════════════════════════════════════════════════════════════════════════════
// D — Arsenal TTI < 5s com dados reais
// ══════════════════════════════════════════════════════════════════════════════

test("D — Arsenal TTI < 5s com dados reais", async ({ page }) => {
  test.setTimeout(60_000);

  await login(page, "admin");

  const start = Date.now();
  await page.goto(`${BASE_URL}/admin/arsenal`, { waitUntil: "networkidle" });
  await page.waitForSelector("table", { timeout: 8_000 });
  const elapsed = Date.now() - start;

  console.log(`[D] Arsenal TTI: ${elapsed}ms`);
  expect(elapsed, `Arsenal TTI=${elapsed}ms exceeded ${SLA.arsenalTtiMs}ms`).toBeLessThan(
    SLA.arsenalTtiMs
  );
});

// ══════════════════════════════════════════════════════════════════════════════
// E — Fluxo completo armeiro end-to-end
// ══════════════════════════════════════════════════════════════════════════════

test("E — Fluxo completo armeiro end-to-end", async ({ page }) => {
  test.setTimeout(60_000);

  // 1. Login
  await login(page, "armeiro");
  await waitForDashboard(page);
  console.log("[E] armeiro logado");

  // 2. Lista de militares
  await page.goto(`${BASE_URL}/armeiro/militares`, { waitUntil: "networkidle" });
  await expect(
    page.locator("table").or(page.locator('[role="table"]'))
  ).toBeVisible({ timeout: 8_000 });
  console.log("[E] lista de militares carregada");

  // 3. Lista de empréstimos (se existir)
  const empRes = await page.goto(`${BASE_URL}/armeiro/saidas`, {
    waitUntil: "networkidle",
  });
  if (empRes?.status() !== 404) {
    await expect(
      page.locator("table").or(page.locator('[role="table"]'))
    ).toBeVisible({ timeout: 8_000 });
    console.log("[E] lista de saídas carregada");
  } else {
    console.log("[E] /armeiro/saidas → 404, pulando");
  }

  // 4. Logout
  await logout(page);
  await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
  console.log("[E] logout bem-sucedido");
});

// ══════════════════════════════════════════════════════════════════════════════
// F — Consistência de dados entre roles
// ══════════════════════════════════════════════════════════════════════════════

test("F — Consistência de dados: admin vê arsenal com >= 1 item", async ({ browser }) => {
  test.setTimeout(60_000);

  const ctx  = await browser.newContext();
  const page = await ctx.newPage();

  try {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/arsenal`, { waitUntil: "networkidle" });
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 8_000 });
    const count = await rows.count();
    console.log(`[F] Arsenal rows visible to admin: ${count}`);
    expect(count, "Admin should see at least 1 arsenal row").toBeGreaterThanOrEqual(1);
  } finally {
    await ctx.close();
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// G — Resiliência de sessão após inatividade
// ══════════════════════════════════════════════════════════════════════════════

test("G — Resiliência de sessão: navegação válida após 5s de inatividade", async ({ page }) => {
  test.setTimeout(60_000);

  await login(page, "admin");
  await waitForDashboard(page);

  // Simulate brief inactivity
  await page.waitForTimeout(5_000);

  // Navigate — must NOT be redirected to /login
  await page.goto(`${BASE_URL}/admin/arsenal`, { waitUntil: "networkidle" });
  await expect(page).not.toHaveURL(/\/login/);
  await expect(
    page.locator("table").or(page.locator('[role="table"]'))
  ).toBeVisible({ timeout: 8_000 });
  console.log("[G] Session valid after 5s inactivity");
});

// ══════════════════════════════════════════════════════════════════════════════
// H — Dark mode persiste na navegação entre páginas
// ══════════════════════════════════════════════════════════════════════════════

test("H — Dark mode persiste sem flash em navegação", async ({ page }) => {
  test.setTimeout(60_000);

  await login(page, "admin");
  await waitForDashboard(page);

  // Enable dark mode
  await page.getByRole("button", { name: /alternar tema/i }).click();
  await page.waitForTimeout(500);

  let htmlClass = await page.locator("html").getAttribute("class");
  expect(htmlClass, "Dark mode não ativou após clicar no toggle").toContain("dark");

  // Navigate between pages and verify dark class persists
  const routes = ["/admin/usuarios", "/admin/arsenal", "/admin/auditoria"];
  for (const route of routes) {
    await page.goto(`${BASE_URL}${route}`, { waitUntil: "networkidle" });
    htmlClass = await page.locator("html").getAttribute("class");
    expect(htmlClass, `Dark class perdida em ${route}`).toContain("dark");
    console.log(`[H] Dark mode persistido em ${route}`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// I — BFF /health: 20 requests sequenciais < 10s
// ══════════════════════════════════════════════════════════════════════════════

test("I — BFF /health: 20 requests sequenciais < 10s", async ({ request }) => {
  test.setTimeout(30_000);

  const start   = Date.now();
  const results: number[] = [];

  for (let i = 0; i < 20; i++) {
    const res = await request.get(`${BFF_URL}/health`);
    results.push(res.status());
  }

  const elapsed = Date.now() - start;
  const allOk   = results.every((s) => s === 200);

  console.log(`[I] 20 sequential /health: ${elapsed}ms, all 200=${allOk}`);

  expect(allOk, `Some /health requests failed: ${JSON.stringify(results)}`).toBe(true);
  expect(elapsed, `Sequential /health took ${elapsed}ms`).toBeLessThan(SLA.bffHealthSeqMs);
});

// ══════════════════════════════════════════════════════════════════════════════
// J — Login/logout cycle: 3 ciclos consecutivos
// ══════════════════════════════════════════════════════════════════════════════

test("J — Login/logout: 3 ciclos consecutivos admin", async ({ page }) => {
  test.setTimeout(120_000);

  for (let i = 0; i < 3; i++) {
    await login(page, "admin");
    await waitForDashboard(page);
    await expect(page.getByText(/Total de Militares/i)).toBeVisible({ timeout: 8_000 });
    await logout(page);
    await expect(page).toHaveURL(/\/login/, { timeout: 8_000 });
    console.log(`[J] Login/logout cycle ${i + 1} completed`);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// K — Rapid navigation without console errors
// ══════════════════════════════════════════════════════════════════════════════

test("K — Admin: navegação rápida por todas as rotas sem erros de console", async ({ page }) => {
  test.setTimeout(60_000);

  await login(page, "admin");

  const routes = [
    "/admin",
    "/admin/usuarios",
    "/admin/arsenal",
    "/admin/relatorios",
    "/admin/auditoria",
  ];

  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  for (let round = 0; round < 2; round++) {
    for (const route of routes) {
      const t0 = Date.now();
      await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
      const elapsed = Date.now() - t0;
      console.log(`[K] ${route}: ${elapsed}ms`);
    }
  }

  const realErrors = errors.filter((e) => !e.includes("preload") && !e.includes("404"));
  expect(realErrors, `Console errors: ${realErrors.join(" | ")}`).toHaveLength(0);
});

// ══════════════════════════════════════════════════════════════════════════════
// L — Performance regression budgets (avg of 3 samples)
// ══════════════════════════════════════════════════════════════════════════════

test.describe("L — Performance regression budgets", () => {
  const PERF_BUDGET: Record<string, { ttfb: number; dom: number; role?: "admin" | "armeiro" | "cadete" }> = {
    "/login":             { ttfb: 600,  dom: 2500 },
    "/admin":             { ttfb: 1000, dom: 4000, role: "admin"   },
    "/armeiro":           { ttfb: 1000, dom: 4000, role: "armeiro" },
    "/registro-pendente": { ttfb: 800,  dom: 3000, role: "cadete"  },
  };

  for (const [route, budget] of Object.entries(PERF_BUDGET)) {
    test(`${route} — TTFB < ${budget.ttfb}ms, DOM < ${budget.dom}ms`, async ({ page }) => {
      test.setTimeout(60_000);

      const snapshots: PerfSnapshot[] = [];

      for (let i = 0; i < 3; i++) {
        if (route === "/login") {
          await page.goto(`${BASE_URL}${route}`, { waitUntil: "domcontentloaded" });
        } else {
          await login(page, budget.role!);
        }
        snapshots.push(await collectPerf(page));
        // Reset to login before next sample
        if (route !== "/login") {
          await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
        }
      }

      const avgTtfb = Math.round(snapshots.reduce((s, p) => s + p.ttfb, 0) / snapshots.length);
      const avgDom  = Math.round(snapshots.reduce((s, p) => s + p.domLoad, 0) / snapshots.length);

      console.log(`[L] ${route} — TTFB avg: ${avgTtfb}ms  DOM avg: ${avgDom}ms`);

      expect(avgTtfb, `TTFB avg ${avgTtfb}ms > budget ${budget.ttfb}ms`).toBeLessThan(budget.ttfb);
      expect(avgDom,  `DOM avg ${avgDom}ms > budget ${budget.dom}ms`).toBeLessThan(budget.dom);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// M — Service Worker resilience
// ══════════════════════════════════════════════════════════════════════════════

test.describe("M — SW resilience", () => {
  test("M1 — página recupera após SW unregister + hard reload", async ({ page }) => {
    test.setTimeout(60_000);

    await login(page, "admin");

    await page.evaluate(() => {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistrations()
          .then((regs) => regs.forEach((r) => r.unregister()));
      }
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    // Session cookie persists; must not redirect to login
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("M2 — login page renderiza sem SW (service workers bloqueados)", async ({ browser }) => {
    const ctx  = await browser.newContext({ serviceWorkers: "block" });
    const page = await ctx.newPage();
    try {
      await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
      await expect(page.getByLabel(/e-mail ou matrícula/i)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("M3 — mixed-role sessions simultâneas (admin + armeiro + cadete)", async ({ browser }) => {
    test.setTimeout(60_000);

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
    expect(results.every(Boolean), "One or more role sessions failed").toBe(true);
    console.log(`[M3] All ${userKeys.length} roles logged in successfully`);
  });
});
