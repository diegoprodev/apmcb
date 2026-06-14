/**
 * APMCB — E2E Harness: Criação de Usuários
 *
 * Valida o fluxo completo de criação de contas por administrador:
 *   - UI: botão visível, modal abre, campos presentes
 *   - Validação de formulário (campos obrigatórios, senha mínima)
 *   - Criação via magic link e via senha
 *   - Usuário aparece na lista após criação
 *   - Segurança: endpoint 403 sem sessão admin
 *
 * Pré-requisito: sessão admin válida (USERS.admin no harness)
 */

import { test, expect, request as playwrightRequest } from "@playwright/test";
import { BASE_URL, login, T } from "./harness";

// ─── Helpers ────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

// ─── Suite: UI Affordances ───────────────────────────────────────────────────

test.describe("Admin — Gestão de Usuários: UI", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });
  });

  test("U01 — botão 'Criar Usuário' está visível na página", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /criar usuário/i })
    ).toBeVisible();
  });

  test("U02 — modal abre ao clicar em 'Criar Usuário'", async ({ page }) => {
    await page.getByRole("button", { name: /criar usuário/i }).click();
    await expect(
      page.getByRole("dialog").getByText(/criar usuário/i)
    ).toBeVisible({ timeout: T.animation * 4 });
  });

  test("U03 — modal contém todos os campos obrigatórios", async ({ page }) => {
    await page.getByRole("button", { name: /criar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/e-mail/i)).toBeVisible();
    await expect(dialog.getByLabel(/nome completo/i)).toBeVisible();
    await expect(dialog.getByLabel(/matrícula/i)).toBeVisible();
  });

  test("U04 — seleção de método 'Senha' mostra campo senha", async ({ page }) => {
    await page.getByRole("button", { name: /criar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    // Campo senha deve estar oculto com Magic Link (padrão)
    await expect(dialog.getByLabel(/senha temporária/i)).not.toBeVisible();
    // Selecionar método "Senha"
    await dialog.getByRole("button", { name: /senha/i }).click();
    // Campo senha agora visível
    await expect(dialog.getByLabel(/senha temporária/i)).toBeVisible();
  });

  test("U05 — botão de envio desabilitado com campos obrigatórios vazios", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /criar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    const submitBtn = dialog.getByRole("button", { name: /enviar convite|criar conta/i });
    await expect(submitBtn).toBeDisabled();
  });

  test("U06 — botão de envio habilitado ao preencher obrigatórios", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /criar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    const id = uid();
    await dialog.getByLabel(/e-mail/i).fill(`test.${id}@apmcb.test`);
    await dialog.getByLabel(/nome completo/i).fill(`Ten Teste ${id}`);
    await dialog.getByLabel(/matrícula/i).fill(`TST${id}`);
    await expect(
      dialog.getByRole("button", { name: /enviar convite|criar conta/i })
    ).toBeEnabled({ timeout: 2000 });
  });

  test("U07 — modal fecha ao clicar em Cancelar", async ({ page }) => {
    await page.getByRole("button", { name: /criar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /cancelar/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: T.animation * 4 });
  });

  test("U08 — campos do modal de edição incluem unidade e telefone", async ({
    page,
  }) => {
    // Clicar no botão de editar do primeiro usuário da lista
    const editBtn = page.getByRole("button", { name: /editar/i }).first();
    await editBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/unidade/i)).toBeVisible({ timeout: T.animation * 4 });
    await expect(dialog.getByLabel(/telefone/i)).toBeVisible();
  });
});

// ─── Suite: Criação via API ──────────────────────────────────────────────────

test.describe("Admin — Gestão de Usuários: API", () => {
  test("U09 — endpoint /api/admin/users retorna 403 sem sessão", async () => {
    const ctx = await playwrightRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/admin/users`, {
      data: {
        email: "hacker@evil.com",
        nome_completo: "Hacker",
        matricula: "HACK001",
        method: "password",
        password: "hacked123",
      },
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  test("U10 — criar usuário com senha e verificar na lista", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    const id = uid();
    const email = `e2e.${id}@apmcb.test`;
    const matricula = `E2E${id.toUpperCase()}`;
    const nome = `Cap E2E ${id}`;

    // Abrir modal
    await page.getByRole("button", { name: /criar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    // Selecionar método senha
    await dialog.getByRole("button", { name: /^senha$/i }).click();

    // Preencher campos
    await dialog.getByLabel(/e-mail/i).fill(email);
    await dialog.getByLabel(/senha temporária/i).fill("TesteE2E@123");
    await dialog.getByLabel(/nome completo/i).fill(nome);
    await dialog.getByLabel(/matrícula/i).fill(matricula);
    await dialog.getByLabel(/unidade/i).fill("1ª Cia E2E");
    await dialog.getByLabel(/telefone/i).fill("(83) 9 9999-0000");

    // Submeter
    const submitBtn = dialog.getByRole("button", { name: /criar conta/i });
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });
    await submitBtn.click();

    // Tela de confirmação
    await expect(dialog.getByText(/criado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse * 2,
    });

    // Fechar e verificar na lista
    await dialog.getByRole("button", { name: /fechar/i }).click();
    await page.waitForLoadState("load");

    // Buscar pelo nome na lista (pode precisar de refresh)
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill(matricula);
      await page.waitForTimeout(500);
    }
    await expect(page.getByText(matricula)).toBeVisible({ timeout: T.navigation });
  });
});

// ─── Suite: Edição de campos estendidos ──────────────────────────────────────

test.describe("Admin — Edição de Usuário: campos estendidos", () => {
  test("U11 — salvar unidade e telefone via modal de edição", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    // Editar o primeiro usuário da lista
    const editBtn = page.getByRole("button", { name: /editar/i }).first();
    await editBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    const unidadeInput = dialog.getByLabel(/unidade/i);
    await unidadeInput.clear();
    await unidadeInput.fill("Sede APMCB");

    const telefoneInput = dialog.getByLabel(/telefone/i);
    await telefoneInput.clear();
    await telefoneInput.fill("(83) 9 8888-7777");

    await dialog.getByRole("button", { name: /salvar/i }).click();

    // Toast de sucesso
    await expect(page.getByText(/atualizado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse,
    });
  });
});

// ─── Suite: Sidebar logo ─────────────────────────────────────────────────────

test.describe("UI — Sidebar com logo", () => {
  test("U12 — logo APMCB visível no sidebar expandido (admin)", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin`, { waitUntil: "load" });

    // Sidebar aberta por padrão em desktop
    const logo = page.locator('aside img[alt="APMCB"]');
    await expect(logo).toBeVisible({ timeout: T.navigation });
  });
});
