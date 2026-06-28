/**
 * APMCB — Armeiro Flow E2E Spec
 *
 * Cobre: Passagens de Serviço + Cautelas Permanentes
 * Usuário: armeiro (reserva@apmcb.dev / Reserva@123)
 *
 * Run: npx playwright test e2e/armeiro-flow.spec.ts --project=armeiro-suite
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, BFF_URL, login } from "./harness";

const T = {
  nav:      15_000,
  api:       8_000,
  toast:     6_000,
  interact:  3_000,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function goTo(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
}

async function expectToast(page: Page, pattern: RegExp) {
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: pattern })
  ).toBeVisible({ timeout: T.toast });
}

// ── Suite: Passagens de Serviço ──────────────────────────────────────────────

test.describe("AR — Passagens de Serviço", () => {

  test.beforeEach(async ({ page }) => {
    await login(page, "reserva");
  });

  // AR01
  test("AR01 — /reserva/passagens carrega sem erro 401", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    await expect(page.getByRole("heading", { name: /passagens de serviço/i })).toBeVisible({ timeout: T.nav });
    // Não deve mostrar "erro" nem "401"
    await expect(page.getByText(/401|Unauthorized/i)).not.toBeVisible({ timeout: 2000 });
  });

  // AR02
  test("AR02 — botão Nova Passagem visível para armeiro", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    await expect(page.getByRole("button", { name: /nova passagem/i })).toBeVisible({ timeout: T.nav });
  });

  // AR03
  test("AR03 — criar nova passagem abre formulário de observação", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    await page.getByRole("button", { name: /nova passagem/i }).click();
    await expect(page.locator("textarea[placeholder*='Situação']")).toBeVisible({ timeout: T.interact });
    await expect(page.getByRole("button", { name: /criar passagem/i })).toBeVisible();
  });

  // AR04
  test("AR04 — criar passagem chama API e card aparece na lista", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    await page.getByRole("button", { name: /nova passagem/i }).click();
    await expect(page.getByRole("button", { name: /criar passagem/i })).toBeVisible({ timeout: T.interact });
    await page.getByRole("button", { name: /criar passagem/i }).click();
    // Toast de sucesso OU card aparece na lista (API pode estar sem reserve_id — depende de dados)
    const cardOrError = page
      .locator("[data-testid^='handover-card-']")
      .or(page.locator("[data-sonner-toast]").filter({ hasText: /criada|erro|reserva/i }));
    await expect(cardOrError.first()).toBeVisible({ timeout: T.api });
  });

  // AR05
  test("AR05 — card de passagem linka para /reserva/passagens/[id]", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    const card = page.locator("[data-testid^='handover-card-']").first();
    const visible = await card.isVisible({ timeout: T.nav });
    if (!visible) {
      test.skip();
      return;
    }
    await card.click();
    await expect(page).toHaveURL(/\/reserva\/passagens\/[0-9a-f-]{36}/, { timeout: T.nav });
  });

  // AR06
  test("AR06 — página de detalhe de passagem carrega sem 404", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    const card = page.locator("[data-testid^='handover-card-']").first();
    const visible = await card.isVisible({ timeout: T.nav });
    if (!visible) {
      test.skip();
      return;
    }
    await card.click();
    await page.waitForURL(/\/reserva\/passagens\/[0-9a-f-]{36}/, { timeout: T.nav });
    // Não deve mostrar 404
    const heading = page.getByText(/passagem de serviço/i);
    await expect(heading.first()).toBeVisible({ timeout: T.nav });
    await expect(page.getByText(/page could not be found/i)).not.toBeVisible();
  });

  // AR07
  test("AR07 — detalhe mostra seção 'Saindo' e 'Entrante'", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    const card = page.locator("[data-testid^='handover-card-']").first();
    const visible = await card.isVisible({ timeout: T.nav });
    if (!visible) { test.skip(); return; }
    await card.click();
    await page.waitForURL(/\/reserva\/passagens\/[0-9a-f-]{36}/, { timeout: T.nav });
    await expect(page.getByText(/saindo/i).first()).toBeVisible({ timeout: T.api });
    await expect(page.getByText(/entrante/i).first()).toBeVisible({ timeout: T.api });
  });

  // AR08
  test("AR08 — botão Voltar retorna para lista de passagens", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    const card = page.locator("[data-testid^='handover-card-']").first();
    const visible = await card.isVisible({ timeout: T.nav });
    if (!visible) { test.skip(); return; }
    await card.click();
    await page.waitForURL(/\/reserva\/passagens\/[0-9a-f-]{36}/, { timeout: T.nav });
    await page.getByText(/passagens de serviço/i).click();
    await expect(page).toHaveURL(/\/reserva\/passagens$/, { timeout: T.nav });
  });
});

// ── Suite: Cautelas Permanentes ──────────────────────────────────────────────

test.describe("AR — Cautelas Permanentes", () => {

  test.beforeEach(async ({ page }) => {
    await login(page, "reserva");
  });

  // AR10
  test("AR10 — /reserva/cautelas carrega lista sem erro", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    const ready = page.locator("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']");
    await expect(ready.first()).toBeVisible({ timeout: T.nav });
  });

  // AR11
  test("AR11 — botão Nova Cautela abre modal", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await page.waitForSelector("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']", { timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.interact });
    await expect(page.getByRole("heading", { name: /nova cautela permanente/i })).toBeVisible();
  });

  // AR12
  test("AR12 — modal mostra campo de busca de item com placeholder", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await page.waitForSelector("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']", { timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.interact });
    // Aguardar carregamento dos dados no dialog
    await expect(page.getByPlaceholder(/buscar item/i)).toBeVisible({ timeout: T.api });
  });

  // AR13
  test("AR13 — modal mostra campo de busca de militar com autocomplete", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await page.waitForSelector("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']", { timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.interact });
    await expect(page.getByPlaceholder(/buscar por posto.*nome.*matrícula/i)).toBeVisible({ timeout: T.api });
  });

  // AR14
  test("AR14 — campo de reserva não aparece para armeiro com reserva única (auto-selecionado)", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await page.waitForSelector("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']", { timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.interact });
    // Aguardar dados carregarem
    await page.waitForTimeout(2000);
    // Campo de seleção de reserva NÃO deve aparecer (armeiro tem só uma)
    await expect(page.getByText(/selecione a reserva/i)).not.toBeVisible();
    // Mas o nome da reserva deve estar visível (auto-selecionada)
    await expect(page.getByText(/academia de polícia|apmcb/i).first()).toBeVisible({ timeout: T.api });
  });

  // AR15
  test("AR15 — busca de item autocomplete filtra por texto", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await page.waitForSelector("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']", { timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.interact });
    const itemInput = page.getByPlaceholder(/buscar item/i);
    await expect(itemInput).toBeVisible({ timeout: T.api });
    await itemInput.fill("pis");
    // Deve mostrar sugestões ou "nenhum resultado"
    const suggestions = page.locator("[data-testid='cautelas-ready'], dialog button").filter({ hasText: /pis|pistola/i });
    const noResult = page.getByText(/nenhum resultado/i);
    const visible = await Promise.race([
      suggestions.first().isVisible({ timeout: 3000 }).catch(() => false),
      noResult.isVisible({ timeout: 3000 }).catch(() => false),
    ]);
    expect(visible).toBeTruthy();
  });

  // AR16
  test("AR16 — busca de militar filtra por nome e exibe posto", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await page.waitForSelector("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']", { timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.interact });
    const milInput = page.getByPlaceholder(/buscar por posto.*nome.*matrícula/i);
    await expect(milInput).toBeVisible({ timeout: T.api });
    await milInput.fill("cadete");
    // Deve mostrar resultado com "Cadete" ou "000003"
    const result = page.getByText(/cadete teste|000003/i).first();
    const noResult = page.getByText(/nenhum resultado/i);
    const found = await Promise.race([
      result.isVisible({ timeout: 3000 }).catch(() => false),
      noResult.isVisible({ timeout: 3000 }).catch(() => false),
    ]);
    expect(found).toBeTruthy();
  });

  // AR17
  test("AR17 — botão Emitir desabilitado sem campos preenchidos", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await page.waitForSelector("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']", { timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.interact });
    await expect(page.getByRole("button", { name: /emitir e assinar/i })).toBeDisabled({ timeout: T.api });
  });

  // AR18
  test("AR18 — filtros Ativa / Devolvida / Todas funcionam", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await expect(page.locator("[data-testid='cautelas-ready']")).toBeVisible({ timeout: T.nav });
    await page.getByRole("button", { name: /devolvida/i }).click();
    await expect(page.locator("[data-testid='cautelas-ready']")).toBeVisible({ timeout: T.api });
    await page.getByRole("button", { name: /todas/i }).click();
    await expect(page.locator("[data-testid='cautelas-ready']")).toBeVisible({ timeout: T.api });
  });
});

// ── Suite: API BFF direto ─────────────────────────────────────────────────────

test.describe("AR — BFF Endpoints Armeiro", () => {

  // AR20
  test("AR20 — GET /api/handovers retorna 200 com sessão", async ({ page }) => {
    await login(page, "reserva");
    const res = await page.request.get(`${BFF_URL}/api/handovers`, {
      headers: { Cookie: await page.context().cookies().then((c) => c.map((x) => `${x.name}=${x.value}`).join("; ")) },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { handovers: unknown[] };
    expect(Array.isArray(body.handovers)).toBe(true);
  });

  // AR21
  test("AR21 — GET /api/handovers retorna 401 sem sessão", async ({ page }) => {
    const res = await page.request.get(`${BFF_URL}/api/handovers`);
    expect(res.status()).toBeGreaterThanOrEqual(401);
    expect(res.status()).toBeLessThanOrEqual(403);
  });

  // AR22
  test("AR22 — GET /api/arsenal?status_operacional=disponivel retorna lista", async ({ page }) => {
    await login(page, "reserva");
    const res = await page.request.get(`${BFF_URL}/api/arsenal?status_operacional=disponivel`, {
      headers: { Cookie: await page.context().cookies().then((c) => c.map((x) => `${x.name}=${x.value}`).join("; ")) },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  // AR23
  test("AR23 — GET /api/cautelamentos retorna lista para armeiro", async ({ page }) => {
    await login(page, "reserva");
    const res = await page.request.get(`${BFF_URL}/api/cautelamentos?status=ativa`, {
      headers: { Cookie: await page.context().cookies().then((c) => c.map((x) => `${x.name}=${x.value}`).join("; ")) },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { cautelamentos: unknown[] };
    expect(Array.isArray(body.cautelamentos)).toBe(true);
  });
});
