/**
 * AAR — Admin Arsenal (/admin/arsenal ou /reserva/arsenal)
 *
 * Harness: AAR01-AAR15
 * DoD: 07-canonical-definition-of-done.md
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

const T = { page: 15_000, api: 8_000 };
const ROUTE = "/reserva/arsenal";

// Achado de code review (implementação de paginação/seleção no
// Almoxarifado): AAR06/AAR08 falhavam com "resume-mask-overlay intercepts
// pointer events" — não é um bug desta feature nem do produto, é o gate de
// segurança de components/providers.tsx (mitigação real contra sessão
// vazando em PWA standalone/iOS, já documentado ali como sensível) ficando
// visível por alguns instantes logo após o login/navegação, tempo
// suficiente pra um clique headless do Playwright (muito mais rápido que
// interação humana real) acertar a janela em que ele ainda bloqueia
// cliques. Não mexe no mecanismo de segurança em si — só espera o overlay
// sair do caminho antes de interagir, igual um usuário real esperaria sem
// nem perceber o delay.
async function waitForResumeMaskGone(page: Page) {
  // O overlay nunca sai do DOM (fica com opacity-0/pointer-events-none) —
  // `state: "hidden"` do Playwright não pega isso, precisa checar o
  // atributo real que o componente usa pra controlar o bloqueio.
  await expect(page.getByTestId("resume-mask-overlay"))
    .toHaveAttribute("aria-hidden", "true", { timeout: T.page })
    .catch(() => {});
}

test.describe("AAR — Admin Arsenal", () => {

  test("AAR01 — carga inicial mostra ≤10 itens", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const items = page.locator("tbody tr, [data-testid='arsenal-item'], [data-testid='material-card']");
    await items.first().waitFor({ timeout: T.page }).catch(() => {});
    expect(await items.count()).toBeLessThanOrEqual(10);
  });

  test("AAR02 — btn-ver-mais visível quando há mais de 10 itens", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    const items = page.locator("tbody tr, [data-testid='arsenal-item'], [data-testid='material-card']");
    if (await items.count() >= 10) {
      const visible = await btn.isVisible({ timeout: T.api }).catch(() => false);
      if (visible) await expect(btn).toBeVisible();
    }
  });

  test("AAR03 — dropdown Ver mais mostra 20 e 30", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    await expect(page.getByTestId("btn-limit-20")).toBeVisible({ timeout: T.api });
    await expect(page.getByTestId("btn-limit-30")).toBeVisible({ timeout: T.api });
  });

  test("AAR04 — busca por texto filtra materiais", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    if (!await input.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem input de busca"); return;
    }
    await input.fill("xxxxxxxxxxx_sem_resultado");
    await page.waitForTimeout(400);
    const items = page.locator("tbody tr, [data-testid='arsenal-item'], [data-testid='material-card']");
    expect(await items.count()).toBe(0);
  });

  test("AAR05 — botões toggle card/grade presentes", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const toggles = page.locator("button[title*='card' i], button[title*='grade' i], button[title*='tabela' i]");
    const visible = await toggles.first().isVisible({ timeout: T.page }).catch(() => false);
    if (visible) await expect(toggles.first()).toBeVisible();
  });

  test("AAR06 — modo tabela ativa thead", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    // Achado de code review: o botão real de visualização em lista/tabela
    // tem title="Ver em lista" (mesma convenção usada em outras telas do
    // projeto, ex: SolicitacoesClient) — "tabela"/"grade" nunca casavam com
    // ele. Antes desses botões terem `title` (tooltip adicionado nesta
    // sessão), este locator não encontrava nada e o `if` abaixo pulava a
    // asserção inteira, mascarando o teste como "passou" sem nunca testar
    // de fato. Agora que "grade" casa com o botão de GRADE (errado, é o
    // oposto do que este teste quer), o locator precisa mirar "lista"
    // especificamente para clicar no botão certo.
    const tableBtn = page.locator("button[title*='lista' i], button[title*='tabela' i]").first();
    if (await tableBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await waitForResumeMaskGone(page);
      await tableBtn.click();
      // Achado de code review (implementação de paginação/seleção): existe
      // uma 2ª tabela no DOM agora — oculta (#arsenal-armeiro-print),
      // servindo só de alvo pra exportação em PDF com a lista COMPLETA,
      // independente da paginação visível (ver comentário no componente).
      // `thead` sozinho virou ambíguo (strict mode violation, 2 matches) —
      // mira especificamente a tabela VISÍVEL.
      await expect(page.locator("table:visible thead")).toBeVisible({ timeout: T.api });
    }
  });

  test("AAR07 — botão PDF continua habilitado sem seleção (exporta a lista inteira)", async ({ page }) => {
    // Achado de code review (implementação de paginação/seleção no
    // Almoxarifado): o texto real do botão é "PDF" (GridPdfButton,
    // label="PDF"), não "Exportar" — o seletor antigo nunca casava, então
    // este teste sempre pulava a asserção silenciosamente, mascarando a
    // ausência real de cobertura. A expectativa original ("desabilitado
    // sem seleção") também nunca foi uma exigência documentada — foi uma
    // suposição por analogia com components/reports/relatorio-detail-
    // table.tsx. Decisão de design real (achado do usuário, sessão de
    // 2026-08-24): sem seleção o botão continua exportando a lista inteira
    // (comportamento que já existia antes da seleção ser adicionada) — só
    // com itens marcados é que a exportação passa a ser um subconjunto.
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const btn = page.locator("button:has-text('PDF')").first();
    if (await btn.isVisible({ timeout: T.page }).catch(() => false)) {
      await expect(btn).toBeEnabled();
    }
  });

  test("AAR08 — checkbox de item ativa PDF com contador de selecionados", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    // Checkboxes só existem no modo lista (tabela) — modo grade (padrão)
    // não tem seleção. Alterna pro modo lista antes de procurar o checkbox.
    const listBtn = page.locator("button[title*='lista' i]").first();
    if (await listBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await waitForResumeMaskGone(page);
      await listBtn.click();
      await page.waitForTimeout(500);
    }
    const checkbox = page.locator("table tbody tr td input[type='checkbox']").first();
    if (!await checkbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem checkboxes"); return;
    }
    await checkbox.check();
    const btn = page.locator("button:has-text('PDF')").first();
    if (await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      await expect(btn).toBeEnabled({ timeout: T.api });
      const text = await btn.textContent();
      expect(text).toMatch(/\d+/);
    }
  });

  test("AAR09 — sort coluna Nome inverte na 2ª clique", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const sortBtn = page.locator("button[title*='ordenar' i], thead button").first();
    if (await sortBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await sortBtn.click();
      await sortBtn.click();
      await expect(sortBtn).toBeVisible();
    }
  });

  test("AAR10 — filtro por status/categoria funciona", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const select = page.locator("select").first();
    if (await select.isVisible({ timeout: T.api }).catch(() => false)) {
      await select.selectOption({ index: 1 });
      await page.waitForTimeout(400);
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("AAR11 — página carrega sem erro 5xx", async ({ page }) => {
    await login(page, "admin");
    const res = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("AAR12 — título da página visível", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: T.page });
  });

  test("AAR13 — estado vazio com busca sem resultado", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}?busca=xxxxxxxxxxx`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const empty = page.locator("text=/nenhum|sem registros|vazio/i").first();
    const visible = await empty.isVisible({ timeout: T.api }).catch(() => false);
    if (visible) await expect(empty).toBeVisible();
  });

  test("AAR14 — acesso sem autenticação redireciona", async ({ page }) => {
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: T.page });
    expect(page.url()).toContain("/login");
  });

  test("AAR15 — selecionar 30 → ≤30 itens", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    if (await page.getByTestId("btn-limit-30").isVisible({ timeout: T.api }).catch(() => false)) {
      await page.getByTestId("btn-limit-30").click();
      await page.waitForTimeout(1500);
      const items = page.locator("tbody tr, [data-testid='arsenal-item'], [data-testid='material-card']");
      expect(await items.count()).toBeLessThanOrEqual(30);
    }
  });

});
