/**
 * Reserva de Armamento-cadastro.spec.ts
 *
 * E2E suite for the Reserva de Armamento (Master) user management flow:
 *   M01–M05  RBAC — toolbar visibility, role restrictions
 *   F01–F03  Photo upload in Cadastrar Militar dialog
 *   B01–B04  Biometria checkbox + FingerSelector UI
 *   N01–N04  Notification bell after login creation
 */

import path from "path";
import { test, expect } from "@playwright/test";
import { login, BASE_URL, T } from "./harness";

// ─── Shared helpers ─────────────────────────────────────────────────────────

async function gotoArmeiroMilitares(page: Parameters<typeof login>[0]) {
  await login(page, "reserva");
  await page.goto(`${BASE_URL}/reserva/militares`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}

async function gotoAdminUsuarios(page: Parameters<typeof login>[0]) {
  await login(page, "admin");
  await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle");
}

// ─── M: RBAC ────────────────────────────────────────────────────────────────

test.describe("M — RBAC toolbar (Reserva de Armamento)", () => {
  test("M01 — Reserva de Armamento vê botões Cadastrar Usuário e Criar Login", async ({ page }) => {
    await gotoArmeiroMilitares(page);
    await expect(page.getByRole("button", { name: /cadastrar usuário/i })).toBeVisible({ timeout: T.navigation });
    await expect(page.getByRole("button", { name: /criar login/i })).toBeVisible({ timeout: T.navigation });
  });

  test("M02 — admin vê os mesmos botões em /admin/usuarios", async ({ page }) => {
    await gotoAdminUsuarios(page);
    await expect(page.getByRole("button", { name: /cadastrar usuário/i })).toBeVisible({ timeout: T.navigation });
    await expect(page.getByRole("button", { name: /criar login/i })).toBeVisible({ timeout: T.navigation });
  });

  test("M03 — Reserva de Armamento: dialog Criar Login não exibe seleção de role (Usuário fixo)", async ({ page }) => {
    await gotoArmeiroMilitares(page);
    await page.getByRole("button", { name: /criar login/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.navigation });

    // Armeiro vê MASTER_ROLES (1 item) → select #create-role NÃO é renderizado (ROLES.length > 1 == false)
    const roleSelect = dialog.locator("#create-role");
    await expect(roleSelect).toHaveCount(0, { timeout: T.apiResponse });

    await page.keyboard.press("Escape");
  });

  test("M04 — admin: dialog Criar Login exibe todos os roles no select #create-role", async ({ page }) => {
    await gotoAdminUsuarios(page);
    await page.getByRole("button", { name: /criar login/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.navigation });

    // Admin vê ALL_ROLES (3 itens) → select renderizado; usa locator escopo para não capturar outros selects
    const roleSelect = dialog.locator("#create-role");
    await expect(roleSelect).toBeVisible({ timeout: T.apiResponse });
    const roleOptions = roleSelect.locator("option");
    await expect(roleOptions).toHaveCount(3, { timeout: T.apiResponse });

    await page.keyboard.press("Escape");
  });

  test("M05 — API rejeita master tentando criar role admin", async ({ page }) => {
    await login(page, "reserva");

    const resp = await page.request.post(`${BASE_URL}/api/admin/users`, {
      data: {
        email: `test-rbac-${Date.now()}@dev.null`,
        nome_completo: "Teste RBAC",
        matricula: `RBAC${Date.now()}`,
        role: "admin",
        method: "password",
        password: "Teste@123",
      },
    });
    expect(resp.status()).toBe(403);
    const body = await resp.json();
    expect(body.error).toMatch(/reserva|militar|acesso negado/i);
  });
});

// ─── F: Foto upload ──────────────────────────────────────────────────────────

test.describe("F — Foto upload (Cadastrar Militar)", () => {
  test("F01 — campo de foto visível no dialog Cadastrar Militar (Reserva de Armamento)", async ({ page }) => {
    await gotoArmeiroMilitares(page);
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.navigation });
    await expect(dialog.getByText(/selecionar foto/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("F02 — preview da foto aparece após seleção de arquivo", async ({ page }) => {
    await gotoArmeiroMilitares(page);
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.navigation });

    // Cria arquivo de imagem sintético (1×1 px PNG)
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBuffer = Buffer.from(pngBase64, "base64");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await dialog.getByText(/selecionar foto/i).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "foto.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    await expect(dialog.locator("img[alt='Prévia']")).toBeVisible({ timeout: T.apiResponse });
  });

  test("F03 — botão X remove preview da foto", async ({ page }) => {
    await gotoArmeiroMilitares(page);
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.navigation });

    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const pngBuffer = Buffer.from(pngBase64, "base64");

    const fileChooserPromise = page.waitForEvent("filechooser");
    await dialog.getByText(/selecionar foto/i).click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "foto.png",
      mimeType: "image/png",
      buffer: pngBuffer,
    });

    await expect(dialog.locator("img[alt='Prévia']")).toBeVisible({ timeout: T.apiResponse });

    // Clica no X para remover — botão imediatamente após a img dentro do container .relative
    await dialog.locator("img[alt='Prévia'] + button, img[alt='Prévia'] ~ button").first().click();
    await expect(dialog.locator("img[alt='Prévia']")).toHaveCount(0, { timeout: T.apiResponse });
    await expect(dialog.getByText(/selecionar foto/i)).toBeVisible();
  });
});

