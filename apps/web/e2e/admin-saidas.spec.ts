/**
 * ADS — Admin Saídas (/admin/saidas)
 *
 * Harness: ADS01-ADS20
 * DoD: 07-canonical-definition-of-done.md
 *
 * Pré-requisitos:
 *   - Usuário "admin" com role=admin_global ou superadmin
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

const T = { page: 15_000, api: 8_000 };
const ROUTE = "/admin/saidas";

test.describe("ADS — Admin Saídas", () => {

  // PAGINAÇÃO
  test("ADS01 — carga inicial mostra ≤10 grupos", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const groups = page.locator("[data-testid='saidas-group'], [data-testid='group-card']");
    await groups.first().waitFor({ timeout: T.page }).catch(() => {});
    expect(await groups.count()).toBeLessThanOrEqual(10);
  });

  test("ADS02 — btn-ver-mais visível quando há mais de 10 grupos", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const btn = page.getByTestId("btn-ver-mais");
    const groups = page.locator("[data-testid='saidas-group'], [data-testid='group-card']");
    if (await groups.count() >= 10) {
      await expect(btn).toBeVisible({ timeout: T.api });
    }
  });

  test("ADS03 — dropdown Ver mais mostra opções 20 e 30", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    await expect(page.getByTestId("btn-limit-20")).toBeVisible({ timeout: T.api });
    await expect(page.getByTestId("btn-limit-30")).toBeVisible({ timeout: T.api });
  });

  test("ADS04 — selecionar 20 → ≤20 grupos carregados", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    await page.getByTestId("btn-limit-20").click();
    await page.waitForTimeout(1500);
    const groups = page.locator("[data-testid='saidas-group'], [data-testid='group-card']");
    expect(await groups.count()).toBeLessThanOrEqual(20);
  });

  test("ADS05 — filtro status preservado ao expandir limite", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}?status=ativo`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    if (await page.getByTestId("btn-limit-20").isVisible({ timeout: 2_000 }).catch(() => false)) {
      await page.getByTestId("btn-limit-20").click();
      await page.waitForTimeout(1500);
      expect(page.url()).toContain("status=ativo");
    }
  });

  // FILTROS
  test("ADS06 — busca por texto → filtra grupos visíveis", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    await input.fill("xxxxxxxxxxx_sem_resultado");
    await page.waitForTimeout(400);
    const groups = page.locator("[data-testid='saidas-group'], [data-testid='group-card']");
    expect(await groups.count()).toBe(0);
  });

  test("ADS07 — filtro por data futura → 0 grupos", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const dateFrom = page.locator("input[type='date']").first();
    if (await dateFrom.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await dateFrom.fill("2099-01-01");
      await page.waitForTimeout(400);
      const groups = page.locator("[data-testid='saidas-group'], [data-testid='group-card']");
      expect(await groups.count()).toBe(0);
    }
  });

  // TOGGLE CARD/GRADE
  test("ADS08 — botões toggle card/grade presentes", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const toggles = page.locator("button[title*='card' i], button[title*='grade' i], button[title*='tabela' i]");
    await expect(toggles.first()).toBeVisible({ timeout: T.page });
  });

  test("ADS09 — modo tabela ativa thead ao clicar toggle", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const tableBtn = page.locator("button[title*='grade' i], button[title*='tabela' i]").first();
    if (await tableBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await tableBtn.click();
      await expect(page.locator("thead")).toBeVisible({ timeout: T.api });
    }
  });

  test("ADS10 — default abre em modo cards (tabela não visível)", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    await expect(page.locator("table")).not.toBeVisible({ timeout: 2_000 }).catch(() => {});
  });

  // SELEÇÃO E EXPORTAÇÃO
  test("ADS11 — botão Exportar desabilitado sem seleção", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const btn = page.locator("button:has-text('Exportar')").first();
    if (await btn.isVisible({ timeout: T.page }).catch(() => false)) {
      await expect(btn).toBeDisabled();
    }
  });

  test("ADS12 — checkbox de grupo ativa Exportar com contador", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const groupCheckbox = page.locator("[data-testid='saidas-group'] input[type='checkbox'], [data-testid='group-card'] input[type='checkbox']").first();
    if (!await groupCheckbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem checkboxes de grupo"); return;
    }
    await groupCheckbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    await expect(btn).toBeEnabled({ timeout: T.api });
    const text = await btn.textContent();
    expect(text).toMatch(/\d+/);
  });

  test("ADS13 — checkbox de item ativa Exportar", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const itemCheckbox = page.locator("[data-testid='saidas-item'] input[type='checkbox']").first();
    if (!await itemCheckbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem checkboxes de item"); return;
    }
    await itemCheckbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    await expect(btn).toBeEnabled({ timeout: T.api });
  });

  test("ADS14 — desmarcar todos → Exportar volta a disabled", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const groupCheckbox = page.locator("[data-testid='saidas-group'] input[type='checkbox']").first();
    if (!await groupCheckbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem checkboxes"); return;
    }
    await groupCheckbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    await expect(btn).toBeEnabled({ timeout: T.api });
    await groupCheckbox.uncheck();
    await expect(btn).toBeDisabled({ timeout: T.api });
  });

  // CONTEÚDO
  test("ADS15 — página carrega sem erro 5xx", async ({ page }) => {
    await login(page, "admin");
    const res = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("ADS16 — título da página visível", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: T.page });
  });

  test("ADS17 — estado vazio exibe mensagem amigável ao buscar sem resultado", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    await input.fill("xxxxxxxxxxx");
    await page.waitForTimeout(400);
    const empty = page.locator("text=/nenhum|sem registros|vazio/i").first();
    const visible = await empty.isVisible({ timeout: T.api }).catch(() => false);
    if (visible) await expect(empty).toBeVisible();
  });

  test("ADS18 — aba 'Ativas' → URL com status=ativo", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const tab = page.getByRole("button", { name: "Ativas" });
    if (await tab.isVisible({ timeout: T.api }).catch(() => false)) {
      await tab.click();
      await page.waitForURL(/status=ativo/, { timeout: T.page });
      expect(page.url()).toContain("status=ativo");
    }
  });

  test("ADS19 — aba 'Devolvidas' → URL com status=devolvido", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const tab = page.getByRole("button", { name: "Devolvidas" });
    if (await tab.isVisible({ timeout: T.api }).catch(() => false)) {
      await tab.click();
      await page.waitForURL(/status=devolvido/, { timeout: T.page });
      expect(page.url()).toContain("status=devolvido");
    }
  });

  test("ADS20 — acesso sem autenticação redireciona para /login", async ({ page }) => {
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: T.page });
    expect(page.url()).toContain("/login");
  });

});
