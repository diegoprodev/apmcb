/**
 * Sidebar Navigation v13
 *
 * SDB-01..05: Hamburger mobile-only + tooltips no sidebar colapsado
 *
 * Run:
 *   npx playwright test e2e/sidebar-nav.spec.ts --project=sidebar-nav
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";

test.describe("SDB — Sidebar hamburger e tooltips", () => {

  // ── SDB-01 ────────────────────────────────────────────────────────────────
  test("SDB-01 - hamburger md:hidden não visível em desktop (1440px)", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "networkidle" });

    // O botão hamburger mobile tem aria-label="Abrir menu" e className="md:hidden"
    const hamburger = page.locator('button[aria-label="Abrir menu"]');
    await expect(hamburger).toHaveCount(1);
    // Em viewport 1440px com md:hidden, deve ser invisível (display:none)
    await expect(hamburger).toBeHidden();
  });

  // ── SDB-02 ────────────────────────────────────────────────────────────────
  test("SDB-02 - botão btn-sidebar-toggle (chevron) visível no desktop", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "networkidle" });

    await expect(page.getByTestId("btn-sidebar-toggle")).toBeVisible({ timeout: 10_000 });
  });

  // ── SDB-03 ────────────────────────────────────────────────────────────────
  test("SDB-03 - tooltip do chevron mostra 'Fechar menu lateral' quando sidebar aberto", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "networkidle" });

    const toggle = page.getByTestId("btn-sidebar-toggle");
    await toggle.hover();

    // Tooltip aparece via role=tooltip
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    await expect(tooltip).toContainText("Fechar menu lateral");
  });

  // ── SDB-04 ────────────────────────────────────────────────────────────────
  test("SDB-04 - clicar chevron colapsa sidebar e tooltip muda para 'Abrir menu lateral'", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "networkidle" });

    const toggle = page.getByTestId("btn-sidebar-toggle");
    await toggle.click();

    // Aguarda sidebar colapsar (w-16)
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-16/, { timeout: 3_000 });

    // Hover no chevron após colapso
    await toggle.hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    await expect(tooltip).toContainText("Abrir menu lateral");
  });

  // ── SDB-05 ────────────────────────────────────────────────────────────────
  test("SDB-05 - sidebar colapsado: hover em ícone exibe tooltip com nome da página", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "networkidle" });

    // Colapsar sidebar
    await page.getByTestId("btn-sidebar-toggle").click();
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-16/, { timeout: 3_000 });

    // Hover no primeiro link de navegação (excluindo o chevron)
    const navLinks = sidebar.locator("nav a");
    const count = await navLinks.count();
    test.skip(count === 0, "Nenhum link de nav encontrado no sidebar colapsado");

    await navLinks.first().hover();
    const tooltip = page.getByRole("tooltip");
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    // O tooltip deve ter algum texto (nome da página)
    const text = await tooltip.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

});
