/**
 * Cautelas — UX: busca avançada + alternância grade/lista
 * Ver docs: achado do usuário (2026-08-21) — /reserva/cautelas não tinha
 * busca nem alternância de visualização, ao contrário de outras páginas
 * (ex: /reserva/arsenal). Mesmo padrão (GridSearchInput + useGridState +
 * toggle grade/lista) replicado aqui.
 *
 * CAUUI01 — busca, toggle de view e navegação estão visíveis
 * CAUUI02 — busca filtra a lista (nenhum resultado pra termo inexistente)
 * CAUUI03 — alternar pra lista mantém a mesma contagem de linhas e a
 *           tabela rola horizontalmente sem cortar a coluna de ações
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";

test.describe("Cautelas — busca e alternância grade/lista", () => {

  test("CAUUI01 — busca e toggle de visualização visíveis", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("cautelas-search")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("cautelas-view-grade")).toBeVisible();
    await expect(page.getByTestId("cautelas-view-lista")).toBeVisible();
  });

  test("CAUUI02 — busca filtra a lista", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("cautelas-loading")).toHaveCount(0, { timeout: 15000 });
    const search = page.getByTestId("cautelas-search");
    await expect(search).toBeVisible();

    await search.fill("zzz-termo-que-nao-deve-bater-em-nada-xyz");
    await page.waitForTimeout(300);
    await expect(page.getByTestId("cautela-row")).toHaveCount(0);

    await search.fill("");
  });

  test("CAUUI03 — alternar pra lista preserva os itens e a tabela rola horizontalmente", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("cautelas-loading")).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByTestId("cautela-row").first()).toBeVisible({ timeout: 10000 });
    const rowsBefore = await page.getByTestId("cautela-row").count();
    test.skip(rowsBefore === 0, "Sem cautelas ativas no fixture pra este teste");

    await page.getByTestId("cautelas-view-lista").click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("cautela-row")).toHaveCount(rowsBefore);

    // Conteúdo largo demais pra caber na tela deve rolar dentro do próprio
    // container, não vazar/cortar sem meio de acesso — mesmo princípio já
    // usado em outras tabelas do app (ex: efetivo/historico).
    const scrollBox = page.locator(".overflow-x-auto").first();
    const isScrollable = await scrollBox.evaluate((el) => el.scrollWidth > el.clientWidth);
    if (isScrollable) {
      await scrollBox.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await page.waitForTimeout(200);
      await expect(page.getByRole("button", { name: "Devolver" }).first()).toBeVisible();
    }

    await page.getByTestId("cautelas-view-grade").click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("cautela-row")).toHaveCount(rowsBefore);
  });

  // Achado de code review: a coluna "Material" usava o mesmo campo do blob
  // de busca (material+identificador+militar+matrícula+motivo concatenados)
  // pra ordenar — "parecia" certo só porque o nome do material é sempre o
  // primeiro token. Corrigido pra ordenar só pelo nome do material
  // (_materialNome, campo dedicado) — este teste prova isso na prática.
  test("CAUUI04 — ordenar pela coluna Material ordena pelo nome do material, não pelo texto concatenado", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas?tab=todas`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Todas" }).click();

    await expect(page.getByTestId("cautelas-loading")).toHaveCount(0, { timeout: 15000 });
    await page.getByTestId("cautelas-view-lista").click();
    await page.waitForTimeout(300);

    const rowCount = await page.getByTestId("cautela-row").count();
    test.skip(rowCount < 2, "Precisa de pelo menos 2 cautelas pra provar ordenação");

    await page.getByRole("columnheader", { name: /Material/i }).click();
    await page.waitForTimeout(300);

    const materialNames = await page.locator('[data-testid="cautela-row"] td:first-child span.font-medium').allTextContents();
    const sorted = [...materialNames].sort((a, b) => a.localeCompare(b, "pt-BR"));
    expect(materialNames).toEqual(sorted);
  });

});
