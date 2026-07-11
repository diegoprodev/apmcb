/**
 * REL — Relatório da Reserva de Armamento (/reserva/relatorios, /admin/relatorios)
 *
 * Cobre a modernização: autocomplete assíncrono de Usuário, busca nos dropdowns
 * pequenos (Material/Categoria/Calibre/Posto), paginação "Ver mais" 10→20→30,
 * seleção via checkbox + exportação em PDF (GridPdfButton), e o novo filtro
 * "Tipo de Registro" (Saídas / Cautelas / Livro de Serviço).
 *
 * Harness: REL01-REL16
 * DoD: 07-canonical-definition-of-done.md
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

const T = { page: 15_000, api: 8_000 };
const ROUTE = "/reserva/relatorios";
const ADMIN_ROUTE = "/admin/relatorios";
// A página de relatório sempre pode ter até 3 <table>: detalhe (paginado),
// "Resumo por Material" e "Solicitações ao Admin" — ambas sem paginação e
// fora do escopo dos testes de "Ver mais". `page.locator("tbody tr")" sem
// escopo soma as três; usar o id do detalhe (mesmo id de PRINT_TARGET_ID
// em page.tsx) evita contar linhas das outras tabelas.
const DETAIL_ROWS = "#relatorio-detail-table tbody tr";

test.describe("REL — Relatório da Reserva de Armamento", () => {

  // ── Regressão básica ────────────────────────────────────────────────────

  test("REL01 — página carrega sem erro 5xx", async ({ page }) => {
    await login(page, "reserva");
    const res = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("REL02 — título e KPIs visíveis", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Relatório da Reserva/i })).toBeVisible({ timeout: T.page });
    await expect(page.locator("text=Total saídas").first()).toBeVisible({ timeout: T.page });
  });

  test("REL03 — acesso sem autenticação redireciona", async ({ page }) => {
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: T.page });
    expect(page.url()).toContain("/login");
  });

  // ── Paginação 10→20→30 ("Ver mais") ─────────────────────────────────────

  test("REL04 — carga inicial mostra ≤10 linhas na tabela detalhada", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const rows = page.locator(DETAIL_ROWS);
    await rows.first().waitFor({ timeout: T.page }).catch(() => {});
    expect(await rows.count()).toBeLessThanOrEqual(10);
  });

  test("REL05 — Ver mais expande 10→20→30", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais' — menos de 10 registros no período padrão"); return;
    }
    await btn.click();
    await expect(page.getByTestId("btn-limit-20")).toBeVisible({ timeout: T.api });
    await expect(page.getByTestId("btn-limit-30")).toBeVisible({ timeout: T.api });

    await page.getByTestId("btn-limit-20").click();
    await page.waitForTimeout(500);
    expect(await page.locator(DETAIL_ROWS).count()).toBeLessThanOrEqual(20);

    if (await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      await btn.click();
      if (await page.getByTestId("btn-limit-30").isVisible({ timeout: T.api }).catch(() => false)) {
        await page.getByTestId("btn-limit-30").click();
        await page.waitForTimeout(500);
        expect(await page.locator(DETAIL_ROWS).count()).toBeLessThanOrEqual(30);
      }
    }
  });

  // ── Seleção via checkbox + Exportar PDF (GridPdfButton) ─────────────────

  test("REL06 — botão Exportar PDF desabilitado sem seleção", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const btn = page.locator("button:has-text('Exportar PDF')").first();
    if (await btn.isVisible({ timeout: T.page }).catch(() => false)) {
      await expect(btn).toBeDisabled();
    }
  });

  test("REL07 — checkbox de linha habilita Exportar PDF com contador", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const checkbox = page.locator("tbody input[type='checkbox']").first();
    if (!await checkbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem registros no período padrão"); return;
    }
    await checkbox.check();
    const btn = page.locator("button:has-text('Exportar PDF')").first();
    await expect(btn).toBeEnabled({ timeout: T.api });
    expect(await btn.textContent()).toMatch(/1/);
  });

  // ── Filtro "Tipo de Registro" (Saídas / Cautelas / Livro de Serviço) ─────

  test("REL08 — filtros avançados revelam 'Tipo de Registro'", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Filtros avançados").click();
    await expect(page.getByTestId("filter-tipo-registro")).toBeVisible({ timeout: T.api });
  });

  test("REL09 — tipo=cautelas troca as colunas da tabela detalhada", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}?tipo=cautelas`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await expect(page.locator("text=Cautelas — Detalhado").first()).toBeVisible({ timeout: T.page });
    await expect(page.locator("th:has-text('Emissão')").first()).toBeVisible({ timeout: T.api });
  });

  test("REL10 — tipo=livro troca as colunas da tabela detalhada", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}?tipo=livro`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await expect(page.locator("text=Livro de Serviço — Detalhado").first()).toBeVisible({ timeout: T.page });
    // Sem eventos do Livro no período padrão (mês corrente) para esta persona:
    // DetailTableShell renderiza o estado vazio ("Nenhum registro encontrado")
    // e nem chega a montar <table>/<th> — mesmo padrão defensivo de REL05.
    if (await page.locator("text=Nenhum registro encontrado").isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem eventos do Livro de Serviço no período padrão para esta persona"); return;
    }
    await expect(page.locator("th:has-text('Tipo de evento')").first()).toBeVisible({ timeout: T.api });
  });

  test("REL11 — tipo=cautelas não mostra 'Resumo por Material' (exclusivo de Saídas)", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}?tipo=cautelas`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await expect(page.locator("text=Resumo por Material")).toHaveCount(0);
  });

  // ── Autocomplete assíncrono de Usuário (AsyncComboBox) ───────────────────

  test("REL12 — autocomplete de Usuário faz busca assíncrona e permite selecionar", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Filtros avançados").click();
    const input = page.getByTestId("filter-usuario");
    if (!await input.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Campo de usuário não visível para o tipo padrão"); return;
    }
    await input.fill("Cadete");
    await page.waitForTimeout(900); // debounce (300ms) + resposta da API
    const option = page.getByTestId("filter-usuario-option").first();
    if (await option.isVisible({ timeout: T.api }).catch(() => false)) {
      await option.click();
      // Selecionado vira um chip com botão de limpar — o input de busca desaparece
      await expect(page.getByTestId("filter-usuario")).toHaveCount(0);
    }
  });

  test("REL13 — busca com menos de 2 caracteres não dispara fetch", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Filtros avançados").click();
    const input = page.getByTestId("filter-usuario");
    if (!await input.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Campo de usuário não visível"); return;
    }
    let requestFired = false;
    page.on("request", (req) => {
      if (req.url().includes("/api/admin/search-profiles") && req.url().includes("q=")) requestFired = true;
    });
    await input.fill("a");
    await page.waitForTimeout(600);
    expect(requestFired).toBe(false);
  });

  // ── Busca nos dropdowns pequenos (SearchableSelect) ──────────────────────

  test("REL14 — dropdown de Posto mostra campo de busca ao abrir", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Filtros avançados").click();
    const trigger = page.getByTestId("filter-posto");
    await expect(trigger).toBeVisible({ timeout: T.api });
    await trigger.click();
    await expect(page.getByPlaceholder("Buscar...").first()).toBeVisible({ timeout: T.api });
  });

  // ── /admin/relatorios recebeu o mesmo tratamento ─────────────────────────

  test("REL15 — /admin/relatorios também tem 'Tipo de Registro' e paginação", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ADMIN_ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    await page.getByText("Filtros avançados").click();
    await expect(page.getByTestId("filter-tipo-registro")).toBeVisible({ timeout: T.api });
    const rows = page.locator(DETAIL_ROWS);
    await rows.first().waitFor({ timeout: T.page }).catch(() => {});
    expect(await rows.count()).toBeLessThanOrEqual(10);
  });

  test("REL16 — /admin/relatorios sem autenticação redireciona", async ({ page }) => {
    await page.goto(`${BASE_URL}${ADMIN_ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: T.page });
    expect(page.url()).toContain("/login");
  });

});
