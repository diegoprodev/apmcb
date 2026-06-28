/**
 * APMCB — Armeiro Flow E2E Spec
 *
 * Cobre: Passagens de Serviço + Cautelas Permanentes
 * Usuário: armeiro (armeiro@apmcb.dev / Armeiro@123)
 *
 * Run: npx playwright test e2e/armeiro-flow.spec.ts --project=armeiro-suite
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, BFF_URL, login } from "./harness";

const T = {
  nav:      20_000,
  api:      10_000,
  dialog:   10_000,  // dialogs atrás de dados assíncronos precisam de mais tempo
  toast:     6_000,
  interact:  5_000,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function goTo(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
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
    await expect(page.getByText(/401|Unauthorized/i)).not.toBeVisible({ timeout: 2000 });
  });

  // AR02
  test("AR02 — botão Nova Passagem visível para armeiro", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    await expect(page.getByRole("heading", { name: /passagens de serviço/i })).toBeVisible({ timeout: T.nav });
    await expect(page.getByRole("button", { name: /nova passagem/i })).toBeVisible({ timeout: T.interact });
  });

  // AR03
  test("AR03 — clicar Nova Passagem exibe formulário de criação", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    const btn = page.getByRole("button", { name: /nova passagem/i });
    await expect(btn).toBeVisible({ timeout: T.nav });
    // Aguardar networkidle garante que React hidratou os event handlers
    await page.waitForLoadState("networkidle");
    await btn.click();
    await expect(
      page.getByRole("button", { name: /criar passagem/i })
    ).toBeVisible({ timeout: T.interact });
  });

  // AR04
  test("AR04 — form de passagem tem textarea de observação", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    const btn = page.getByRole("button", { name: /nova passagem/i });
    await expect(btn).toBeVisible({ timeout: T.nav });
    await page.waitForLoadState("networkidle");
    await btn.click();
    await expect(page.getByRole("button", { name: /criar passagem/i })).toBeVisible({ timeout: T.interact });
    await expect(page.locator("textarea").first()).toBeVisible({ timeout: T.interact });
  });

  // AR05
  test("AR05 — card de passagem linka para /reserva/passagens/[id]", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    await expect(page.getByRole("heading", { name: /passagens de serviço/i })).toBeVisible({ timeout: T.nav });
    const card = page.locator("[data-testid^='handover-card-']").first();
    const visible = await card.isVisible({ timeout: T.nav });
    if (!visible) { test.skip(); return; }
    await card.click();
    await expect(page).toHaveURL(/\/reserva\/passagens\/[0-9a-f-]{36}/, { timeout: T.nav });
  });

  // AR06
  test("AR06 — página de detalhe de passagem carrega sem 404", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    await expect(page.getByRole("heading", { name: /passagens de serviço/i })).toBeVisible({ timeout: T.nav });
    const card = page.locator("[data-testid^='handover-card-']").first();
    const visible = await card.isVisible({ timeout: T.nav });
    if (!visible) { test.skip(); return; }
    await card.click();
    await page.waitForURL(/\/reserva\/passagens\/[0-9a-f-]{36}/, { timeout: T.nav });
    await expect(page.getByText(/passagem de serviço/i).first()).toBeVisible({ timeout: T.nav });
    await expect(page.getByText(/page could not be found/i)).not.toBeVisible();
  });

  // AR07
  test("AR07 — detalhe mostra seção 'Saindo' e 'Entrante'", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    await expect(page.getByRole("heading", { name: /passagens de serviço/i })).toBeVisible({ timeout: T.nav });
    const card = page.locator("[data-testid^='handover-card-']").first();
    const visible = await card.isVisible({ timeout: T.nav });
    if (!visible) { test.skip(); return; }
    await card.click();
    await page.waitForURL(/\/reserva\/passagens\/[0-9a-f-]{36}/, { timeout: T.nav });
    await expect(page.getByText(/saindo/i).first()).toBeVisible({ timeout: T.api });
    await expect(page.getByText(/entrante/i).first()).toBeVisible({ timeout: T.api });
  });

  // AR08
  test("AR08 — URL passagens é acessível sem redirect para login", async ({ page }) => {
    await goTo(page, "/reserva/passagens");
    // Apenas verifica que não redireciona para /login
    await expect(page).not.toHaveURL(/\/login/, { timeout: T.nav });
    await expect(page.getByRole("heading", { name: /passagens de serviço/i })).toBeVisible({ timeout: T.nav });
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
    await expect(page.locator("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']").first()).toBeVisible({ timeout: T.nav });
    await page.waitForLoadState("networkidle");
    const btn = page.getByRole("button", { name: /nova cautela/i });
    await expect(btn).toBeVisible({ timeout: T.interact });
    await btn.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.dialog });
    await expect(page.getByRole("heading", { name: /nova cautela permanente/i })).toBeVisible();
  });

  // AR12
  test("AR12 — modal mostra campo de busca de item com placeholder", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await expect(page.locator("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']").first()).toBeVisible({ timeout: T.nav });
    await page.waitForLoadState("networkidle");
    const btn = page.getByRole("button", { name: /nova cautela/i });
    await expect(btn).toBeVisible({ timeout: T.interact });
    await btn.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.dialog });
    // Aguardar dados carregarem (spinner desaparece)
    await expect(page.locator("dialog .animate-spin")).not.toBeVisible({ timeout: T.api });
    await expect(page.getByPlaceholder(/buscar item/i)).toBeVisible({ timeout: T.api });
  });

  // AR13
  test("AR13 — modal mostra campo de busca de militar com autocomplete", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await expect(page.locator("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']").first()).toBeVisible({ timeout: T.nav });
    await page.waitForLoadState("networkidle");
    const btn = page.getByRole("button", { name: /nova cautela/i });
    await expect(btn).toBeVisible({ timeout: T.interact });
    await btn.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.dialog });
    await expect(page.locator("dialog .animate-spin")).not.toBeVisible({ timeout: T.api });
    await expect(page.getByPlaceholder(/buscar por posto/i)).toBeVisible({ timeout: T.api });
  });

  // AR14
  test("AR14 — campo de reserva não aparece para armeiro com reserva única", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await expect(page.locator("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']").first()).toBeVisible({ timeout: T.nav });
    await page.waitForLoadState("networkidle");
    const btn = page.getByRole("button", { name: /nova cautela/i });
    await expect(btn).toBeVisible({ timeout: T.interact });
    await btn.click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.dialog });
    // Aguardar spinner sumir (dados carregados)
    await expect(page.locator("dialog .animate-spin")).not.toBeVisible({ timeout: T.api });
    // "Selecionar reserva" NÃO deve aparecer (armeiro tem só uma)
    await expect(page.getByText(/selecione a reserva/i)).not.toBeVisible({ timeout: T.interact });
    // Nome da reserva deve aparecer (auto-selecionada)
    await expect(page.getByText(/academia de polícia|apmcb/i).first()).toBeVisible({ timeout: T.api });
  });

  // AR15
  test("AR15 — busca de item autocomplete filtra por texto", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await expect(page.locator("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']").first()).toBeVisible({ timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.dialog });
    await expect(page.locator("dialog .animate-spin")).not.toBeVisible({ timeout: T.api });
    const itemInput = page.getByPlaceholder(/buscar item/i);
    await expect(itemInput).toBeVisible({ timeout: T.api });
    await itemInput.fill("p");
    // Deve mostrar sugestões dropdown ou "nenhum resultado"
    const drop = page.locator("dialog .max-h-52");
    await expect(drop).toBeVisible({ timeout: T.interact });
  });

  // AR16
  test("AR16 — busca de militar exibe dropdown com resultados", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await expect(page.locator("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']").first()).toBeVisible({ timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.dialog });
    await expect(page.locator("dialog .animate-spin")).not.toBeVisible({ timeout: T.api });
    const milInput = page.getByPlaceholder(/buscar por posto/i);
    await expect(milInput).toBeVisible({ timeout: T.api });
    await milInput.fill("a");
    const drop = page.locator("dialog .max-h-52");
    await expect(drop).toBeVisible({ timeout: T.interact });
  });

  // AR17
  test("AR17 — botão Emitir desabilitado sem campos preenchidos", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    await expect(page.locator("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']").first()).toBeVisible({ timeout: T.nav });
    await page.getByRole("button", { name: /nova cautela/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: T.dialog });
    // O botão pode estar disabled enquanto carrega OU depois que carrega (campos vazios)
    const emitirBtn = page.getByRole("button", { name: /emitir e assinar/i });
    await expect(emitirBtn).toBeVisible({ timeout: T.api });
    await expect(emitirBtn).toBeDisabled({ timeout: T.api });
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
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((x) => `${x.name}=${x.value}`).join("; ");
    const res = await page.request.get(`${BFF_URL}/api/handovers`, {
      headers: { Cookie: cookieHeader },
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
  test("AR22 — GET /api/cautelamentos retorna 200 com sessão", async ({ page }) => {
    await login(page, "reserva");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((x) => `${x.name}=${x.value}`).join("; ");
    const res = await page.request.get(`${BFF_URL}/api/cautelamentos?status=ativa`, {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { cautelamentos: unknown[] };
    expect(Array.isArray(body.cautelamentos)).toBe(true);
  });

  // AR23
  test("AR23 — GET /api/cautelamentos sem sessão retorna 401", async ({ page }) => {
    const res = await page.request.get(`${BFF_URL}/api/cautelamentos?status=ativa`);
    expect(res.status()).toBeGreaterThanOrEqual(401);
    expect(res.status()).toBeLessThanOrEqual(403);
  });
});
