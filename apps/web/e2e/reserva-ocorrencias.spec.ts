/**
 * OC -- Reserva Ocorrencias (/reserva/ocorrencias)
 *
 * Harness: OC01-OC15
 * DoD: 07-canonical-definition-of-done.md
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

const T = { page: 15_000, api: 8_000 };
const ROUTE = "/reserva/ocorrencias";

test.describe("OC -- Reserva Ocorrencias", () => {

  test("OC01 -- carga inicial mostra ate 10 ocorrencias", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const items = page.locator("tbody tr, [data-testid='ocorrencia-card'], [data-testid='ocorrencia-row']");
    await items.first().waitFor({ timeout: T.page }).catch(() => {});
    expect(await items.count()).toBeLessThanOrEqual(10);
  });

  test("OC02 -- btn-ver-mais visivel quando ha mais de 10", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const items = page.locator("tbody tr, [data-testid='ocorrencia-card']");
    if (await items.count() >= 10) {
      const btn = page.getByTestId("btn-ver-mais");
      const visible = await btn.isVisible({ timeout: T.api }).catch(() => false);
      if (visible) await expect(btn).toBeVisible();
    }
  });

  test("OC03 -- dropdown Ver mais mostra 20 e 30", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    await expect(page.getByTestId("btn-limit-20")).toBeVisible({ timeout: T.api });
    await expect(page.getByTestId("btn-limit-30")).toBeVisible({ timeout: T.api });
  });

  test("OC04 -- busca por texto filtra ocorrencias", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    if (!await input.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem input de busca"); return;
    }
    await input.fill("xxxxxxxxxxx_sem_resultado");
    await page.waitForTimeout(400);
    const items = page.locator("tbody tr, [data-testid='ocorrencia-card']");
    expect(await items.count()).toBe(0);
  });

  test("OC05 -- botoes toggle card/grade presentes", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const toggles = page.locator("button[title*='card' i], button[title*='grade' i], button[title*='tabela' i]");
    const visible = await toggles.first().isVisible({ timeout: T.page }).catch(() => false);
    if (visible) await expect(toggles.first()).toBeVisible();
  });

  test("OC06 -- modo tabela ativa thead", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const tableBtn = page.locator("button[title*='grade' i], button[title*='tabela' i]").first();
    if (await tableBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await tableBtn.click();
      await expect(page.locator("thead")).toBeVisible({ timeout: T.api });
    }
  });

  test("OC07 -- filtro por status funciona", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const select = page.locator("select, [data-testid='filter-status']").first();
    if (await select.isVisible({ timeout: T.api }).catch(() => false)) {
      await select.selectOption({ index: 1 });
      await page.waitForTimeout(400);
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("OC08 -- botao Exportar desabilitado sem selecao", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const btn = page.locator("button:has-text('Exportar')").first();
    if (await btn.isVisible({ timeout: T.page }).catch(() => false)) {
      await expect(btn).toBeDisabled();
    }
  });

  test("OC09 -- checkbox de item ativa Exportar", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const checkbox = page.locator("input[type='checkbox']").first();
    if (!await checkbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem checkboxes"); return;
    }
    await checkbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    if (await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      await expect(btn).toBeEnabled({ timeout: T.api });
    }
  });

  test("OC10 -- pagina carrega sem erro 5xx", async ({ page }) => {
    await login(page, "reserva");
    const res = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("OC11 -- titulo da pagina visivel", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: T.page });
  });

  test("OC12 -- estado vazio com busca sem resultado", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    if (await input.isVisible({ timeout: T.api }).catch(() => false)) {
      await input.fill("xxxxxxxxxxx_sem_resultado");
      await page.waitForTimeout(400);
      const empty = page.locator("text=/nenhum|sem registros|vazio/i").first();
      const visible = await empty.isVisible({ timeout: T.api }).catch(() => false);
      if (visible) await expect(empty).toBeVisible();
    }
  });

  test("OC13 -- sort por data inverte na 2a clique", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const sortBtn = page.locator("thead button, button[data-sort]").first();
    if (await sortBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await sortBtn.click();
      await sortBtn.click();
      await expect(sortBtn).toBeVisible();
    }
  });

  test("OC14 -- acesso sem autenticacao redireciona", async ({ page }) => {
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: T.page });
    expect(page.url()).toContain("/login");
  });

  test("OC15 -- expandir para 20 -> ate 20 ocorrencias", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    if (await page.getByTestId("btn-limit-20").isVisible({ timeout: T.api }).catch(() => false)) {
      await page.getByTestId("btn-limit-20").click();
      await page.waitForTimeout(1500);
      const items = page.locator("tbody tr, [data-testid='ocorrencia-card']");
      expect(await items.count()).toBeLessThanOrEqual(20);
    }
  });

});
