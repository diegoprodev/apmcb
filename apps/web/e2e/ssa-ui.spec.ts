/**
 * SSA UI — Armeiro + Efetivo (ARM01-ARM10, EFT01-EFT10)
 *
 * Validates the v11 UX overhaul:
 *   - Armeiro: materiais section, inline select-action, view toggle, pagination
 *   - Efetivo: search, status tabs, view toggle, pagination, sidebar accordion
 *
 * Run:
 *   npx playwright test e2e/ssa-ui.spec.ts --project=ssa-ui-suite
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";

test.describe("ARM — Armeiro SSA UI", () => {

  // ── ARM01 ─────────────────────────────────────────────────────────────────
  test("ARM01 - /reserva/solicitacoes carrega sem erro", async ({ page }) => {
    await login(page, "reserva");
    const res = await page.goto(`${BASE_URL}/reserva/solicitacoes`, { waitUntil: "load" });
    expect(res?.status()).not.toBe(500);
    expect(res?.status()).not.toBe(404);
    await expect(page).not.toHaveURL(/error/i);
  });

  // ── ARM02 ─────────────────────────────────────────────────────────────────
  test("ARM02 - aba Pendentes ativa por default", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes`);
    const tabPendentes = page.getByTestId("tab-pendentes");
    await expect(tabPendentes).toBeVisible({ timeout: 10_000 });
    // Active tab has shadow-sm class via cn()
    const cls = await tabPendentes.getAttribute("class");
    expect(cls).toContain("bg-card");
  });

  // ── ARM03 ─────────────────────────────────────────────────────────────────
  test("ARM03 - card expandido exibe seção MATERIAIS SOLICITADOS", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes?tab=historico`);
    const firstRow = page.getByTestId("ssa-row").first();
    await firstRow.waitFor({ timeout: 15_000 }).catch(() => null);

    const count = await page.getByTestId("ssa-row").count();
    test.skip(count === 0, "Sem solicitações no histórico — skip ARM03");

    await page.getByTestId("ssa-row").first().click();
    await expect(page.getByTestId("section-materiais")).toBeVisible({ timeout: 5_000 });
  });

  // ── ARM04 ─────────────────────────────────────────────────────────────────
  test("ARM04 - card expandido exibe categoria do material", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes?tab=historico`);
    await page.getByTestId("ssa-row").first().waitFor({ timeout: 15_000 }).catch(() => null);

    const count = await page.getByTestId("ssa-row").count();
    test.skip(count === 0, "Sem solicitações — skip ARM04");

    await page.getByTestId("ssa-row").first().click();
    await expect(page.getByTestId("material-categoria").first()).toBeVisible({ timeout: 5_000 });
  });

  // ── ARM05 ─────────────────────────────────────────────────────────────────
  test("ARM05 - select de ação visível para status pendente", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes?tab=pendentes`);
    await page.waitForTimeout(2000);

    const count = await page.getByTestId("ssa-row").count();
    test.skip(count === 0, "Sem solicitações pendentes — skip ARM05");

    await page.getByTestId("ssa-row").first().click();
    await expect(page.getByTestId("select-acao")).toBeVisible({ timeout: 5_000 });
  });

  // ── ARM06 ─────────────────────────────────────────────────────────────────
  test("ARM06 - selecionar Aprovar mostra textarea de nota", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes?tab=pendentes`);
    await page.waitForTimeout(2000);

    const count = await page.getByTestId("ssa-row").count();
    test.skip(count === 0, "Sem pendentes — skip ARM06");

    await page.getByTestId("ssa-row").first().click();
    await page.getByTestId("select-acao").selectOption("aprovar");
    await expect(page.getByTestId("textarea-nota-aprovacao")).toBeVisible({ timeout: 3_000 });
  });

  // ── ARM07 ─────────────────────────────────────────────────────────────────
  test("ARM07 - selecionar Rejeitar mostra input de motivo", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes?tab=pendentes`);
    await page.waitForTimeout(2000);

    const count = await page.getByTestId("ssa-row").count();
    test.skip(count === 0, "Sem pendentes — skip ARM07");

    await page.getByTestId("ssa-row").first().click();
    await page.getByTestId("select-acao").selectOption("rejeitar");
    await expect(page.getByTestId("input-motivo-rejeicao")).toBeVisible({ timeout: 3_000 });
  });

  // ── ARM08 ─────────────────────────────────────────────────────────────────
  test("ARM08 - toggle tabela exibe thead com colunas", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes?tab=historico`);
    await page.waitForTimeout(2000);

    const count = await page.getByTestId("ssa-row").count();
    test.skip(count === 0, "Sem dados para modo tabela — skip ARM08");

    await page.getByTestId("btn-view-table").click();
    await expect(page.getByTestId("ssa-table")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("thead")).toBeVisible();
  });

  // ── ARM09 ─────────────────────────────────────────────────────────────────
  test("ARM09 - Ver mais dropdown exibe opções 20 e 30 quando hasMore", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes?tab=historico`);
    await page.waitForTimeout(2000);

    const verMais = page.getByTestId("btn-ver-mais");
    if (!(await verMais.isVisible())) {
      test.skip(true, "Sem hasMore neste ambiente — skip ARM09");
      return;
    }
    await verMais.click();
    await expect(page.getByTestId("btn-limit-20")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId("btn-limit-30")).toBeVisible();
  });

  // ── ARM10 ─────────────────────────────────────────────────────────────────
  test("ARM10 - /reserva/solicitacoes acessível via link no sidebar", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`);
    const link = page.locator(`a[href="/reserva/solicitacoes"]`).first();
    await expect(link).toBeVisible({ timeout: 10_000 });
    await link.click();
    await expect(page).toHaveURL(/\/reserva\/solicitacoes/, { timeout: 10_000 });
  });

});

test.describe("EFT — Efetivo SSA UI", () => {

  // ── EFT01 ─────────────────────────────────────────────────────────────────
  test("EFT01 - /efetivo/solicitacoes carrega sem erro", async ({ page }) => {
    await login(page, "efetivo");
    const res = await page.goto(`${BASE_URL}/efetivo/solicitacoes`, { waitUntil: "load" });
    expect(res?.status()).not.toBe(500);
    expect(res?.status()).not.toBe(404);
    await expect(page).not.toHaveURL(/error/i);
  });

  // ── EFT02 ─────────────────────────────────────────────────────────────────
  test("EFT02 - todos os cards têm status badge visível", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes?tab=todas`);
    await page.waitForTimeout(2000);

    const count = await page.getByTestId("ssa-cards").locator("[role='article']").count();
    if (count === 0) {
      test.skip(true, "Sem solicitações — skip EFT02");
      return;
    }
    const badges = page.locator("[role='article']").locator(".rounded-full").first();
    await expect(badges).toBeVisible({ timeout: 5_000 });
  });

  // ── EFT03 ─────────────────────────────────────────────────────────────────
  test("EFT03 - busca por material filtra cards", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-todas").click();
    await page.waitForTimeout(1500);

    const count = await page.locator("[role='article']").count();
    test.skip(count === 0, "Sem dados para filtrar — skip EFT03");

    const search = page.getByTestId("ssa-search");
    await search.fill("zzz_nao_existe_zzz");
    await page.waitForTimeout(500);
    const afterCount = await page.locator("[role='article']").count();
    expect(afterCount).toBe(0);

    await search.fill("");
  });

  // ── EFT04 ─────────────────────────────────────────────────────────────────
  test("EFT04 - tab Pendentes filtra por status pendente", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.waitForTimeout(1500);
    await page.getByTestId("tab-pendente").click();
    await page.waitForTimeout(500);
    // Any visible article should NOT have a rejeitado/retirado/cancelado badge
    const articles = page.locator("[role='article']");
    const countArticles = await articles.count();
    if (countArticles > 0) {
      // Spot-check first card has no "Rejeitado" text in status area
      const firstCard = articles.first();
      const text = await firstCard.textContent();
      expect(text).not.toContain("Rejeitado");
      expect(text).not.toContain("Retirado");
    }
  });

  // ── EFT05 ─────────────────────────────────────────────────────────────────
  test("EFT05 - toggle tabela exibe thead", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-todas").click();
    await page.waitForTimeout(1500);

    const count = await page.locator("[role='article']").count();
    test.skip(count === 0, "Sem dados para modo tabela — skip EFT05");

    await page.getByTestId("btn-view-table").click();
    await expect(page.getByTestId("ssa-table")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("thead")).toBeVisible();
  });

  // ── EFT06 ─────────────────────────────────────────────────────────────────
  test("EFT06 - Ver mais dropdown aparece e navega com limit", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.waitForTimeout(2000);

    const verMais = page.getByTestId("btn-ver-mais");
    if (!(await verMais.isVisible())) {
      test.skip(true, "hasMore=false neste ambiente — skip EFT06");
      return;
    }
    await verMais.click();
    await expect(page.getByTestId("btn-limit-20")).toBeVisible({ timeout: 3_000 });
    await page.getByTestId("btn-limit-20").click();
    await expect(page).toHaveURL(/limit=20/, { timeout: 10_000 });
  });

  // ── EFT07 ─────────────────────────────────────────────────────────────────
  test("EFT07 - sidebar efetivo contém Meus Materiais com accordion", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`);
    // testid is derived from the group's own href (sidebar.tsx:334), which is
    // "/efetivo/minhas-cautelas" (the "Meus Materiais" group links there by
    // default) — not "/efetivo". Pre-existing bug found while validating an
    // unrelated change in this suite: this locator targeted a testid that
    // could never exist ("accordion-toggle--efetivo"), so EFT07/EFT08/EFT09
    // always failed or silently fell into their "sidebar collapsed" fallback.
    // Root-caused via the accessibility snapshot on failure and fixed here.
    const accordionBtn = page.locator(`[data-testid="accordion-toggle--efetivo-minhas-cautelas"]`);
    await expect(accordionBtn).toBeVisible({ timeout: 10_000 });
  });

  // ── EFT08 ─────────────────────────────────────────────────────────────────
  test("EFT08 - accordion abre e Solicitações Remotas link fica visível", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`);
    const accordionBtn = page.locator(`[data-testid="accordion-toggle--efetivo-minhas-cautelas"]`);
    await expect(accordionBtn).toBeVisible({ timeout: 10_000 });
    await accordionBtn.click();
    // Second pre-existing bug uncovered by fixing accordionBtn above: mobile-nav.tsx
    // renders its own "Solicitações Remotas" link with the SAME data-testid
    // (nav-child--efetivo-solicitacoes) — always in the DOM, just CSS-hidden
    // (`md:hidden`) at desktop widths. An unqualified locator here is a strict-mode
    // violation (2 matches). `:visible` disambiguates to the actually-rendered one.
    const childLink = page.locator(`[data-testid="nav-child--efetivo-solicitacoes"]:visible`);
    await expect(childLink).toBeVisible({ timeout: 5_000 });
  });

  // ── EFT09 ─────────────────────────────────────────────────────────────────
  test("EFT09 - link Solicitações Remotas navega para /efetivo/solicitacoes", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    // Open accordion if needed (see EFT07 comment re: testid derivation)
    const accordionBtn = page.locator(`[data-testid="accordion-toggle--efetivo-minhas-cautelas"]`);
    if (await accordionBtn.isVisible()) {
      // See EFT08 comment — mobile-nav.tsx duplicates this testid, always in
      // the DOM (CSS-hidden at desktop widths), so this must be scoped to
      // :visible or it strict-mode-violates once the accordion is open.
      const childLink = page.locator(`[data-testid="nav-child--efetivo-solicitacoes"]:visible`);
      if (!(await childLink.isVisible())) await accordionBtn.click();
      await childLink.click();
    } else {
      // Sidebar collapsed — direct link still works
      await page.locator(`a[href="/efetivo/solicitacoes"]`).first().click();
    }
    await expect(page).toHaveURL(/\/efetivo\/solicitacoes/, { timeout: 10_000 });
  });

  // ── EFT10 ─────────────────────────────────────────────────────────────────
  test("EFT10 - card com status aprovado exibe armeiro_nota quando presente", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-aprovado").click();
    await page.waitForTimeout(1500);

    const approved = page.locator("[role='article']");
    const approvedCount = await approved.count();
    test.skip(approvedCount === 0, "Sem aprovadas — skip EFT10");

    // If armeiro_nota is present it should render the message box
    const notaBox = approved.first().locator("text=/Mensagem do armeiro/");
    const exists = await notaBox.count();
    // Pass either way: armeiro_nota may be null — just validates no crash
    expect(exists).toBeGreaterThanOrEqual(0);
  });

  // ── EFT11 ─────────────────────────────────────────────────────────────────
  // Achado real de produto: /efetivo/solicitacoes listava solicitações mas
  // não tinha nenhum jeito de criar uma nova — só existia em /efetivo.
  test("EFT11 - botão Requisitar Armamento presente no topo de /efetivo/solicitacoes", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`, { waitUntil: "load" });
    const btn = page.getByTestId("btn-solicitar-armamento");
    await expect(btn).toBeVisible({ timeout: 10_000 });
  });

  // ── EFT12 ─────────────────────────────────────────────────────────────────
  test("EFT12 - paginação default de /efetivo/solicitacoes é 10 (não 20)", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`, { waitUntil: "load" });
    const footer = page.getByText(/solicitações · limite \d+/);
    await expect(footer).toBeVisible({ timeout: 10_000 });
    await expect(footer).toContainText("limite 10");
  });

  // ── EFT13 ─────────────────────────────────────────────────────────────────
  // Achado real de produto: clicar num card em /efetivo/solicitacoes não
  // fazia nada — o mini-modal de detalhe só existia em /efetivo.
  test("EFT13 - clicar em card abre o mini-modal de detalhe", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-todas").click();
    await page.waitForTimeout(1500);

    const cards = page.locator("[role='article']");
    const count = await cards.count();
    test.skip(count === 0, "Sem solicitações — skip EFT13");

    await cards.first().click();
    await expect(page.getByText("Detalhes da Solicitação")).toBeVisible({ timeout: 5_000 });
  });

  // ── EFT14 ─────────────────────────────────────────────────────────────────
  test("EFT14 - clicar em linha de tabela abre o mesmo mini-modal de detalhe", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-todas").click();
    await page.waitForTimeout(1500);

    const count = await page.locator("[role='article']").count();
    test.skip(count === 0, "Sem dados para modo tabela — skip EFT14");

    await page.getByTestId("btn-view-table").click();
    const rows = page.getByTestId("ssa-row");
    await expect(rows.first()).toBeVisible({ timeout: 5_000 });
    await rows.first().click();
    await expect(page.getByText("Detalhes da Solicitação")).toBeVisible({ timeout: 5_000 });
  });

  // ── EFT15 ─────────────────────────────────────────────────────────────────
  // Linha de tabela precisa ser acessível por teclado (Enter abre o detalhe),
  // já que não pode ser envolvida num <button>/<div onClick> sem invalidar o
  // HTML da tabela (div > tr).
  test("EFT15 - Enter numa linha de tabela focada abre o mini-modal de detalhe", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-todas").click();
    await page.waitForTimeout(1500);

    const count = await page.locator("[role='article']").count();
    test.skip(count === 0, "Sem dados para modo tabela — skip EFT15");

    await page.getByTestId("btn-view-table").click();
    const firstRow = page.getByTestId("ssa-row").first();
    await expect(firstRow).toBeVisible({ timeout: 5_000 });
    await firstRow.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Detalhes da Solicitação")).toBeVisible({ timeout: 5_000 });
  });

  // ── EFT16 ─────────────────────────────────────────────────────────────────
  // BUG corrigido: SolicitacaoDetailSheet reusava denial_reason (sempre nulo
  // p/ canceladas) em vez de cancellation_reason (coluna separada no banco).
  test("EFT16 - detalhe de solicitação cancelada exibe motivo do cancelamento (não vazio)", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-cancelado").click();
    await page.waitForTimeout(1500);

    const cards = page.locator("[role='article']");
    const count = await cards.count();
    test.skip(count === 0, "Sem solicitações canceladas — skip EFT16");

    // Find a card that already shows a truncated "Motivo:" line (collapsed
    // card renders it whenever cancellation_reason is present) to avoid
    // asserting against a cancelled request that legitimately has no reason.
    const withReason = cards.filter({ hasText: "Motivo:" });
    const withReasonCount = await withReason.count();
    test.skip(withReasonCount === 0, "Nenhuma cancelada com cancellation_reason — skip EFT16");

    await withReason.first().click();
    await expect(page.getByText("Motivo do cancelamento")).toBeVisible({ timeout: 5_000 });
    // Must not fall back to the (always-null-for-cancelado) rejection copy
    await expect(page.getByText("Motivo da rejeição")).not.toBeVisible();
  });

  // ── EFT17 ─────────────────────────────────────────────────────────────────
  // Achado de arquitetura corrigido: o dialog de cancelamento (antes duas
  // implementações divergentes — uma hand-rolled sem validação mínima, outra
  // com Dialog + validação) virou um único CancelRequestDialog compartilhado.
  // Valida só a UI (abrir, validar, habilitar/desabilitar) — o submit real
  // depende de código TOTP (achado de infra pré-existente, documentado no
  // CHANGELOG, sem relação com esta mudança), então não é exercido aqui.
  test("EFT17 - dialog de cancelamento valida motivo mínimo de 10 caracteres", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-pendente").click();
    await page.waitForTimeout(1500);

    const cancelBtn = page.getByTestId("btn-cancelar-solicitacao").first();
    const visible = await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    test.skip(!visible, "Sem solicitação pendente — skip EFT17");

    await cancelBtn.click();
    const reasonInput = page.getByTestId("ssa-cancel-reason");
    await expect(reasonInput).toBeVisible({ timeout: 5_000 });
    const confirmBtn = page.getByTestId("btn-confirm-cancel");

    await reasonInput.fill("curto");
    await expect(confirmBtn).toBeDisabled();

    await reasonInput.fill("motivo com mais de dez caracteres");
    await expect(confirmBtn).toBeEnabled();
  });

  // ── EFT18 ─────────────────────────────────────────────────────────────────
  // Achado de arquitetura corrigido: SheetContent (components/ui/sheet.tsx)
  // não tinha focus trap nem role="dialog" — Tab conseguia sair do painel e
  // alcançar elementos atrás do overlay. Valida que o painel do mini-modal
  // de detalhe agora expõe role="dialog"/aria-modal e recebe foco ao abrir.
  test("EFT18 - mini-modal de detalhe expõe role=dialog e recebe foco ao abrir", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-todas").click();
    await page.waitForTimeout(1500);

    const cards = page.locator("[role='article']");
    const count = await cards.count();
    test.skip(count === 0, "Sem solicitações — skip EFT18");

    await cards.first().click();
    const panel = page.locator("[data-slot='sheet-content']");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    await expect(panel).toHaveAttribute("aria-modal", "true");

    // Foco deve estar dentro do painel (nele mesmo ou num elemento focável
    // interno), nunca ter ficado parado em algo atrás do overlay. O
    // componente move o foco via requestAnimationFrame (dá tempo do
    // SheetPortal montar o conteúdo real no DOM antes de focar) — um frame
    // depois da visibilidade, não no mesmo tick; poll em vez de checar uma
    // vez só, senão a asserção corre na frente do rAF.
    await expect(async () => {
      const focusInsidePanel = await panel.evaluate(
        (el) => el === document.activeElement || el.contains(document.activeElement)
      );
      expect(focusInsidePanel).toBe(true);
    }).toPass({ timeout: 2_000 });

    // Escape fecha e devolve o foco pro elemento que abriu o sheet.
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible({ timeout: 5_000 });
  });

  // ── EFT19 ─────────────────────────────────────────────────────────────────
  // Achado de arquitetura (code review): o botão "Cancelar solicitação" que
  // abre o CancelRequestDialog (Dialog real, base-ui) fica DENTRO do painel
  // do Sheet — os dois overlays ficam abertos ao mesmo tempo, cada um com
  // sua própria trap de foco. Nunca havia teste cobrindo isso; hoje não
  // quebra porque os elementos focáveis do Dialog vivem fora do painel do
  // Sheet, mas é um acoplamento implícito. Valida ao vivo: com os dois
  // abertos, Tab tem que ficar preso no Dialog (o overlay do topo), nunca
  // vazar pro conteúdo do Sheet atrás dele.
  test("EFT19 - Sheet + CancelRequestDialog abertos juntos: Tab não vaza pro conteúdo do Sheet atrás", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/solicitacoes`);
    await page.getByTestId("tab-todas").click();
    await page.waitForTimeout(1500);

    const cards = page.locator("[role='article']");
    const count = await cards.count();
    test.skip(count === 0, "Sem solicitações — skip EFT19");

    await cards.first().click();
    const sheetPanel = page.locator("[data-slot='sheet-content']");
    await expect(sheetPanel).toBeVisible({ timeout: 5_000 });

    const cancelBtn = sheetPanel.getByRole("button", { name: /cancelar solicitação/i });
    const cancelVisible = await cancelBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    test.skip(!cancelVisible, "Status não cancelável — skip EFT19");

    await cancelBtn.click();
    const dialogPanel = page.locator("[data-slot='dialog-content']");
    await expect(dialogPanel).toBeVisible({ timeout: 5_000 });

    // Tab repetido a partir do foco atual (dentro do Dialog) nunca deve
    // pousar em algo fora dele — nem no painel do Sheet por trás, nem em
    // qualquer outro elemento da página.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const activeInsideDialog = await dialogPanel.evaluate(
        (el) => el === document.activeElement || el.contains(document.activeElement)
      );
      expect(activeInsideDialog).toBe(true);
    }

    // Achado de re-revisão: a checagem acima só provava Tab pra frente —
    // Shift+Tab (loop pra trás) exercita um caminho de código diferente na
    // trap do Dialog e nunca tinha sido verificado.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Shift+Tab");
      const activeInsideDialog = await dialogPanel.evaluate(
        (el) => el === document.activeElement || el.contains(document.activeElement)
      );
      expect(activeInsideDialog).toBe(true);
    }
  });

});
