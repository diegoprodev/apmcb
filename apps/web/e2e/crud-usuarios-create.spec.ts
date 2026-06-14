/**
 * APMCB — E2E Harness: Gestão de Usuários (Cadastro + Login)
 *
 * Dois fluxos distintos:
 *   [Cadastrar Militar] — registra no sistema SEM credenciais de login
 *   [Criar Login]       — provisiona acesso ao sistema com e-mail + magic link ou senha
 *
 * Validações:
 *   - Ambos os botões visíveis na toolbar
 *   - Modais abrem corretamente
 *   - Campos obrigatórios bloqueiam submit
 *   - Cadastrar Militar: fluxo completo com confirmação visual
 *   - Criar Login: fluxo com senha + confirmação visual
 *   - API /api/admin/militares retorna 403 sem sessão
 *   - API /api/admin/users retorna 403 sem sessão
 *   - Edição com campos unidade/telefone
 *   - Logo APMCB no sidebar
 */

import { test, expect, request as playwrightRequest } from "@playwright/test";
import { BASE_URL, login, T } from "./harness";

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

// ─── Suite: Toolbar ───────────────────────────────────────────────────────────

test.describe("Admin — Toolbar de Usuários", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });
  });

  test("U01 — botão 'Cadastrar Militar' visível", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /cadastrar militar/i })
    ).toBeVisible();
  });

  test("U02 — botão 'Criar Login' visível", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /criar login/i })
    ).toBeVisible();
  });
});

// ─── Suite: Cadastrar Militar (sem login) ─────────────────────────────────────

test.describe("Admin — Cadastrar Militar (sem credenciais)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });
  });

  test("U03 — modal Cadastrar Militar abre com aviso de sem-login", async ({ page }) => {
    await page.getByRole("button", { name: /cadastrar militar/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/cadastrar militar/i)).toBeVisible({
      timeout: T.animation * 4,
    });
    await expect(dialog.getByText(/não cria credenciais de login/i)).toBeVisible();
  });

  test("U04 — submit bloqueado sem nome ou matrícula", async ({ page }) => {
    await page.getByRole("button", { name: /cadastrar militar/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: /^cadastrar$/i })
    ).toBeDisabled({ timeout: T.animation * 4 });
  });

  test("U05 — cadastrar militar sem login e verificar na lista", async ({ page }) => {
    const id = uid();
    const matricula = `CM${id.toUpperCase()}`;
    const nome = `Sgt Cadastro ${id}`;

    await page.getByRole("button", { name: /cadastrar militar/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    await dialog.getByLabel(/nome completo/i).fill(nome);
    await dialog.getByLabel(/matrícula/i).fill(matricula);
    await dialog.getByLabel(/unidade/i).fill("2ª Cia");
    await dialog.getByLabel(/telefone/i).fill("(83) 9 7777-6666");

    // Captura resposta da API para diagnóstico em caso de falha
    const apiResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/militares") && r.request().method() === "POST",
      { timeout: T.apiResponse * 3 }
    );

    const submitBtn = dialog.getByRole("button", { name: /^cadastrar$/i });
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });
    await submitBtn.click();

    const apiResp = await apiResponsePromise;
    const apiBody = await apiResp.json().catch(() => ({}));
    // Falha descritiva se a API retornar erro
    expect(
      apiResp.status(),
      `API /api/admin/militares retornou ${apiResp.status()}: ${JSON.stringify(apiBody)}`
    ).toBe(200);

    // Tela de confirmação e instrução para Criar Login
    await expect(dialog.getByText(/cadastrado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse * 2,
    });
    await expect(dialog.getByText(/criar login/i)).toBeVisible();

    await dialog.getByRole("button", { name: /fechar/i }).click();

    // Aparece na lista
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill(matricula);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText(matricula)).toBeVisible({ timeout: T.navigation });
  });
});

// ─── Suite: Criar Login ───────────────────────────────────────────────────────

