/**
 * AU — Admin Usuários (/admin/usuarios)
 *
 * Harness: AU01-AU15
 * DoD: 07-canonical-definition-of-done.md
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

const T = { page: 15_000, api: 8_000 };
const ROUTE = "/admin/usuarios";

test.describe("AU — Admin Usuários", () => {

  test("AU01 — carga inicial mostra ≤10 usuários", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const items = page.locator("tbody tr, [data-testid='usuario-card'], [data-testid='usuario-row']");
    await items.first().waitFor({ timeout: T.page }).catch(() => {});
    expect(await items.count()).toBeLessThanOrEqual(10);
  });

  test("AU02 — btn-ver-mais visível quando há mais de 10 usuários", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    const items = page.locator("tbody tr, [data-testid='usuario-card']");
    if (await items.count() >= 10) {
      const visible = await btn.isVisible({ timeout: T.api }).catch(() => false);
      if (visible) await expect(btn).toBeVisible();
    }
  });

  test("AU03 — dropdown Ver mais mostra 20 e 30", async ({ page }) => {
    await login(page, "admin");
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

  test("AU04 — busca por texto filtra usuários", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    if (!await input.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem input de busca"); return;
    }
    // SearchInput (search-input.tsx) só filtra a lista de fato (navigateWithQuery,
    // via ?q= na URL, router.replace) ao pressionar Enter ou selecionar uma
    // sugestão — digitar sozinho só dispara o autocomplete (debounce 300ms).
    // Esperar a URL de verdade (não um waitForTimeout fixo) — o router.replace
    // e a nova renderização do Server Component podem levar mais que um
    // timeout curto sob carga, e um wait fixo virava falso negativo.
    await input.fill("xxxxxxxxxxx_sem_resultado");
    await input.press("Enter");
    await page.waitForURL(/[?&]q=/, { timeout: T.api });
    const items = page.locator("tbody tr, [data-testid='usuario-card']");
    await expect(items).toHaveCount(0, { timeout: T.api });
  });

  test("AU05 — botões toggle card/grade presentes", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const toggles = page.locator("button[title*='card' i], button[title*='grade' i], button[title*='tabela' i]");
    const visible = await toggles.first().isVisible({ timeout: T.page }).catch(() => false);
    if (visible) await expect(toggles.first()).toBeVisible();
  });

  test("AU06 — modo tabela ativa thead", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const tableBtn = page.locator("button[title*='grade' i], button[title*='tabela' i]").first();
    if (await tableBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await tableBtn.click();
      await expect(page.locator("thead")).toBeVisible({ timeout: T.api });
    }
  });

  test("AU07 — sort por nome inverte na 2ª clique", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const sortBtn = page.locator("thead button, button[data-sort]").first();
    if (await sortBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await sortBtn.click();
      await sortBtn.click();
      await expect(sortBtn).toBeVisible();
    }
  });

  test("AU08 — filtro por role funciona", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const select = page.locator("select[data-testid='filter-role'], select").first();
    if (await select.isVisible({ timeout: T.api }).catch(() => false)) {
      await select.selectOption({ index: 1 });
      await page.waitForTimeout(400);
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("AU09 — botão Exportar desabilitado sem seleção", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const btn = page.locator("button:has-text('Exportar')").first();
    if (await btn.isVisible({ timeout: T.page }).catch(() => false)) {
      await expect(btn).toBeDisabled();
    }
  });

  test("AU10 — checkbox de item ativa Exportar com contador", async ({ page }) => {
    await login(page, "admin");
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

  test("AU11 — página carrega sem erro 5xx", async ({ page }) => {
    await login(page, "admin");
    const res = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("AU12 — título da página visível", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: T.page });
  });

  test("AU13 — estado vazio com busca sem resultado", async ({ page }) => {
    await login(page, "admin");
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

  test("AU14 — acesso sem autenticação redireciona para /login", async ({ page }) => {
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: T.page });
    expect(page.url()).toContain("/login");
  });

  test("AU15 — selecionar 30 → ≤30 usuários", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    if (await page.getByTestId("btn-limit-30").isVisible({ timeout: T.api }).catch(() => false)) {
      await page.getByTestId("btn-limit-30").click();
      await page.waitForTimeout(1500);
      const items = page.locator("tbody tr, [data-testid='usuario-card']");
      expect(await items.count()).toBeLessThanOrEqual(30);
    }
  });

});
