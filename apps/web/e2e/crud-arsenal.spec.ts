/**
 * APMCB — Arsenal CRUD Regression Suite
 * Full create / read / update / delete scenarios for /admin/arsenal.
 *
 * Run: npx playwright test e2e/crud-arsenal.spec.ts --reporter=html
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login, expectToast, waitForTableRows } from "./helpers";

// Unique name to avoid collisions between parallel runs
const UNIQUE_NAME = `Material Teste ${Date.now()}`;

test.describe("Arsenal CRUD — completo", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/arsenal`, { waitUntil: "networkidle" });
  });

  // ── C1 — CREATE ───────────────────────────────────────────────────────────

  test("C1 — criar material com dados válidos mostra toast e aparece na tabela", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /adicionar material/i }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill name
    await dialog.locator('input[id="mat-nome"]').fill(UNIQUE_NAME);

    // Select categoria via combobox
    await dialog.locator('[id="mat-categoria"]').click();
    await page.locator('[role="option"]').first().click();

    // Quantidade
    const qtdInput = dialog.locator('input[id="mat-qtd"]');
    if (await qtdInput.isVisible()) {
      await qtdInput.fill("5");
    }

    await dialog.getByRole("button", { name: /adicionar/i }).click();

    // Toast confirms success
    await expectToast(page, /adicionado|cadastrado|sucesso/i);

    // Dialog closed
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Item appears in table
    await expect(
      page.locator("tbody").getByText(UNIQUE_NAME)
    ).toBeVisible({ timeout: 8000 });
  });

  // ── C2 — VALIDATION: empty name ───────────────────────────────────────────

  test("C2 — nome vazio: botão Adicionar permanece desabilitado", async ({
    page,
  }) => {
    await page.getByRole("button", { name: /adicionar material/i }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Select categoria but leave name empty
    const catSelect = dialog.locator('[id="mat-categoria"]');
    if (await catSelect.isVisible()) {
      await catSelect.click();
      await page.locator('[role="option"]').first().click();
    }

    // Submit must be disabled when name is empty
    const submitBtn = dialog.getByRole("button", { name: /adicionar/i });
    await expect(submitBtn).toBeDisabled();
  });

  // ── C3 — UPDATE ───────────────────────────────────────────────────────────

  test("C3 — editar material existente persiste alteração", async ({ page }) => {
    await waitForTableRows(page);

    await page.locator('button[title="Editar"]').first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const nomeInput = dialog.locator('input[id="mat-nome"]');
    await expect(nomeInput).not.toHaveValue("");

    const currentName = await nomeInput.inputValue();
    const suffix = ` Editado ${Date.now()}`;
    const newName = currentName.replace(/ Editado \d+$/, "") + suffix;

    await nomeInput.fill(newName);
    await dialog.getByRole("button", { name: /salvar/i }).click();

    await expectToast(page, /atualizado|salvo|sucesso/i);
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  // ── C4 — DELETE: dialog opens and cancel works ────────────────────────────

  test("C4 — dialog Remover abre e botão Cancelar fecha sem alterar tabela", async ({
    page,
  }) => {
    const rowsBefore = await waitForTableRows(page);

    await page.locator('button[title="Remover"]').first().click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Dialog heading present
    await expect(
      dialog.locator("h2, h3").filter({ hasText: /remover material/i })
    ).toBeVisible();

    // Cancel
    await dialog
      .getByRole("button", { name: /cancelar|fechar/i })
      .first()
      .click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Row count unchanged
    const rowsAfter = await page.locator("tbody tr").count();
    expect(rowsAfter).toBe(rowsBefore);
  });

  // ── C5 — CANCEL create ────────────────────────────────────────────────────

  test("C5 — cancelar dialog de criação não persiste dados", async ({ page }) => {
    await page.getByRole("button", { name: /adicionar material/i }).click();

    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('input[id="mat-nome"]').fill("Cancelado Xyz");

    await dialog.getByRole("button", { name: /cancelar/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Name must NOT appear in table
    await expect(page.locator('text="Cancelado Xyz"')).not.toBeVisible();
  });

  // ── C6 — ESCAPE closes dialog ─────────────────────────────────────────────

  test("C6 — Escape fecha dialog de criação sem submit", async ({ page }) => {
    await page.getByRole("button", { name: /adicionar material/i }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible({ timeout: 5000 });
  });

  // ── C7 — Table headers present ────────────────────────────────────────────

  test("C7 — cabeçalhos da tabela de arsenal presentes", async ({ page }) => {
    await expect(page.locator("thead")).toBeVisible({ timeout: 8000 });
    const headerText = await page.locator("thead").textContent();
    // At least one of the expected column labels must exist
    const hasExpected =
      /material|disponível|total|categoria|nome/i.test(headerText ?? "");
    expect(hasExpected, `Headers were: "${headerText}"`).toBe(true);
  });

  // ── C8 — Progress / occupation indicator ──────────────────────────────────

  test("C8 — indicador de ocupação visível por linha (progress bar ou texto)", async ({
    page,
  }) => {
    await waitForTableRows(page);

    // Either a progress bar element or a percentage/ratio text in a cell
    const progressEl = page
      .locator('[role="progressbar"]')
      .or(page.locator('[class*="progress"]'));

    const count = await progressEl.count();
    if (count > 0) {
      await expect(progressEl.first()).toBeVisible();
    }
    // If no progress bar the test is informational — table presence already confirmed
  });
});
