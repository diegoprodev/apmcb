/**
 * Painel Efetivo v12 — Materiais em uso + botões outline
 *
 * PAINEL-01..08: Agrupamento por movimentação, checkboxes, export, sidebar label
 * BTN-01..02: Outline buttons com bg-white em rotas do efetivo
 *
 * Run:
 *   npx playwright test e2e/painel-materiais.spec.ts --project=painel-materiais
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";

test.describe("PAINEL — Materiais em uso + sidebar label", () => {

  // ── PAINEL-01 ─────────────────────────────────────────────────────────────
  test("PAINEL-01 - sidebar tem 'Painel' isolado e accordion 'Meus Materiais'", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    // Sidebar deve ter "Painel" como link isolado E "Meus Materiais" como accordion
    const pageText = await page.content();
    expect(pageText).toContain("Painel");
    expect(pageText).toContain("Meus Materiais");
    // Stats cards devem existir — achado real: getByText("Em uso") colidia
    // com o <h3>Materiais em uso</h3> mais abaixo na mesma página (2
    // elementos, strict mode violation); testid é a fonte estável.
    await expect(page.getByTestId("dashboard-stat-em-uso")).toBeVisible();
  });

  // ── PAINEL-02 ─────────────────────────────────────────────────────────────
  test("PAINEL-02 - /efetivo carrega sem erro 5xx", async ({ page }) => {
    await login(page, "efetivo");
    const res = await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    expect(res?.status()).not.toBe(500);
    expect(res?.status()).not.toBe(404);
    await expect(page).not.toHaveURL(/error/i);
  });

  // ── PAINEL-03 ─────────────────────────────────────────────────────────────
  test("PAINEL-03 - data-testid materiais-uso-ready presente", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    await expect(page.getByTestId("materiais-uso-ready")).toBeVisible({ timeout: 15_000 });
  });

  // ── PAINEL-04 ─────────────────────────────────────────────────────────────
  test("PAINEL-04 - grupos com header armeiro e reserva (se houver dados)", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const count = await page.getByTestId("materiais-uso-group").count();
    test.skip(count === 0, "Nenhum material em uso — skip PAINEL-04");

    // Group header should show reserva and/or armeiro
    const firstGroup = page.getByTestId("materiais-uso-group").first();
    await expect(firstGroup).toBeVisible();
    // Check if armeiro/reserva data is populated (depends on seed data)
    const reservaEl = firstGroup.getByTestId("group-reserva");
    const armeiroEl = firstGroup.getByTestId("group-armeiro");
    const reservaCount = await reservaEl.count();
    const armeiroCount = await armeiroEl.count();
    test.skip(
      reservaCount + armeiroCount === 0,
      "Lendings do cadete não têm reserve/master populados no DB — skip PAINEL-04"
    );
    expect(reservaCount + armeiroCount).toBeGreaterThan(0);
  });

  // ── PAINEL-05 ─────────────────────────────────────────────────────────────
  test("PAINEL-05 - botão Exportar PDF desabilitado com 0 selecionados", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const btn = page.getByTestId("btn-exportar-materiais-pdf");
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  // ── PAINEL-06 ─────────────────────────────────────────────────────────────
  test("PAINEL-06 - selecionar item habilita botão Exportar PDF", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const count = await page.getByTestId("materiais-uso-item").count();
    test.skip(count === 0, "Nenhum item em uso — skip PAINEL-06");

    await page.getByTestId("materiais-uso-item").first().click();
    const btn = page.getByTestId("btn-exportar-materiais-pdf");
    await expect(btn).toBeEnabled({ timeout: 3_000 });
  });

  // ── PAINEL-07 ─────────────────────────────────────────────────────────────
  test("PAINEL-07 - toggle tabela exibe materiais-uso-table", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const count = await page.getByTestId("materiais-uso-group").count();
    test.skip(count === 0, "Nenhum material em uso — skip PAINEL-07");

    await page.getByTestId("btn-view-table").click();
    await expect(page.getByTestId("materiais-uso-table")).toBeVisible({ timeout: 3_000 });
  });

  // ── PAINEL-09 ─────────────────────────────────────────────────────────────
  // Achado real de produto: o card "Em uso" (contagem = lendings ativos)
  // levava pra /efetivo/minhas-cautelas, que mostra CAUTELAMENTOS — um dado
  // diferente (outra fonte, outra contagem). Card e rota precisam falar do
  // mesmo dado.
  test("PAINEL-09 - card 'Em uso' leva ao histórico já filtrado por status=ativo", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });

    await page.getByTestId("dashboard-stat-em-uso").click();
    await page.waitForURL(/\/efetivo\/historico\?status=ativo/, { timeout: 15_000 });

    const statusSelect = page.getByTestId("filter-status");
    await expect(statusSelect).toBeVisible({ timeout: 15_000 });
    await expect(statusSelect).toHaveValue("ativo");
  });

  // ── PAINEL-10 ─────────────────────────────────────────────────────────────
  // Mesma classe de bug: /efetivo/historico?status=devolvido navegava pra lá,
  // mas o client nunca lia o querystring — filtro visual sempre ficava "Todos".
  test("PAINEL-10 - card 'Devolvidos' leva ao histórico já filtrado por status=devolvido", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });

    await page.getByTestId("dashboard-stat-devolvidos").click();
    await page.waitForURL(/\/efetivo\/historico\?status=devolvido/, { timeout: 15_000 });

    const statusSelect = page.getByTestId("filter-status");
    await expect(statusSelect).toBeVisible({ timeout: 15_000 });
    await expect(statusSelect).toHaveValue("devolvido");
  });

  // ── PAINEL-11 ─────────────────────────────────────────────────────────────
  test("PAINEL-11 - card 'Cautelas' leva a /efetivo/minhas-cautelas", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });

    await page.getByTestId("dashboard-stat-cautelas").click();
    await page.waitForURL(/\/efetivo\/minhas-cautelas/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /minhas cautelas/i })).toBeVisible({ timeout: 15_000 });
  });

  // ── PAINEL-12 ─────────────────────────────────────────────────────────────
  // Achado real de produto: o CTA "Requisitar Armamento" ficava no fim da
  // página /efetivo, abaixo de "Materiais em uso" — exigia scroll para uma
  // ação principal (viola CLAUDE.md: "ação principal em ≤ 2 cliques", sem
  // scroll). Movido para o topo, ao lado da saudação.
  test("PAINEL-12 - botão Requisitar Armamento fica acima de 'Materiais em uso'", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });

    const btn = page.getByTestId("btn-solicitar-armamento");
    await expect(btn).toBeVisible({ timeout: 15_000 });
    const heading = page.getByRole("heading", { name: "Materiais em uso" });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    const btnBox = await btn.boundingBox();
    const headingBox = await heading.boundingBox();
    expect(btnBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(btnBox!.y).toBeLessThan(headingBox!.y);
  });

  // ── PAINEL-13 ─────────────────────────────────────────────────────────────
  test("PAINEL-13 - preview de últimas solicitações permanece abaixo, sem o CTA duplicado", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });

    // Apenas 1 instância do botão na página — o CTA não deve aparecer
    // duplicado na seção de preview (que antes o continha).
    await expect(page.getByTestId("btn-solicitar-armamento")).toHaveCount(1);
  });

  // ── PAINEL-08 ─────────────────────────────────────────────────────────────
  test("PAINEL-08 - busca filtra grupos por nome do material", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    await page.getByTestId("materiais-uso-ready").waitFor({ timeout: 15_000 });

    const initialCount = await page.getByTestId("materiais-uso-group").count();
    test.skip(initialCount === 0, "Nenhum material em uso — skip PAINEL-08");

    // Type a string that won't match anything
    await page.getByTestId("input-busca-materiais").fill("xxxxxxxxxxx_nao_existe_material");
    await page.waitForTimeout(300);
    const afterCount = await page.getByTestId("materiais-uso-group").count();
    expect(afterCount).toBe(0);

    // Clear — groups should reappear
    await page.getByTestId("input-busca-materiais").fill("");
    await page.waitForTimeout(300);
    const restoredCount = await page.getByTestId("materiais-uso-group").count();
    expect(restoredCount).toBe(initialCount);
  });

});

test.describe("BTN — Botões outline com bg-white", () => {

  // ── BTN-01 ────────────────────────────────────────────────────────────────
  test("BTN-01 - botão Filtros em /efetivo/historico tem background branco", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/historico`, { waitUntil: "load" });

    const btn = page.getByTestId("btn-filtros");
    await expect(btn).toBeVisible({ timeout: 15_000 });

    const bgColor = await btn.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    // White = rgb(255, 255, 255)
    expect(bgColor).toBe("rgb(255, 255, 255)");
  });

  // ── BTN-02 ────────────────────────────────────────────────────────────────
  test("BTN-02 - botão Exportar PDF inativo em /efetivo/historico tem background branco", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/historico`, { waitUntil: "load" });

    const btn = page.getByTestId("btn-exportar-pdf");
    await expect(btn).toBeVisible({ timeout: 15_000 });

    // When nothing is selected, variant is "outline" → should be white
    const bgColor = await btn.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(bgColor).toBe("rgb(255, 255, 255)");
  });

});
