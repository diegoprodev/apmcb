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

// base-ui Tooltip.Popup usa data-slot="tooltip-content" (não necessariamente role=tooltip)
const TOOLTIP_SELECTOR = '[data-slot="tooltip-content"]';
// Delay configurado no TooltipProvider (300ms) + margem de animação
const TOOLTIP_APPEAR_MS = 800;

test.describe("SDB — Sidebar hamburger e tooltips", () => {

  // ── SDB-01 ────────────────────────────────────────────────────────────────
  test("SDB-01 - hamburger md:hidden não visível em desktop (1440px)", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    // O botão hamburger mobile tem aria-label="Abrir menu" e className="md:hidden"
    const hamburger = page.locator('button[aria-label="Abrir menu"]');
    await expect(hamburger).toHaveCount(1);
    // Em viewport 1440px com md:hidden, deve ser invisível (display:none)
    await expect(hamburger).toBeHidden();
  });

  // ── SDB-02 ────────────────────────────────────────────────────────────────
  test("SDB-02 - botão btn-sidebar-toggle (chevron) visível no desktop", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    await expect(page.getByTestId("btn-sidebar-toggle")).toBeVisible({ timeout: 10_000 });
  });

  // ── SDB-03 ────────────────────────────────────────────────────────────────
  test("SDB-03 - tooltip do chevron mostra 'Fechar menu lateral' quando sidebar aberto", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    const toggle = page.getByTestId("btn-sidebar-toggle");
    await toggle.hover();
    // Aguarda delay do TooltipProvider (300ms) + margem de animação
    await page.waitForTimeout(TOOLTIP_APPEAR_MS);

    // base-ui tooltip: usa data-slot="tooltip-content"
    const tooltip = page.locator(TOOLTIP_SELECTOR);
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    await expect(tooltip).toContainText("Fechar menu lateral");
  });

  // ── SDB-04 ────────────────────────────────────────────────────────────────
  test("SDB-04 - clicar chevron colapsa sidebar e tooltip muda para 'Abrir menu lateral'", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    const toggle = page.getByTestId("btn-sidebar-toggle");
    await toggle.click();

    // Aguarda sidebar colapsar (w-16)
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-16/, { timeout: 3_000 });

    // Hover no chevron após colapso
    await toggle.hover();
    await page.waitForTimeout(TOOLTIP_APPEAR_MS);

    const tooltip = page.locator(TOOLTIP_SELECTOR);
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    await expect(tooltip).toContainText("Abrir menu lateral");
  });

  // ── SDB-05 ────────────────────────────────────────────────────────────────
  test("SDB-05 - sidebar colapsado: hover em ícone exibe tooltip com nome da página", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    // Colapsar sidebar
    await page.getByTestId("btn-sidebar-toggle").click();
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-16/, { timeout: 3_000 });

    // Hover no primeiro link de navegação (excluindo o chevron/toggle)
    const navLinks = sidebar.locator("nav a");
    const count = await navLinks.count();
    test.skip(count === 0, "Nenhum link de nav encontrado no sidebar colapsado");

    // Move mouse completamente para fora antes de fazer hover no nav link
    await page.mouse.move(800, 400);
    await navLinks.first().hover();
    await page.waitForTimeout(TOOLTIP_APPEAR_MS);

    const tooltip = page.locator(TOOLTIP_SELECTOR);
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    // O tooltip deve ter algum texto (nome da página)
    const text = await tooltip.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  // ── SDB-06 ────────────────────────────────────────────────────────────────
  // Achado de code review (2026-07-22): TooltipTrigger (@base-ui/react) sempre
  // renderiza seu próprio <button> — aninhar <Button>/<Link> dentro dele
  // produzia HTML inválido (<button><button> ou <button><a>) que o parser HTML
  // do browser corrige de um jeito diferente do que o React espera no
  // client, causando erro de hidratação #418 em TODO o dashboard (o Sidebar
  // renderiza na árvore de layout compartilhada). Corrigido via prop `render`
  // do TooltipTrigger. Este teste trava a regressão: reintroduzir o
  // aninhamento antigo (ou um Trigger novo com o mesmo antipadrão) gera
  // console.error mesmo que a interação visual continue parecendo normal.
  test("SDB-06 (regressão) - zero erros de console ao carregar e colapsar o sidebar", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });
    await page.waitForTimeout(500);

    // Colapsa o sidebar — monta os TooltipTrigger com render={<Link>} pela
    // primeira vez (caminho não exercido pelo estado inicial expandido).
    await page.getByTestId("btn-sidebar-toggle").click();
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-16/, { timeout: 3_000 });
    await page.waitForTimeout(500);

    const relevantErrors = consoleErrors.filter((e) => !e.includes("preload"));
    expect(relevantErrors, `Erros de console: ${relevantErrors.join(" | ")}`).toHaveLength(0);
  });

});
