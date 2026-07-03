/**
 * AS -- Armeiro Saidas (/reserva/saidas)
 *
 * Harness: AS01-AS25
 * DoD: 07-canonical-definition-of-done.md
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

const T = { page: 15_000, api: 8_000 };
const ROUTE = "/reserva/saidas";

test.describe("AS -- Armeiro Saidas", () => {

  // PAGINACAO
  test("AS01 -- carga inicial mostra ate 10 grupos", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const groups = page.locator("[data-testid='saidas-group']");
    await groups.first().waitFor({ timeout: T.page }).catch(() => {});
    const count = await groups.count();
    expect(count).toBeLessThanOrEqual(10);
  });

  test("AS02 -- btn-ver-mais visivel quando ha mais de 10 registros", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    const groups = page.locator("[data-testid='saidas-group']");
    const count = await groups.count().catch(() => 0);
    if (count >= 10) {
      await expect(btn).toBeVisible({ timeout: T.api });
    }
  });

  test("AS03 -- dropdown mostra opcoes 20 e 30 registros", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais' -- menos de 10 grupos");
      return;
    }
    await btn.click();
    await expect(page.getByTestId("btn-limit-20")).toBeVisible({ timeout: T.api });
    await expect(page.getByTestId("btn-limit-30")).toBeVisible({ timeout: T.api });
  });

  test("AS04 -- selecionar 20 -> navega ?limit=20 -> ate 20 grupos", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'");
      return;
    }
    await btn.click();
    await page.getByTestId("btn-limit-20").click();
    await page.waitForURL(/limit=20/, { timeout: T.page });
    await page.waitForTimeout(1000);
    const groups = page.locator("[data-testid='saidas-group']");
    expect(await groups.count()).toBeLessThanOrEqual(20);
  });

  test("AS05 -- filtro de status preservado ao expandir limite", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}?status=ativo`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais' com filtro ativo");
      return;
    }
    await btn.click();
    if (await page.getByTestId("btn-limit-20").isVisible({ timeout: 2_000 }).catch(() => false)) {
      await page.getByTestId("btn-limit-20").click();
      await page.waitForURL(/limit=20/, { timeout: T.page });
      expect(page.url()).toContain("status=ativo");
    }
  });

  // FILTROS
  test("AS06 -- aba Ativas -> URL contem status=ativo", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Ativas" }).click();
    await page.waitForURL(/status=ativo/, { timeout: T.page });
    expect(page.url()).toContain("status=ativo");
  });

  test("AS07 -- aba Devolvidas -> URL contem status=devolvido", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Devolvidas" }).click();
    await page.waitForURL(/status=devolvido/, { timeout: T.page });
    expect(page.url()).toContain("status=devolvido");
  });

  test("AS08 -- busca sem resultado -> 0 grupos", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const input = page.locator("input[placeholder*='Buscar']");
    await input.fill("xxxxxxxxxxx_sem_resultado_possivel");
    await page.waitForTimeout(400);
    const groups = page.locator("[data-testid='saidas-group']");
    expect(await groups.count()).toBe(0);
  });

  test("AS09 -- filtro de data futura -> 0 grupos", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const dateFrom = page.locator("input[type='date']").first();
    await dateFrom.fill("2099-01-01");
    await page.waitForTimeout(400);
    const groups = page.locator("[data-testid='saidas-group']");
    expect(await groups.count()).toBe(0);
  });

  test("AS10 -- aba Todas -> URL sem status= na query", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}?status=ativo`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Todas" }).click();
    await page.waitForURL(/\/reserva\/saidas$/, { timeout: T.page });
    expect(page.url()).not.toContain("status=");
  });

  // TOGGLE + GROUPCARD
  test("AS11 -- icones LayoutGrid e Table2 presentes", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("button[title='Ver em cards agrupados']")).toBeVisible({ timeout: T.page });
    await expect(page.locator("button[title='Ver em grade']")).toBeVisible({ timeout: T.page });
  });

  test("AS12 -- modo tabela mostra thead ao clicar toggle", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.locator("button[title='Ver em grade']").click();
    await expect(page.locator("thead")).toBeVisible({ timeout: T.api });
  });

  test("AS13 -- GroupCard exibe hora no formato HH:MM", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const groups = page.locator("[data-testid='saidas-group']");
    if (await groups.count() === 0) {
      test.skip(true, "Sem grupos para verificar");
      return;
    }
    const headerText = await groups.first().locator("p").nth(1).textContent() ?? "";
    expect(headerText).toMatch(/\d{2}:\d{2}/);
  });

  test("AS14 -- botao Receber em grupo abre modal de desarmamento", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}?status=ativo`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const receber = page.locator("button", { hasText: "Receber" }).first();
    if (!await receber.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem grupos ativos para receber");
      return;
    }
    await receber.click();
    await expect(page.locator("[role='dialog']")).toBeVisible({ timeout: T.api });
  });

  test("AS15 -- titulo Saidas de Material visivel", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /sa.das de material/i })).toBeVisible({ timeout: T.page });
  });

  // SELECAO E EXPORTACAO
  test("AS16 -- botao Exportar desabilitado sem selecao", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const btn = page.locator("button:has-text('Exportar')").first();
    await expect(btn).toBeVisible({ timeout: T.page });
    await expect(btn).toBeDisabled();
  });

  test("AS17 -- checkbox de grupo ativa Exportar com contador", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const groups = page.locator("[data-testid='saidas-group']");
    if (await groups.count() === 0) {
      test.skip(true, "Sem grupos");
      return;
    }
    const groupCheckbox = groups.first().locator("input[type='checkbox']").first();
    await groupCheckbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    await expect(btn).toBeEnabled({ timeout: T.api });
    const text = await btn.textContent();
    expect(text).toMatch(/\d+/);
  });

  test("AS18 -- checkbox de item individual ativa Exportar", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const itemCheckbox = page.locator("[data-testid='saidas-item'] input[type='checkbox']").first();
    if (!await itemCheckbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem itens");
      return;
    }
    await itemCheckbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    await expect(btn).toBeEnabled({ timeout: T.api });
  });

  test("AS19 -- desmarcar todos -> Exportar volta a disabled", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const groups = page.locator("[data-testid='saidas-group']");
    if (await groups.count() === 0) {
      test.skip(true, "Sem grupos");
      return;
    }
    const groupCheckbox = groups.first().locator("input[type='checkbox']").first();
    await groupCheckbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    await expect(btn).toBeEnabled({ timeout: T.api });
    await groupCheckbox.uncheck();
    await expect(btn).toBeDisabled({ timeout: T.api });
  });

  test("AS20 -- selecao persiste ao alternar entre cards e tabela", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const groups = page.locator("[data-testid='saidas-group']");
    if (await groups.count() === 0) {
      test.skip(true, "Sem grupos");
      return;
    }
    const groupCheckbox = groups.first().locator("input[type='checkbox']").first();
    await groupCheckbox.check();
    await page.locator("button[title='Ver em grade']").click();
    await expect(page.locator("thead")).toBeVisible({ timeout: T.api });
    const btn = page.locator("button:has-text('Exportar')").first();
    await expect(btn).toBeEnabled({ timeout: T.api });
  });

  // DASHBOARD LINK + TOOLTIPS
  test("AS21 -- card Devolucoes Pendentes visivel no dashboard /reserva", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /devolu/i }).first()).toBeVisible({ timeout: T.page });
  });

  test("AS22 -- href do card contem status=ativo nao pendente", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });
    const card = page.getByRole("link", { name: /devolu/i }).first();
    const href = await card.getAttribute("href");
    expect(href).toContain("status=ativo");
    expect(href).not.toContain("status=pendente");
  });

  test("AS23 -- clique no card -> URL tem status=ativo e aba Ativas ativa", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: /devolu/i }).first().click();
    await page.waitForURL(/status=ativo/, { timeout: T.page });
    expect(page.url()).toContain("status=ativo");
    const activeTab = page.getByRole("button", { name: "Ativas" });
    await expect(activeTab).toHaveClass(/bg-primary/, { timeout: T.api });
  });

  test("AS24 -- tooltips CSS presentes nos ActionCards do dashboard", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });
    const tooltips = page.locator(".opacity-0.group-hover\\:opacity-100");
    const count = await tooltips.count();
    expect(count).toBeGreaterThan(0);
  });

  test("AS25 -- dashboard /reserva carrega sem erro 5xx", async ({ page }) => {
    await login(page, "reserva");
    const res = await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

});
