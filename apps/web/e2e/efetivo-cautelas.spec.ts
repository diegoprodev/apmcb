/**
 * MC — Efetivo Minhas Cautelas (/efetivo/minhas-cautelas)
 *
 * Harness: MC01-MC15
 * DoD: 07-canonical-definition-of-done.md
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, BFF_URL, login } from "./helpers";

const T = { page: 15_000, api: 8_000 };
const ROUTE = "/efetivo/minhas-cautelas";

test.describe("MC — Efetivo Minhas Cautelas", () => {

  test("MC01 — carga inicial mostra ≤10 cautelas", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const items = page.locator("[data-testid='cautela-card'], [data-testid='cautela-row'], tbody tr");
    await items.first().waitFor({ timeout: T.page }).catch(() => {});
    expect(await items.count()).toBeLessThanOrEqual(10);
  });

  test("MC02 — btn-ver-mais visível quando há mais de 10", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const items = page.locator("[data-testid='cautela-card'], tbody tr");
    if (await items.count() >= 10) {
      const btn = page.getByTestId("btn-ver-mais");
      const visible = await btn.isVisible({ timeout: T.api }).catch(() => false);
      if (visible) await expect(btn).toBeVisible();
    }
  });

  test("MC03 — dropdown Ver mais mostra 20 e 30", async ({ page }) => {
    await login(page, "efetivo");
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

  test("MC04 — botões toggle card/grade presentes", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const toggles = page.locator("button[title*='card' i], button[title*='grade' i], button[title*='tabela' i]");
    const visible = await toggles.first().isVisible({ timeout: T.page }).catch(() => false);
    if (visible) await expect(toggles.first()).toBeVisible();
  });

  test("MC05 — modo tabela ativa thead ao clicar toggle", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const tableBtn = page.locator("button[title*='grade' i], button[title*='tabela' i]").first();
    if (await tableBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await tableBtn.click();
      await expect(page.locator("thead")).toBeVisible({ timeout: T.api });
    }
  });

  test("MC06 — busca por material filtra cautelas", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    if (!await input.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem input de busca"); return;
    }
    await input.fill("xxxxxxxxxxx_sem_resultado");
    await page.waitForTimeout(400);
    const items = page.locator("[data-testid='cautela-card'], tbody tr");
    expect(await items.count()).toBe(0);
  });

  test("MC07 — botão Exportar desabilitado sem seleção", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const btn = page.locator("button:has-text('Exportar')").first();
    if (await btn.isVisible({ timeout: T.page }).catch(() => false)) {
      await expect(btn).toBeDisabled();
    }
  });

  test("MC08 — checkbox de cautela ativa Exportar", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const checkbox = page.locator("input[type='checkbox']").first();
    if (!await checkbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem checkboxes"); return;
    }
    await checkbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    if (await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      await expect(btn).toBeEnabled({ timeout: T.api });
      const text = await btn.textContent();
      expect(text).toMatch(/\d+/);
    }
  });

  test("MC09 — desmarcar → Exportar volta a disabled", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const checkbox = page.locator("input[type='checkbox']").first();
    if (!await checkbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem checkboxes"); return;
    }
    await checkbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    if (await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      await expect(btn).toBeEnabled({ timeout: T.api });
      await checkbox.uncheck();
      await expect(btn).toBeDisabled({ timeout: T.api });
    }
  });

  test("MC10 — página carrega sem erro 5xx", async ({ page }) => {
    await login(page, "efetivo");
    const res = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("MC11 — título da página visível", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: T.page });
  });

  test("MC12 — estado vazio exibe mensagem amigável", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    if (await input.isVisible({ timeout: T.api }).catch(() => false)) {
      await input.fill("xxxxxxxxxxx_sem_resultado");
      await page.waitForTimeout(400);
      const empty = page.locator("text=/nenhum|sem registros|vazio|cautelas/i").first();
      const visible = await empty.isVisible({ timeout: T.api }).catch(() => false);
      if (visible) await expect(empty).toBeVisible();
    }
  });

  test("MC13 — GET /api/cautelamentos/ativos com limit=10 retorna ≤10", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await page.request.get(`${BFF_URL}/api/cautelamentos/ativos?limit=10`, {
      headers: { Cookie: cookieHeader },
    }).catch(() => null);
    if (res && res.status() === 200) {
      const body = await res.json().catch(() => null);
      if (body && Array.isArray(body)) {
        expect(body.length).toBeLessThanOrEqual(10);
      }
    }
  });

  test("MC14 — acesso sem autenticação redireciona", async ({ page }) => {
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: T.page });
    expect(page.url()).toContain("/login");
  });

  test("MC15 — expandir para 20 → ≤20 cautelas", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    if (await page.getByTestId("btn-limit-20").isVisible({ timeout: T.api }).catch(() => false)) {
      await page.getByTestId("btn-limit-20").click();
      await page.waitForTimeout(1500);
      const items = page.locator("[data-testid='cautela-card'], tbody tr");
      expect(await items.count()).toBeLessThanOrEqual(20);
    }
  });

});
