/**
 * APMCB — Saídas / Empréstimos CRUD Regression Suite
 * Covers list, filters, new-lending form, and return flow.
 * Armeiro role throughout.
 *
 * Run: npx playwright test e2e/crud-saidas.spec.ts --reporter=html
 *
 * NOTE: The app uses "empréstimos" as the route segment
 * (e.g. /armeiro/emprestimos) but the UI labels may say "saídas".
 * Both patterns are handled below.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login, expectToast } from "./helpers";

test.describe("Saídas/Empréstimos CRUD — completo", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "armeiro");
  });

  // ── S1 — Lista carrega ────────────────────────────────────────────────────

  test("S1 — lista de empréstimos carrega heading", async ({ page }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: /empréstimos|saídas/i })
    ).toBeVisible({ timeout: 8000 });
  });

  test("S2 — tabela ou lista de empréstimos renderiza", async ({ page }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.locator("table").or(page.locator('[role="table"]'))
    ).toBeVisible({ timeout: 8000 });
  });

  // ── S3 — Filtros por status ───────────────────────────────────────────────

  test("S3 — filtros de status presentes (Todas, Ativas, Devolvidas)", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos`, {
      waitUntil: "networkidle",
    });

    // Each filter may be a button, tab, or link — look broadly
    const todas = page
      .getByRole("button", { name: /todas/i })
      .or(page.getByRole("tab", { name: /todas/i }))
      .or(page.getByText(/\bTodas\b/));
    const ativas = page
      .getByRole("button", { name: /ativas/i })
      .or(page.getByRole("tab", { name: /ativas/i }))
      .or(page.getByText(/\bAtivas\b/));
    const devolvidas = page
      .getByRole("button", { name: /devolvidas/i })
      .or(page.getByRole("tab", { name: /devolvidas/i }))
      .or(page.getByText(/\bDevolvidas\b/));

    await expect(todas.first()).toBeVisible({ timeout: 5000 });
    await expect(ativas.first()).toBeVisible({ timeout: 5000 });
    await expect(devolvidas.first()).toBeVisible({ timeout: 5000 });
  });

  test("S4 — filtro Ativas atualiza URL com status=ativo", async ({ page }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos`, {
      waitUntil: "networkidle",
    });

    const ativasBtn = page
      .getByRole("button", { name: /ativas/i })
      .or(page.getByRole("tab", { name: /ativas/i }))
      .first();

    await ativasBtn.click();
    await page.waitForURL(/status=ativo/, { timeout: 5000 });
    await expect(page).toHaveURL(/status=ativo/);
  });

  test("S5 — filtro Devolvidas atualiza URL com status=devolvido", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos`, {
      waitUntil: "networkidle",
    });

    const devolvidasBtn = page
      .getByRole("button", { name: /devolvidas/i })
      .or(page.getByRole("tab", { name: /devolvidas/i }))
      .first();

    await devolvidasBtn.click();
    await page.waitForURL(/status=devolvido/, { timeout: 5000 });
    await expect(page).toHaveURL(/status=devolvido/);
  });

  // ── S6 — Botão Nova Saída / Novo Empréstimo ───────────────────────────────

  test("S6 — botão Nova Saída leva ao formulário", async ({ page }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos`, {
      waitUntil: "networkidle",
    });

    const newBtn = page
      .getByRole("link", { name: /nova saída|novo empréstimo/i })
      .or(page.getByRole("button", { name: /nova saída|novo empréstimo/i }));

    await expect(newBtn.first()).toBeVisible({ timeout: 5000 });
    await newBtn.first().click();

    await expect(page).toHaveURL(/\/emprestimos\/novo/);
  });

  // ── S7 — Form novo empréstimo ─────────────────────────────────────────────

  test("S7 — form novo empréstimo exibe campos e botão desabilitado sem preenchimento", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos/novo`, {
      waitUntil: "networkidle",
    });

    await expect(
      page.getByRole("heading", { name: /novo empréstimo|nova saída/i })
    ).toBeVisible({ timeout: 8000 });

    // Submit must be disabled before any field is filled
    const submitBtn = page.getByRole("button", {
      name: /registrar|confirmar|criar/i,
    });
    await expect(submitBtn.first()).toBeDisabled();
  });

  test("S8 — link Voltar no formulário leva de volta à lista", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos/novo`, {
      waitUntil: "networkidle",
    });

    const backLink = page
      .getByRole("link", { name: /voltar/i })
      .or(page.locator('a[href*="/armeiro/emprestimos"]'))
      .first();

    if (await backLink.isVisible()) {
      await backLink.click();
      await expect(page).toHaveURL(/\/armeiro\/emprestimos$/);
    } else {
      // Some implementations use a back button or browser history
      await page.goBack();
      await expect(page).toHaveURL(/\/armeiro\/emprestimos/);
    }
  });

  // ── S9 — Devolução ────────────────────────────────────────────────────────

  test("S9 — empréstimos ativos mostram botão Devolver", async ({ page }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos?status=ativo`, {
      waitUntil: "networkidle",
    });

    const rows = page.locator("tbody tr");
    const count = await rows.count();

    if (count === 0) {
      // No active lendings — informational skip
      test.skip();
      return;
    }

    await expect(
      page.getByRole("button", { name: /devolver/i }).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("S10 — dialog devolução abre e Cancelar fecha sem alterar lista", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/armeiro/emprestimos?status=ativo`, {
      waitUntil: "networkidle",
    });

    const devolverBtn = page
      .getByRole("button", { name: /devolver/i })
      .first();

    if (!(await devolverBtn.isVisible())) {
      test.skip();
      return;
    }

    const rowsBefore = await page.locator("tbody tr").count();

    await devolverBtn.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    await dialog.getByRole("button", { name: /cancelar/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 5000 });

    // Row count unchanged
    const rowsAfter = await page.locator("tbody tr").count();
    expect(rowsAfter).toBe(rowsBefore);
  });

  // ── S11 — Lista de militares ──────────────────────────────────────────────

  test("S11 — página de militares carrega com tabela", async ({ page }) => {
    await page.goto(`${BASE_URL}/armeiro/militares`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: /militares/i })
    ).toBeVisible({ timeout: 8000 });
    await expect(
      page.locator("table").or(page.locator('[role="table"]'))
    ).toBeVisible({ timeout: 8000 });
  });

  test("S12 — painel armeiro exibe ao menos 3 action cards", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/armeiro`, { waitUntil: "networkidle" });

    const cards = page.locator('a[href^="/armeiro"]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });
});
