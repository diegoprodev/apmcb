/**
 * APMCB — Regression Guard Suite
 * Validates that previously-working features continue to work
 * after each development iteration.
 *
 * Run: npx playwright test e2e/regression.spec.ts --reporter=html
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login, waitForDashboard } from "./helpers";

// ══════════════════════════════════════════════════════════════════════════════
// R1–R4: Admin Dashboard
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Regressão — Admin Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await waitForDashboard(page);
  });

  test("R1 — 4 KPI cards numéricos (não '—') presentes", async ({ page }) => {
    const cards = page.locator(".text-2xl.font-bold");
    await expect(cards.first()).toBeVisible({ timeout: 8000 });
    const values = await cards.allTextContents();
    expect(
      values.length,
      "Fewer than 4 KPI cards found"
    ).toBeGreaterThanOrEqual(4);
    const dashes = values.filter((v) => v.trim() === "—");
    expect(
      dashes,
      `KPI cards still showing '—': ${JSON.stringify(dashes)}`
    ).toHaveLength(0);
  });

  test("R2 — card Total de Militares presente", async ({ page }) => {
    await expect(page.getByText(/Total de Militares/i)).toBeVisible();
  });

  test("R3 — card Materiais em Uso presente", async ({ page }) => {
    await expect(page.getByText(/Materiais em Uso/i)).toBeVisible();
  });

  test("R4 — card Cadastros Pendentes presente", async ({ page }) => {
    await expect(page.getByText(/Cadastros Pendentes/i)).toBeVisible();
  });

  test("R5 — chart Recharts renderiza no dashboard", async ({ page }) => {
    // Recharts injects .recharts-wrapper — check for it with a generous timeout
    const chart = page
      .locator(".recharts-wrapper")
      .or(page.locator('[class*="recharts"]'));
    await expect(chart.first()).toBeVisible({ timeout: 8000 });
  });

  test("R6 — sidebar exibe 5 links de navegação", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /dashboard/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /usuários/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /arsenal/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /relatórios/i })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /auditoria/i })
    ).toBeVisible();
  });

  test("R7 — link ativo no sidebar usa classe text-primary", async ({
    page,
  }) => {
    const dashLink = page.locator('aside nav a[href="/admin"]');
    await expect(dashLink).toBeVisible({ timeout: 5000 });
    const cls = await dashLink.getAttribute("class");
    expect(cls).toMatch(/text-primary/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// R8–R10: Admin Tabelas
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Regressão — Admin Tabelas", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  test("R8 — tabela de usuários filtrável carrega", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "networkidle" });
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 8000 });
  });

  test("R9 — arsenal exibe tabela de materiais", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/arsenal`, { waitUntil: "networkidle" });
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 8000 });
  });

  test("R10 — auditoria exibe tabela de eventos", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/auditoria`, {
      waitUntil: "networkidle",
    });
    const table = page
      .locator("table")
      .or(page.locator('[role="table"]'));
    await expect(table.first()).toBeVisible({ timeout: 8000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// R11–R14: Armeiro
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Regressão — Armeiro", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "armeiro");
    await waitForDashboard(page);
  });

  test("R11 — painel armeiro exibe action cards", async ({ page }) => {
    await expect(page.getByText(/Identificar Militar/i)).toBeVisible();
    await expect(page.getByText(/Novo Empréstimo/i)).toBeVisible();
    await expect(page.getByText(/Cadastrar Militar/i)).toBeVisible();
    await expect(page.getByText(/Devoluções Pendentes/i)).toBeVisible();
  });

  test("R12 — lista de militares renderiza", async ({ page }) => {
    await page.goto(`${BASE_URL}/armeiro/militares`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: /militares/i })
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator("table").or(page.locator('[role="table"]'))
    ).toBeVisible({ timeout: 8000 });
  });

  test("R13 — lista de empréstimos renderiza", async ({ page }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: /empréstimos|saídas/i })
    ).toBeVisible({ timeout: 8000 });
  });

  test("R14 — armeiro não acessa /admin", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForTimeout(2000);
    expect(page.url()).not.toMatch(/\/admin$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// R15–R16: Cadete
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Regressão — Cadete", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "cadete");
  });

  test("R15 — cadete vai para /registro-pendente", async ({ page }) => {
    await expect(page).toHaveURL(/\/registro-pendente/);
  });

  test("R16 — 3 etapas são exibidas", async ({ page }) => {
    await expect(
      page.getByText(/Dados pessoais preenchidos/i)
    ).toBeVisible();
    await expect(page.getByText(/Conta criada no sistema/i)).toBeVisible();
    await expect(
      page.getByText(/Biometria — pendente com o armeiro/i)
    ).toBeVisible();
  });

  test("R17 — cadete não acessa /admin", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForTimeout(2000);
    expect(page.url()).not.toMatch(/\/admin$/);
  });

  test("R18 — cadete não acessa /armeiro", async ({ page }) => {
    await page.goto(`${BASE_URL}/armeiro`);
    await page.waitForTimeout(2000);
    expect(page.url()).not.toMatch(/\/armeiro$/);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// R19–R21: Relatórios
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Regressão — Relatórios filtros", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/relatorios`, {
      waitUntil: "networkidle",
    });
  });

  test("R19 — heading de relatórios presente", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /relatório|relatórios/i })
    ).toBeVisible({ timeout: 8000 });
  });

  test("R20 — botões de exportação CSV e PDF presentes", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /csv/i })
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.getByRole("button", { name: /pdf/i })
    ).toBeVisible({ timeout: 8000 });
  });

  test("R21 — filtros avançados abrem ao clicar", async ({ page }) => {
    const advancedBtn = page
      .getByRole("button", { name: /filtros avançados/i })
      .or(page.getByRole("button", { name: /mais filtros/i }));

    if (await advancedBtn.first().isVisible()) {
      await advancedBtn.first().click();
      // After opening, at least one filter label appears
      await expect(
        page.getByText(/material|militar|status/i).first()
      ).toBeVisible({ timeout: 5000 });
    }
  });

  test("R22 — botão Limpar reseta filtros e limpa URL params", async ({
    page,
  }) => {
    // Navigate with a filter in the URL
    await page.goto(`${BASE_URL}/admin/relatorios?status=ativo`, {
      waitUntil: "networkidle",
    });

    const clearBtn = page.getByRole("button", { name: /limpar/i });
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
      await expect(page).toHaveURL(/\/admin\/relatorios$/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// R23–R24: Notificações & Header
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Regressão — Notificações e Header", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await waitForDashboard(page);
  });

  test("R23 — header visível no dashboard", async ({ page }) => {
    await expect(page.locator("header")).toBeVisible();
  });

  test("R24 — toggle de tema alterna classe dark no <html>", async ({
    page,
  }) => {
    const htmlEl = page.locator("html");
    const before = await htmlEl.getAttribute("class");

    await page.getByRole("button", { name: /alternar tema/i }).click();
    await page.waitForTimeout(300);

    const after = await htmlEl.getAttribute("class");
    expect(before).not.toBe(after);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// R25: Mobile responsive
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Regressão — Mobile 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("R25 — bottom nav visível após login como admin em mobile", async ({
    page,
  }) => {
    await login(page, "admin");
    await waitForDashboard(page);
    await expect(
      page.locator('[data-testid="bottom-nav"]')
    ).toBeVisible({ timeout: 8000 });
  });

  test("R26 — sidebar (aside) oculto em mobile", async ({ page }) => {
    await login(page, "admin");
    await waitForDashboard(page);
    const aside = page.locator("aside");
    const cnt = await aside.count();
    if (cnt > 0) {
      await expect(aside).not.toBeVisible();
    }
  });

  test("R27 — login sem overflow horizontal (body.scrollWidth <= 390)", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    expect(
      bodyWidth,
      `body.scrollWidth=${bodyWidth}px exceeds viewport 390px`
    ).toBeLessThanOrEqual(390);
  });
});
