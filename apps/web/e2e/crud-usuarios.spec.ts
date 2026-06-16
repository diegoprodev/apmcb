/**
 * APMCB — Usuários CRUD Regression Suite
 * Full list / read / update / deactivate scenarios for /admin/usuarios.
 *
 * Run: npx playwright test e2e/crud-usuarios.spec.ts --reporter=html
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login, expectToast, waitForTableRows } from "./helpers";

test.describe("Usuários CRUD — completo", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "networkidle" });
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
    await waitForTableRows(page);
    await page.locator('button[title="Editar"]').first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const original = await dialog
      .locator('input[id="edit-nome"]')
      .inputValue();
    await dialog.locator('input[id="edit-nome"]').fill("Mudança Cancelada");

    await dialog.getByRole("button", { name: /cancelar/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Original name still visible in table
    await expect(page.locator(`text="${original}"`)).toBeVisible();
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

    await searchInput.first().fill("xyzabc123inexistente");
    await page.waitForTimeout(500);

    await expect(
      page.getByText(/nenhum|vazio|não encontrado|sem resultado/i)
    ).toBeVisible({ timeout: 6000 });
  });
});
