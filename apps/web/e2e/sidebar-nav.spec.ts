/**
 * Sidebar Navigation v14
 *
 * SDB-01..05: Hamburger mobile-only + hover-expand (aceternity-style,
 * framer-motion) no sidebar colapsado — substituiu tooltip por ícone (v13).
 *
 * Run:
 *   npx playwright test e2e/sidebar-nav.spec.ts --project=sidebar-nav
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";

// base-ui Tooltip.Popup usa data-slot="tooltip-content" (não necessariamente role=tooltip)
const TOOLTIP_SELECTOR = '[data-slot="tooltip-content"]';
// Delay configurado no TooltipProvider (300ms) + margem de animação
const TOOLTIP_APPEAR_MS = 800;

test.describe("SDB — Sidebar hamburger e tooltips", () => {

  // ── SDB-01 ────────────────────────────────────────────────────────────────
  test("SDB-01 - hamburger md:hidden não visível em desktop (1440px)", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    // O botão hamburger mobile tem aria-label="Abrir menu" e className="md:hidden"
    const hamburger = page.locator('button[aria-label="Abrir menu"]');
    await expect(hamburger).toHaveCount(1);
    // Em viewport 1440px com md:hidden, deve ser invisível (display:none)
    await expect(hamburger).toBeHidden();
  });

  // ── SDB-02 ────────────────────────────────────────────────────────────────
  test("SDB-02 - botão btn-sidebar-toggle (chevron) visível no desktop", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    await expect(page.getByTestId("btn-sidebar-toggle")).toBeVisible({ timeout: 10_000 });
  });

  // ── SDB-03 ────────────────────────────────────────────────────────────────
  test("SDB-03 - tooltip do chevron mostra 'Fechar menu lateral' quando sidebar aberto", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    const toggle = page.getByTestId("btn-sidebar-toggle");
    await toggle.hover();
    // Aguarda delay do TooltipProvider (300ms) + margem de animação
    await page.waitForTimeout(TOOLTIP_APPEAR_MS);

    // base-ui tooltip: usa data-slot="tooltip-content"
    const tooltip = page.locator(TOOLTIP_SELECTOR);
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    await expect(tooltip).toContainText("Fechar menu lateral");
  });

  // ── SDB-04 ────────────────────────────────────────────────────────────────
  test("SDB-04 - clicar chevron colapsa sidebar e tooltip muda para 'Abrir menu lateral'", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    const toggle = page.getByTestId("btn-sidebar-toggle");
    await toggle.click();

    // O sidebar novo expande no hover (rail w-16 vira w-56 com o mouse em
    // cima) — o clique deixa o cursor sobre o próprio toggle, dentro do
    // <aside>, então sem mover o mouse pra fora o hover-expand mascara o
    // colapso que acabou de ser fixado (pinnedOpen=false). Sai da área antes
    // de medir a largura.
    await page.mouse.move(800, 400);

    // Aguarda sidebar colapsar (w-16)
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-16/, { timeout: 3_000 });

    // Hover no chevron após colapso
    await toggle.hover();

    // Regressão (achado real): hover no PRÓPRIO toggle não deve disparar o
    // hover-expand do rail inteiro — sem isso, o rail vira w-56 e o botão
    // (que trocava de mx-auto pra order-2) se deslocava embaixo do cursor,
    // derrubando a tooltip abaixo. Se alguém reintroduzir esse bubbling,
    // esta asserção falha ANTES da tooltip, apontando a causa real.
    await expect(sidebar).toHaveClass(/w-16/, { timeout: 500 });

    await page.waitForTimeout(TOOLTIP_APPEAR_MS);

    const tooltip = page.locator(TOOLTIP_SELECTOR);
    await expect(tooltip).toBeVisible({ timeout: 3_000 });
    await expect(tooltip).toContainText("Abrir menu lateral");
  });

  // ── SDB-05 ────────────────────────────────────────────────────────────────
  // v14: sidebar novo expande a régua inteira no hover (framer-motion,
  // aceternity-style) em vez de mostrar tooltip por ícone — o rótulo real
  // aparece inline assim que o mouse entra no <aside>, tooltip por item
  // ficaria redundante/concorrente com essa expansão. Teste atualizado para
  // validar o comportamento novo: hover expande e revela o texto do link.
  test("SDB-05 - sidebar colapsado: hover expande a régua e revela o rótulo do link", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    // Colapsar (fixa pinnedOpen=false) e sair da área antes de medir
    await page.getByTestId("btn-sidebar-toggle").click();
    await page.mouse.move(800, 400);
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-16/, { timeout: 3_000 });

    const navLinks = sidebar.locator("nav a");
    const count = await navLinks.count();
    test.skip(count === 0, "Nenhum link de nav encontrado no sidebar colapsado");

    // Hover no primeiro link — dispara mouseenter no <aside>, expandindo a
    // régua (framer-motion width w-16→w-56) e revelando o rótulo do link.
    await navLinks.first().hover();
    await expect(sidebar).toHaveClass(/w-56/, { timeout: 3_000 });

    const label = navLinks.first().locator("span").last();
    await expect(label).toBeVisible({ timeout: 3_000 });
    const text = await label.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  // ── SDB-06 ────────────────────────────────────────────────────────────────
  // Achado de code review (2026-07-22): TooltipTrigger (@base-ui/react) sempre
  // renderiza seu próprio <button> — aninhar <Button>/<Link> dentro dele
  // produzia HTML inválido (<button><button> ou <button><a>) que o parser HTML
  // do browser corrige de um jeito diferente do que o React espera no
  // client, causando erro de hidratação #418 em TODO o dashboard (o Sidebar
  // renderiza na árvore de layout compartilhada). Corrigido via prop `render`
  // do TooltipTrigger. Este teste trava a regressão: reintroduzir o
  // aninhamento antigo (ou um Trigger novo com o mesmo antipadrão) gera
  // console.error mesmo que a interação visual continue parecendo normal.
  test("SDB-06 (regressão) - zero erros de console ao carregar e colapsar o sidebar", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });
    await page.waitForTimeout(500);

    // Colapsa o sidebar — monta os itens de nav no layout compacto (ícone-só)
    // pela primeira vez (caminho não exercido pelo estado inicial expandido).
    await page.getByTestId("btn-sidebar-toggle").click();
    // Mouse fica sobre o toggle (dentro do <aside>) após o clique — hover-expand
    // re-abriria a régua visualmente antes de medir o colapso fixado.
    await page.mouse.move(800, 400);
    const sidebar = page.locator("aside");
    await expect(sidebar).toHaveClass(/w-16/, { timeout: 3_000 });
    await page.waitForTimeout(500);

    const relevantErrors = consoleErrors.filter((e) => !e.includes("preload"));
    expect(relevantErrors, `Erros de console: ${relevantErrors.join(" | ")}`).toHaveLength(0);
  });

  // ── SDB-07 ────────────────────────────────────────────────────────────────
  // v14: Perfil/Sair mudaram do dropdown do header pro rodapé do sidebar no
  // desktop (header mantém o dropdown só como fallback mobile, md:hidden).
  // Sem este teste, perder o acesso a "Sair" no desktop passaria batido —
  // o dropdown do header ainda existe no DOM, só fica invisível.
  test("SDB-07 - card de perfil no rodapé do sidebar abre menu com Perfil e Sair", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });

    const trigger = page.getByTestId("sidebar-profile-trigger");
    await expect(trigger).toBeVisible({ timeout: 10_000 });
    await trigger.click();

    await expect(page.getByRole("menuitem", { name: "Perfil", exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("menuitem", { name: "Sair", exact: true })).toBeVisible();
  });

});
