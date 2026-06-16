/**
 * APMCB — Smoke Test Suite
 * Critical path validation: auth, page loads, basic CRUD affordances.
 * Target: < 2 minutes wall-clock on a single worker.
 *
 * Run: npx playwright test e2e/smoke.spec.ts --reporter=list
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, BFF_URL, login, USERS } from "./helpers";

// ══════════════════════════════════════════════════════════════════════════════
// Infraestrutura
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Smoke — Infraestrutura", () => {
  test("login page retorna 200", async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/login`, { waitUntil: "load" });
    expect(res?.status()).toBe(200);
  });

  test("login page renderiza formulário", async ({ page }) => {
    await page.goto(`${BASE_URL}/login`);
    await expect(
      page.getByLabel(/e-mail ou matrícula/i)
    ).toBeVisible({ timeout: 8000 });
  });

  test("BFF /health responde 200", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/health`);
    expect(res.status()).toBe(200);
  });

  test("BFF /health body tem ok:true e service correto", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/health`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("apmcb-bff");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Auth por role
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Smoke — Auth por role", () => {
  test("admin: login e redirect para /admin", async ({ page }) => {
    await login(page, "admin");
    await expect(page).toHaveURL(/\/admin/);
  });

  test("Reserva de Armamento: login e redirect para /reserva", async ({ page }) => {
    await login(page, "reserva");
    await expect(page).toHaveURL(/\/reserva/);
  });

  test("cadete ativo: login e redirect para /cadete", async ({ page }) => {
    await login(page, "cadete");
    await expect(page).toHaveURL(/\/cadete/);
  });

  test("unauthenticated /admin redireciona para /login", async ({ page }) => {
    await page.goto(`${BASE_URL}/admin`);
    await page.waitForURL(/\/login/, { timeout: 8000 });
  });

  test("unauthenticated /reserva redireciona para /login", async ({ page }) => {
    await page.goto(`${BASE_URL}/reserva`);
    await page.waitForURL(/\/login/, { timeout: 8000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Páginas sem 404 — admin
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Smoke — Páginas admin carregam", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
  });

  for (const route of [
    "/admin",
    "/admin/usuarios",
    "/admin/arsenal",
    "/admin/auditoria",
    "/admin/relatorios",
  ]) {
    test(`${route} carrega sem redirecionar para /login`, async ({ page }) => {
      const res = await page.goto(`${BASE_URL}${route}`, {
        waitUntil: "load",
      });
      expect(res?.status()).not.toBe(404);
      await expect(page).not.toHaveURL(/\/login/);
      await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 15000 });
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Páginas sem 404 — Reserva de Armamento
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Smoke — Páginas Reserva de Armamento carregam", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "reserva");
  });

  for (const route of [
    "/reserva",
    "/reserva/militares",
    "/reserva/saidas",
  ]) {
    test(`${route} carrega`, async ({ page }) => {
      const res = await page.goto(`${BASE_URL}${route}`, {
        waitUntil: "load",
      });
      expect(res?.status()).not.toBe(404);
      await expect(page).not.toHaveURL(/\/login/);
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Arsenal — affordances básicas
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Smoke — Arsenal CRUD básico", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/arsenal`, { waitUntil: "load" });
  });

  test("botão Adicionar Material visível", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /adicionar material/i })
    ).toBeVisible({ timeout: 8000 });
  });

  test("dialog Adicionar Material abre", async ({ page }) => {
    await page.getByRole("button", { name: /adicionar material/i }).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  });

  test("tabela de materiais tem ao menos 1 linha", async ({ page }) => {
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 8000 });
  });

  test("botões Editar e Remover visíveis na tabela", async ({ page }) => {
    await expect(page.locator("tbody tr").first()).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator('button[title="Editar"]').first()
    ).toBeVisible();
    await expect(
      page.locator('button[title="Remover"]').first()
    ).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Empréstimos — affordances básicas
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Smoke — Empréstimos básico", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "reserva");
  });

  test("lista de empréstimos carrega heading", async ({ page }) => {
    await page.goto(`${BASE_URL}/reserva/saidas`, {
      waitUntil: "load",
    });
    await expect(
      page.getByRole("heading", { name: /empréstimos|saídas/i })
    ).toBeVisible({ timeout: 8000 });
  });

  test("formulário novo empréstimo carrega", async ({ page }) => {
    await page.goto(`${BASE_URL}/reserva/saidas/nova`, {
      waitUntil: "load",
    });
    await expect(
      page.getByRole("heading", { name: /novo empréstimo|nova saída/i })
    ).toBeVisible({ timeout: 8000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Relatórios — affordances básicas
// ══════════════════════════════════════════════════════════════════════════════

test.describe("Smoke — Relatórios", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/relatorios`, { waitUntil: "load" });
  });

  test("heading de relatórios presente", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /relatório|relatórios/i })
    ).toBeVisible({ timeout: 8000 });
  });

  test("botão Aplicar filtros visível", async ({ page }) => {
    const btn = page
      .getByRole("button", { name: /aplicar filtros/i })
      .or(page.getByRole("button", { name: /filtrar/i }));
    await expect(btn.first()).toBeVisible({ timeout: 8000 });
  });

  test("botões de exportação CSV e PDF visíveis", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /csv/i })
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.getByRole("button", { name: /pdf/i })
    ).toBeVisible({ timeout: 8000 });
  });
});