// ─── B: Biometria UI ─────────────────────────────────────────────────────────

test.describe("B — Biometria UI (Cadastrar Militar)", () => {
  async function openCadastrarDialog(page: Parameters<typeof login>[0]) {
    await gotoArmeiroMilitares(page);
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.navigation });
    return dialog;
  }

  test("B01 — checkbox Capturar biometria visível no dialog", async ({ page }) => {
    const dialog = await openCadastrarDialog(page);
    await expect(dialog.getByText(/capturar biometria/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("B02 — FingerSelector oculto por padrão, aparece ao marcar checkbox", async ({ page }) => {
    const dialog = await openCadastrarDialog(page);

    // Fingers ocultos inicialmente
    await expect(dialog.locator("[aria-label='Dedo 1: Polegar']")).toHaveCount(0);

    // Marca via checkbox real (label#cm-biometria)
    await dialog.locator("#cm-biometria").check({ force: true });
    await page.waitForTimeout(300);

    // Agora os dedos devem estar visíveis
    await expect(dialog.locator("[aria-label='Dedo 1: Polegar']")).toBeVisible({ timeout: T.apiResponse });
    await expect(dialog.locator("[aria-label='Dedo 6: Polegar']")).toBeVisible({ timeout: T.apiResponse });
  });

  test("B03 — selecionar dedo mostra texto de confirmação", async ({ page }) => {
    const dialog = await openCadastrarDialog(page);
    await dialog.locator("#cm-biometria").check({ force: true });
    await page.waitForTimeout(300);

    // Seleciona dedo 2 (Indicador Direita)
    await dialog.locator("[aria-label='Dedo 2: Indicador']").click();
    await expect(dialog.getByText(/dedo 2 selecionado/i)).toBeVisible({ timeout: T.apiResponse });
    await expect(dialog.getByText(/\(direita\)/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("B04 — botão Cadastrar bloqueado quando biometria marcada mas nenhum dedo selecionado", async ({ page }) => {
    const dialog = await openCadastrarDialog(page);

    // Preenche campos obrigatórios
    await dialog.locator("#cm-nome").fill("Teste Biometria");
    await dialog.locator("#cm-matricula").fill(`BIO${Date.now()}`);

    // Marca biometria mas não seleciona dedo
    await dialog.locator("#cm-biometria").check({ force: true });
    await page.waitForTimeout(300);

    const submitBtn = dialog.getByRole("button", { name: /cadastrar/i });
    await expect(submitBtn).toBeDisabled({ timeout: T.apiResponse });

    // Seleciona um dedo — botão deve liberar
    await dialog.locator("[aria-label='Dedo 1: Polegar']").first().click();
    await expect(submitBtn).toBeEnabled({ timeout: T.apiResponse });
  });
});

// ─── N: Notificações ─────────────────────────────────────────────────────────

test.describe("N — Notificações (sino no header)", () => {
  test("N01 — sino de notificação visível no header da Reserva de Armamento", async ({ page }) => {
    await login(page, "reserva");
    await expect(page.locator("header button[aria-label='Notificações']")).toBeVisible({ timeout: T.navigation });
  });

  test("N02 — clique no sino abre painel de notificações", async ({ page }) => {
    await login(page, "reserva");
    await page.locator("header button[aria-label='Notificações']").click();
    // SheetTitle com "Notificações" deve aparecer no painel
    await expect(page.getByRole("heading", { name: /notificações/i })).toBeVisible({ timeout: T.apiResponse });
  });

  test("N03 — API GET /api/notifications retorna 200 para usuário autenticado", async ({ page }) => {
    await login(page, "reserva");
    const resp = await page.request.get(`${BASE_URL}/api/notifications`);
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty("notifications");
    expect(body).toHaveProperty("unread_count");
    expect(Array.isArray(body.notifications)).toBe(true);
  });

  test("N04 — API GET /api/notifications retorna 401 sem autenticação", async ({ page }) => {
    const resp = await page.request.get(`${BASE_URL}/api/notifications`);
    expect(resp.status()).toBe(401);
  });
});