test.describe("Admin — Criar Login (provisionar acesso)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });
  });

  test("U06 — modal Criar Login abre com seleção de método", async ({ page }) => {
    await page.getByRole("button", { name: /criar login/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/criar login/i)).toBeVisible({
      timeout: T.animation * 4,
    });
    await expect(dialog.getByText(/magic link/i)).toBeVisible();
    await expect(dialog.getByText(/define senha/i)).toBeVisible();
  });

  test("U07 — campo senha oculto com Magic Link selecionado", async ({ page }) => {
    await page.getByRole("button", { name: /criar login/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/senha temporária/i)).not.toBeVisible({
      timeout: T.animation * 4,
    });
  });

  test("U08 — campo senha visível ao selecionar método Senha", async ({ page }) => {
    await page.getByRole("button", { name: /criar login/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /define senha/i }).click();
    await expect(dialog.getByLabel(/senha temporária/i)).toBeVisible();
  });

  test("U09 — submit bloqueado sem e-mail, nome ou matrícula", async ({ page }) => {
    await page.getByRole("button", { name: /criar login/i }).click();
    const dialog = page.getByRole("dialog");
    const submitBtn = dialog.getByRole("button", { name: /enviar convite|criar conta/i });
    await expect(submitBtn).toBeDisabled({ timeout: T.animation * 4 });
  });

  test("U10 — criar login com senha e verificar na lista", async ({ page }) => {
    const id = uid();
    const email = `e2e.login.${id}@apmcb.test`;
    const matricula = `LG${id.toUpperCase()}`;
    const nome = `Cap Login ${id}`;

    await page.getByRole("button", { name: /criar login/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    // Método senha
    await dialog.getByRole("button", { name: /define senha/i }).click();

    await dialog.getByLabel(/e-mail/i).fill(email);
    await dialog.getByLabel(/senha temporária/i).fill("TesteE2E@123");
    await dialog.getByLabel(/nome completo/i).fill(nome);
    await dialog.getByLabel(/matrícula/i).fill(matricula);
    await dialog.getByLabel(/unidade/i).fill("E2E Teste");

    const submitBtn = dialog.getByRole("button", { name: /criar conta/i });
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });

    // Captura resposta da API para diagnóstico em caso de falha
    const apiResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/users") && r.request().method() === "POST",
      { timeout: T.apiResponse * 3 }
    );
    await submitBtn.click();

    const apiResp = await apiResponsePromise;
    const apiBody = await apiResp.json().catch(() => ({}));
    expect(
      apiResp.status(),
      `API /api/admin/users retornou ${apiResp.status()}: ${JSON.stringify(apiBody)}`
    ).toBe(200);

    await expect(dialog.getByText(/criado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse * 2,
    });

    await dialog.getByRole("button", { name: /fechar/i }).click();

    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill(matricula);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText(matricula)).toBeVisible({ timeout: T.navigation });
  });
});

// ─── Suite: Segurança / API ───────────────────────────────────────────────────

test.describe("Segurança — endpoints admin protegidos", () => {
  test("U11 — /api/admin/militares retorna 403 sem sessão", async () => {
    const ctx = await playwrightRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/admin/militares`, {
      data: { nome_completo: "Hacker", matricula: "HACK001" },
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  test("U12 — /api/admin/users retorna 403 sem sessão", async () => {
    const ctx = await playwrightRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/admin/users`, {
      data: { email: "hacker@evil.com", nome_completo: "X", matricula: "X", method: "magic_link" },
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });
});

// ─── Suite: Edição de campos estendidos ──────────────────────────────────────

test.describe("Admin — Edição de Usuário: campos estendidos", () => {
  test("U13 — campos unidade e telefone presentes no modal de edição", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });

    await page.getByRole("button", { name: /editar/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/unidade/i)).toBeVisible({ timeout: T.animation * 4 });
    await expect(dialog.getByLabel(/telefone/i)).toBeVisible();
  });

  test("U14 — salvar unidade e telefone via modal de edição", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });

    await page.getByRole("button", { name: /editar/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    await dialog.getByLabel(/unidade/i).clear();
    await dialog.getByLabel(/unidade/i).fill("Sede APMCB");
    await dialog.getByLabel(/telefone/i).clear();
    await dialog.getByLabel(/telefone/i).fill("(83) 9 8888-7777");
    await dialog.getByRole("button", { name: /salvar/i }).click();

    await expect(page.getByText(/atualizado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse,
    });
  });
});

// ─── Suite: Sidebar logo ─────────────────────────────────────────────────────

test.describe("UI — Sidebar com logo", () => {
  test("U15 — logo APMCB visível no sidebar expandido", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin`, { waitUntil: "load" });
    await expect(
      page.locator('aside img[alt="APMCB"]')
    ).toBeVisible({ timeout: T.navigation });
  });
});
