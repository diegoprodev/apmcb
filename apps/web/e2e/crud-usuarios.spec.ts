/**
 * APMCB — Usuários CRUD Regression Suite
 * Full list / read / update / deactivate scenarios for /admin/usuarios.
 *
 * Run: npx playwright test e2e/crud-usuarios.spec.ts --reporter=html
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login, expectToast, waitForTableRows } from "./helpers";
import { T } from "./harness";

test.describe("Usuários CRUD — completo", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    // UsersTable abre em modo "cards" por padrão — os testes abaixo dependem de
    // <table>/<tbody> (via waitForTableRows), então força modo grade.
    await page.locator('button[title="Ver em grade"]').click();
  });

  // ── U1 — Page loads ────────────────────────────────────────────────────────

  test("U1 — página carrega e exibe ao menos 3 usuários", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /usuários|militares/i })
    ).toBeVisible({ timeout: 8000 });
    const count = await waitForTableRows(page, 3);
    expect(count).toBeGreaterThanOrEqual(3);
  });

  // ── U2 — Role badges ────────────────────────────────────────────────────────

  test("U2 — role badges visíveis na tabela", async ({ page }) => {
    await waitForTableRows(page);
    const badge = page.getByText(/Admin|Reserva de Armamento|Militar/i).first();
    await expect(badge).toBeVisible();
  });

  // ── U3 — Edit dialog opens with pre-filled data ───────────────────────────

  test("U3 — dialog editar abre com dados preenchidos", async ({ page }) => {
    await waitForTableRows(page);
    await page.locator('button[title="Editar"]').first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const nomeInput = dialog.locator('input[id="edit-nome"]');
    await expect(nomeInput).not.toHaveValue("");

    // Matrícula read-only indicator should be visible
    const matriculaEl = dialog
      .locator(".font-mono")
      .or(dialog.getByText(/\d{6}/));
    await expect(matriculaEl.first()).toBeVisible();
  });

  // ── U4 — Edit saves correctly ─────────────────────────────────────────────

  test("U4 — editar nome persiste e mostra toast", async ({ page }) => {
    await waitForTableRows(page);

    // Target a non-self row (avoid editing the logged-in admin)
    const rows = page.locator("tbody tr");
    const total = await rows.count();
    const targetIndex = total >= 3 ? 2 : total - 1;
    await rows.nth(targetIndex).locator('button[title="Editar"]').click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const nomeInput = dialog.locator('input[id="edit-nome"]');
    await nomeInput.clear();
    await nomeInput.fill("Nome Editado Teste");

    await dialog.getByRole("button", { name: /salvar/i }).click();
    await expectToast(page, /atualizado|salvo|sucesso/i);
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  // ── U5 — Validation: empty name disables submit ───────────────────────────

  test("U5 — nome vazio: botão Salvar permanece desabilitado", async ({
    page,
  }) => {
    await waitForTableRows(page);
    await page.locator('button[title="Editar"]').first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const nomeInput = dialog.locator('input[id="edit-nome"]');
    await nomeInput.clear();

    await expect(
      dialog.getByRole("button", { name: /salvar/i })
    ).toBeDisabled();
  });

  // ── U6 — Deactivate dialog ────────────────────────────────────────────────

  test("U6 — dialog Desativar abre e pode ser fechado", async ({ page }) => {
    await waitForTableRows(page);

    const deactivateBtn = page
      .locator('button[title="Desativar"]')
      .or(page.getByRole("button", { name: /desativar/i }))
      .first();

    if (!(await deactivateBtn.isVisible())) {
      test.skip();
      return;
    }

    await deactivateBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Either a confirm button or a close/cancel — something actionable
    const closeBtn = dialog
      .getByRole("button", { name: /cancelar|fechar/i })
      .first();
    const confirmBtn = dialog
      .getByRole("button", { name: /desativar/i })
      .first();

    const hasAction =
      (await closeBtn.isVisible()) || (await confirmBtn.isVisible());
    expect(hasAction).toBe(true);

    await (await closeBtn.isVisible() ? closeBtn : confirmBtn).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  // ── U7 — Cancel edit does not persist ─────────────────────────────────────

  test("U7 — cancelar edição não altera dados na tabela", async ({ page }) => {
    // Cria um usuário próprio e descartável em vez de editar a "primeira
    // linha" da tabela real de produção: este arquivo roda com workers=2 e
    // várias outras tests (U4, U10, U11...) também pegam linhas por índice
    // baixo (first/nth(1)/nth(2)) na mesma tabela ao vivo — colisão
    // confirmada empiricamente (o nome exibido na linha mudava para valor
    // de outro teste concorrente entre o cancelar e a verificação).
    const uid = Math.random().toString(36).slice(2, 8);
    const nome = `U7 Cancel Teste ${uid}`;
    const matricula = `U7${uid.toUpperCase()}`;

    // timeout explícito (default actionTimeout de 10s ocasionalmente insuficiente
    // sob carga do worker=2 rodando a suite completa contra produção — achado real,
    // ver git blame desta linha).
    await page.getByRole("button", { name: /cadastrar usuário/i }).click({ timeout: T.navigation });
    const createDialog = page.getByRole("dialog");
    await createDialog.getByLabel(/nome completo/i).fill(nome);
    await createDialog.getByLabel(/matrícula/i).fill(matricula);
    await createDialog.getByRole("button", { name: /^cadastrar usuário$/i }).click();
    // Confirmação é uma tela dentro do próprio dialog (não um toast) — mesmo
    // padrão de crud-usuarios-create.spec.ts U05.
    await expect(createDialog.getByText(/cadastrado com sucesso/i)).toBeVisible({ timeout: 10000 });
    await createDialog.getByRole("button", { name: /fechar/i }).click();

    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    const searchInput = page.getByPlaceholder(/buscar/i);
    await searchInput.fill(matricula);
    // navigateWithQuery faz router.replace com ?q= — dispara nova renderização
    // do Server Component; clicar "Ver em grade" ANTES da busca corria risco de
    // o modo cards (default) voltar após a navegação. Buscar primeiro, alternar
    // pra grade depois, garante que o modo grade é a última coisa aplicada.
    await searchInput.press("Enter");
    await page.locator('button[title="Ver em grade"]').click();

    const row = page.locator("tbody tr").filter({ hasText: matricula });
    await expect(row).toBeVisible({ timeout: 8000 });
    await row.locator('button[title="Editar"]').click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog.locator('input[id="edit-nome"]')).toHaveValue(nome);
    await dialog.locator('input[id="edit-nome"]').fill("Mudança Cancelada");

    await dialog.getByRole("button", { name: /cancelar/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // A linha (por matrícula, estável) não pode mostrar o valor editado.
    // Não comparamos com `nome` (nome_completo) porque a lista prioriza
    // posto+nome_de_guerra na exibição (_users-table.tsx) — o posto default
    // do dialog de criação ("Cadete") já é suficiente para a linha exibir
    // "cadete" em vez do nome_completo, o que é comportamento correto, não
    // uma falha deste teste.
    await expect(row).toBeVisible();
    await expect(row.getByText("Mudança Cancelada")).not.toBeVisible();
  });

  // ── U8 — Search filters results ───────────────────────────────────────────

  test("U8 — campo de busca presente", async ({ page }) => {
    const searchInput = page
      .getByPlaceholder(/buscar|pesquisar|search/i)
      .or(page.getByRole("searchbox"));
    await expect(searchInput.first()).toBeVisible({ timeout: 5000 });
  });

  test("U9 — busca com termo inexistente mostra empty state", async ({
    page,
  }) => {
    const searchInput = page
      .getByPlaceholder(/buscar|pesquisar|search/i)
      .or(page.getByRole("searchbox"));
    await expect(searchInput.first()).toBeVisible({ timeout: 5000 });

    // SearchInput (search-input.tsx) só filtra a lista de verdade (navigateWithQuery,
    // via ?q= na URL) ao pressionar Enter ou selecionar uma sugestão — digitar sozinho
    // só dispara o autocomplete (debounce 300ms, /api/admin/search-profiles). Sem o
    // Enter, a tabela nunca filtrava e o teste sempre falhava vendo os 62 usuários.
    await searchInput.first().fill("xyzabc123inexistente");
    await searchInput.first().press("Enter");

    await expect(
      page.getByText(/nenhum|vazio|não encontrado|sem resultado/i)
    ).toBeVisible({ timeout: 6000 });
  });

  // ── U10 — Posto dropdown mostra apenas sigla (sem " — Descrição") ──────────

  test("U10 — dropdown Posto exibe só sigla sem texto após hífen", async ({ page }) => {
    await waitForTableRows(page);
    await page.locator('button[title="Editar"]').first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const postoSelect = dialog.locator('select#edit-posto');
    await expect(postoSelect).toBeVisible();

    // Inspect the option labels: none should contain " — "
    const options = await postoSelect.locator('option').allTextContents();
    const withDash = options.filter((o) => o.includes(' — '));
    expect(withDash, `Options with " — ": ${withDash.join(', ')}`).toHaveLength(0);
  });

  // ── U11 — Editar usuário com posto de praça funciona sem erro ─────────────

  test("U11 — editar usuário selecionando posto 'Sd' salva sem erro", async ({ page }) => {
    await waitForTableRows(page);

    // Open edit for a non-admin user (second row to avoid self-edit issues)
    const editBtns = page.locator('button[title="Editar"]');
    const count = await editBtns.count();
    if (count < 2) {
      test.skip(true, "Precisa de ao menos 2 usuários para testar edição de não-admin");
      return;
    }
    await editBtns.nth(1).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Select posto "Sd" (Soldado)
    const postoSelect = dialog.locator('select#edit-posto');
    await postoSelect.selectOption({ value: "sd" });

    await dialog.getByRole("button", { name: /salvar/i }).click();

    await expectToast(page, /atualizado|sucesso/i);
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });
});
