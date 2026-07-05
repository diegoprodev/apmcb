/**
 * Painel Efetivo v12 — Materiais em uso + botões outline
 *
 * PAINEL-01..08: Agrupamento por movimentação, checkboxes, export, sidebar label
 * BTN-01..02: Outline buttons com bg-white em rotas do efetivo
 *
 * Run:
 *   npx playwright test e2e/painel-materiais.spec.ts --project=painel-materiais
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";

test.describe("PAINEL — Materiais em uso + sidebar label", () => {

  // ── PAINEL-01 ─────────────────────────────────────────────────────────────
  test("PAINEL-01 - sidebar exibe 'Painel' para role usuario", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "networkidle" });
    // Label should be "Painel", NOT "Meus Materiais"
    const sidebar = page.locator('[data-testid^="accordion-toggle-"]').or(page.locator("nav")).first();
    const pageText = await page.content();
    expect(pageText).toContain("Painel");
    expect(pageText).not.toContain("Meus Materiais");
  });

  // ── PAINEL-02 ─────────────────────────────────────────────────────────────
  test("PAINEL-02 - /efetivo carrega sem erro 5xx", async ({ page }) => {
    await login(page, "efetivo");
    const res = await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "networkidle" });
    expect(res?.status()).not.toBe(500);
    expect(res?.status()).not.toBe(404);
    await expect(page).not.toHaveURL(/error/i);
  });

  // ── PAINEL-03 ─────────────────────────────────────────────────────────────
  test("PAINEL-03 - data-testid materiais-uso-ready presente", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("materiais-uso-ready")).toBeVisible({ timeout: 15_000 });
  });

  // ── PAINEL-04 ─────────────────────────────────────────────────────────────
  test("PAINEL-04 - grupos com header armeiro e reserva (se houver dados)", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "networkidle" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const count = await page.getByTestId("materiais-uso-group").count();
    test.skip(count === 0, "Nenhum material em uso — skip PAINEL-04");

    // Group header should show reserva and/or armeiro
    const firstGroup = page.getByTestId("materiais-uso-group").first();
    await expect(firstGroup).toBeVisible();
    // At least one of reserva or armeiro should be in the group header
    const reservaEl = firstGroup.getByTestId("group-reserva");
    const armeiroEl = firstGroup.getByTestId("group-armeiro");
    const reservaCount = await reservaEl.count();
    const armeiroCount = await armeiroEl.count();
    expect(reservaCount + armeiroCount).toBeGreaterThan(0);
  });

  // ── PAINEL-05 ─────────────────────────────────────────────────────────────
  test("PAINEL-05 - botão Exportar PDF desabilitado com 0 selecionados", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "networkidle" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const btn = page.getByTestId("btn-exportar-materiais-pdf");
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  // ── PAINEL-06 ─────────────────────────────────────────────────────────────
  test("PAINEL-06 - selecionar item habilita botão Exportar PDF", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "networkidle" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const count = await page.getByTestId("materiais-uso-item").count();
    test.skip(count === 0, "Nenhum item em uso — skip PAINEL-06");

    await page.getByTestId("materiais-uso-item").first().click();
    const btn = page.getByTestId("btn-exportar-materiais-pdf");
    await expect(btn).toBeEnabled({ timeout: 3_000 });
  });

  // ── PAINEL-07 ─────────────────────────────────────────────────────────────
  test("PAINEL-07 - toggle tabela exibe materiais-uso-table", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "networkidle" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const count = await page.getByTestId("materiais-uso-group").count();
    test.skip(count === 0, "Nenhum material em uso — skip PAINEL-07");

    await page.getByTestId("btn-view-table").click();
    await expect(page.getByTestId("materiais-uso-table")).toBeVisible({ timeout: 3_000 });
  });

  // ── PAINEL-08 ─────────────────────────────────────────────────────────────
  test("PAINEL-08 - busca filtra grupos por nome do material", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "networkidle" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const initialCount = await page.getByTestId("materiais-uso-group").count();
    test.skip(initialCount === 0, "Nenhum material em uso — skip PAINEL-08");

    // Type a string that won't match anything
    await page.getByTestId("input-busca-materiais").fill("xxxxxxxxxxx_nao_existe_material");
    await page.waitForTimeout(300);
    const afterCount = await page.getByTestId("materiais-uso-group").count();
    expect(afterCount).toBe(0);

    // Clear — groups should reappear
    await page.getByTestId("input-busca-materiais").fill("");
    await page.waitForTimeout(300);
    const restoredCount = await page.getByTestId("materiais-uso-group").count();
    expect(restoredCount).toBe(initialCount);
  });

});

test.describe("BTN — Botões outline com bg-white", () => {

  // ── BTN-01 ────────────────────────────────────────────────────────────────
  test("BTN-01 - botão Filtros em /efetivo/historico tem background branco", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/historico`, { waitUntil: "networkidle" });

    const btn = page.getByTestId("btn-filtros");
    await expect(btn).toBeVisible({ timeout: 15_000 });

    const bgColor = await btn.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    // White = rgb(255, 255, 255)
    expect(bgColor).toBe("rgb(255, 255, 255)");
  });

  // ── BTN-02 ────────────────────────────────────────────────────────────────
  test("BTN-02 - botão Exportar PDF inativo em /efetivo/historico tem background branco", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/historico`, { waitUntil: "networkidle" });

    const btn = page.getByTestId("btn-exportar-pdf");
    await expect(btn).toBeVisible({ timeout: 15_000 });

    // When nothing is selected, variant is "outline" → should be white
    const bgColor = await btn.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(bgColor).toBe("rgb(255, 255, 255)");
  });

});
