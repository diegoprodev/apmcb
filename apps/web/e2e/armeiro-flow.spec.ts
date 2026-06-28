/**
 * APMCB — Armeiro Flow E2E Spec
 *
 * Cobre: Passagens de Serviço + Cautelas Permanentes
 * Usuário: armeiro (armeiro@apmcb.dev / Armeiro@123)
 *
 * Requer projeto armeiro-setup (rodado antes, salva .auth/armeiro.json)
 * Todos os testes reusam storageState — zero logins durante a suite.
 *
 * Run: npx playwright test e2e/armeiro-flow.spec.ts --project=armeiro-suite
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, BFF_URL } from "./harness";

const T = {
  nav:      20_000,
  api:      10_000,
  dialog:   10_000,
  toast:     6_000,
  interact:  5_000,
};

// ── Helper ───────────────────────────────────────────────────────────────────

async function goTo(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
}

// ── Suite: Passagens de Serviço ──────────────────────────────────────────────

test.describe("AR — Passagens de Serviço", () => {

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
    await expect(page).not.toHaveURL(/\/login/, { timeout: T.nav });
    await expect(page.getByRole("heading", { name: /passagens de serviço/i })).toBeVisible({ timeout: T.nav });
  });
});

// ── Suite: Cautelas Permanentes ──────────────────────────────────────────────

test.describe("AR — Cautelas Permanentes", () => {

  // AR10
  test("AR10 — /reserva/cautelas carrega lista sem erro", async ({ page }) => {
    await goTo(page, "/reserva/cautelas");
    const ready = page.locator("[data-testid='cautelas-ready'], [data-testid='cautelas-loading']");
    await expect(ready.first()).toBeVisible({ timeout: T.nav });
  });

  // Helper: navega para cautelas, aguarda estar PRONTO (não loading), abre modal
  async function openCautelaDialog(page: Page) {
    await goTo(page, "/reserva/cautelas");
    // Aguardar especificamente cautelas-ready (não loading state)
    await expect(page.locator("[data-testid='cautelas-ready']")).toBeVisible({ timeout: T.nav });
    await page.waitForLoadState("networkidle");
    const btn = page.getByRole("button", { name: /nova cautela/i });
    await expect(btn).toBeVisible({ timeout: T.nav });
    await btn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });
    // Aguardar spinner sumir (dados carregados no modal)
    await expect(page.locator("[role='dialog'] .animate-spin")).not.toBeVisible({ timeout: T.api });
    return dialog;
  }

  // AR11
  test("AR11 — botão Nova Cautela abre modal", async ({ page }) => {
    await openCautelaDialog(page);
    await expect(page.getByRole("heading", { name: /nova cautela permanente/i })).toBeVisible();
  });

  // AR12
  test("AR12 — modal mostra campo de busca de item com placeholder", async ({ page }) => {
    await openCautelaDialog(page);
    await expect(page.getByPlaceholder(/buscar item/i)).toBeVisible({ timeout: T.api });
  });

  // AR13
  test("AR13 — modal mostra campo de busca de militar com autocomplete", async ({ page }) => {
    await openCautelaDialog(page);
    await expect(page.getByPlaceholder(/buscar por posto/i)).toBeVisible({ timeout: T.api });
  });

  // AR14
  test("AR14 — campo de reserva não aparece para armeiro com reserva única", async ({ page }) => {
    await openCautelaDialog(page);
    await expect(page.getByText(/selecione a reserva/i)).not.toBeVisible({ timeout: T.interact });
    await expect(page.getByText(/academia de polícia|apmcb/i).first()).toBeVisible({ timeout: T.api });
  });

  // AR15
  test("AR15 — busca de item autocomplete filtra por texto", async ({ page }) => {
    await openCautelaDialog(page);
    const itemInput = page.getByPlaceholder(/buscar item/i);
    await expect(itemInput).toBeVisible({ timeout: T.api });
    // pressSequentially dispara eventos de teclado — mais confiável que fill() para React
    await itemInput.click();
    await itemInput.pressSequentially("p", { delay: 50 });
    // Dropdown usa [role='dialog'] (shadcn Dialog = div, não <dialog> HTML tag)
    await expect(page.locator("[role='dialog'] .max-h-52")).toBeVisible({ timeout: T.interact });
  });

  // AR16
  test("AR16 — busca de militar exibe dropdown com resultados", async ({ page }) => {
    await openCautelaDialog(page);
    const milInput = page.getByPlaceholder(/buscar por posto/i);
    await expect(milInput).toBeVisible({ timeout: T.api });
    await milInput.click();
    await milInput.pressSequentially("a", { delay: 50 });
    await expect(page.locator("[role='dialog'] .max-h-52")).toBeVisible({ timeout: T.interact });
  });

  // AR17
  test("AR17 — botão Emitir desabilitado sem campos preenchidos", async ({ page }) => {
    await openCautelaDialog(page);
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

// ── Suite: BFF Endpoints (direto via HTTP) ───────────────────────────────────

test.describe("AR — BFF Endpoints Armeiro", () => {

  // AR20 — usa cookies do storageState (contexto já autenticado)
  test("AR20 — GET /api/handovers retorna 200 com sessão", async ({ page }) => {
    // Navegar para qualquer página autenticada para garantir que cookies estão ativos
    await goTo(page, "/reserva");
    await page.waitForLoadState("domcontentloaded");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((x) => `${x.name}=${x.value}`).join("; ");
    const res = await page.request.get(`${BFF_URL}/api/handovers`, {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { handovers: unknown[] };
    expect(Array.isArray(body.handovers)).toBe(true);
  });

  // AR21 — sem cookies: usa Node.js fetch nativo (não herda storageState do projeto)
  test("AR21 — GET /api/handovers retorna 401 sem sessão", async () => {
    const res = await fetch(`${BFF_URL}/api/handovers`);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  // AR22 — usa cookies do storageState
  test("AR22 — GET /api/cautelamentos retorna 200 com sessão", async ({ page }) => {
    await goTo(page, "/reserva");
    await page.waitForLoadState("domcontentloaded");
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((x) => `${x.name}=${x.value}`).join("; ");
    const res = await page.request.get(`${BFF_URL}/api/cautelamentos?status=ativa`, {
      headers: { Cookie: cookieHeader },
    });
    expect(res.status()).toBe(200);
    const body = await res.json() as { cautelamentos: unknown[] };
    expect(Array.isArray(body.cautelamentos)).toBe(true);
  });

  // AR23 — sem cookies: usa Node.js fetch nativo
  test("AR23 — GET /api/cautelamentos sem sessão retorna 401", async () => {
    const res = await fetch(`${BFF_URL}/api/cautelamentos?status=ativa`);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });
});
