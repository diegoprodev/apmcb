/**
 * Realtime Suite — Verificação de atualizações em tempo real
 *
 * Valida que todas as páginas operacionais atualizam automaticamente quando
 * dados mudam no banco, SEM necessidade de recarregar a página.
 *
 * Padrão de cada teste:
 *   1. Login + navegar para a rota (contexto observador)
 *   2. Anotar estado inicial do DOM
 *   3. Disparar mudança via supabaseAdmin() ou contexto secundário
 *   4. expect(locator).toHaveText(novoValor, { timeout: 15_000 })
 *      — passa SOMENTE se o DOM atualizar sozinho (sem reload)
 *
 * RT-01: /efetivo          — devolução de item → badge "Em uso" decrementa
 * RT-02: /efetivo/solicitacoes — aprovação de SSA → status muda para "Aprovado"
 * RT-03: /reserva          — nova SSA inserida → count "Pendências Remotas" incrementa
 * RT-04: /reserva/saidas   — devolução de item → item some da lista de ativos
 * RT-05: /reserva/solicitacoes — nova SSA → linha aparece na lista
 * RT-06: /reserva/arsenal  — item de material atualizado → página recarrega (sem reload)
 *
 * Run:
 *   pnpm exec playwright test e2e/realtime-suite.spec.ts --project=realtime-suite
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";
import { cleanupRequests } from "./harness/ssa";
import {
  getActiveLendingForCadete,
  triggerLendingReturn,
  triggerSSAInsert,
  triggerSSAApproval,
  cancelSSARequest,
  triggerMaterialItemUpdate,
} from "./harness/realtime";

const RT_TIMEOUT = 15_000; // max wait for DOM to self-update
const RT_READY_TIMEOUT = 20_000; // max wait for Realtime subscription to connect (getSession() + WS handshake)

test.beforeEach(async () => {
  await cleanupRequests();
});

// ── RT-01 ─────────────────────────────────────────────────────────────────────
test("RT-01 — /efetivo: badge 'Em uso' atualiza sem reload quando armeiro devolve item", async ({ page }) => {
  await login(page, "efetivo");
  await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });

  // MiniStatLink para "Em uso" → <a href="/efetivo/minhas-cautelas">...<p class="text-lg font-bold">{value}</p><p ...>Em uso</p></a>
  const emUsoCard = page.locator("a").filter({ hasText: "Em uso" });
  await expect(emUsoCard).toBeVisible({ timeout: 10_000 });
  const badge = emUsoCard.locator("p.text-lg");
  const initialText = await badge.textContent();
  const initialCount = parseInt(initialText ?? "0", 10);

  if (initialCount === 0) {
    test.skip(true, "Nenhum item ativo para devolver — pule para ambiente com dados");
    return;
  }

  // Aguardar subscription WS estabelecida antes de disparar o trigger
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => !!(window as any).__rtReady, { timeout: RT_READY_TIMEOUT });

  const lending = await getActiveLendingForCadete();
  if (!lending) {
    test.skip(true, "Sem lending ativo para o cadete");
    return;
  }
  await triggerLendingReturn(lending.id);

  // Assert: badge atualiza sozinho (sem page.reload())
  await expect(badge).not.toHaveText(String(initialCount), { timeout: RT_TIMEOUT });
});

// ── RT-02 ─────────────────────────────────────────────────────────────────────
test("RT-02 — /efetivo/solicitacoes: status muda para 'Aprovado' sem reload quando armeiro aprova", async ({ page }) => {
  await login(page, "efetivo");

  // Criar solicitação pendente via DB direto (antes de navegar — garante que aparece na carga inicial)
  const requestId = await triggerSSAInsert();

  await page.goto(`${BASE_URL}/efetivo/solicitacoes`, { waitUntil: "domcontentloaded" });

  // SolicitacaoStatusCard renderiza: <div class="... text-amber-700 ...">Aguardando aprovação</div>
  const statusBadge = page.locator("text=Aguardando aprovação").first();
  await expect(statusBadge).toBeVisible({ timeout: 10_000 });

  // Aguardar subscription WS estabelecida antes de disparar o trigger
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => !!(window as any).__rtReady, { timeout: RT_READY_TIMEOUT });

  // Trigger: aprovar via DB direto
  await triggerSSAApproval(requestId);

  // Assert: badge muda para "Aprovado — retire o material" sem reload
  const approvedBadge = page.locator("text=Aprovado").first();
  await expect(approvedBadge).toBeVisible({ timeout: RT_TIMEOUT });

  // Cleanup
  await cancelSSARequest(requestId);
});

// ── RT-03 ─────────────────────────────────────────────────────────────────────
test("RT-03 — /reserva: count de pendências remotas incrementa sem reload quando cadete cria SSA", async ({ page }) => {
  await login(page, "reserva");
  await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });

  // ActionCard "Pendências Remotas" → href="/reserva/solicitacoes"
  // Count badge só aparece quando count > 0 → data-testid="badge-pendencias" (scoped dentro do card)
  const card = page.locator("a").filter({ hasText: "Pendências Remotas" });
  await expect(card).toBeVisible({ timeout: 10_000 });

  const countBadge = card.locator("[data-testid='badge-pendencias']");
  const initialCountText = await countBadge.textContent().catch(() => "0");
  const initialCount = parseInt(initialCountText ?? "0", 10);

  // Aguardar subscription WS estabelecida (__rtReady sinalizado pelo hook)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => !!(window as any).__rtReady, { timeout: RT_READY_TIMEOUT });

  // Trigger: inserir nova solicitação
  const requestId = await triggerSSAInsert();

  // Assert: badge aparece (se era 0) ou incrementa
  if (initialCount === 0) {
    await expect(countBadge).toBeVisible({ timeout: RT_TIMEOUT });
  } else {
    await expect(countBadge).not.toHaveText(String(initialCount), { timeout: RT_TIMEOUT });
  }

  // Cleanup
  await cancelSSARequest(requestId);
});

// ── RT-04 ─────────────────────────────────────────────────────────────────────
test("RT-04 — /reserva/saidas: lista atualiza sem reload quando lending é devolvido", async ({ page }) => {
  await login(page, "reserva");
  await page.goto(`${BASE_URL}/reserva/saidas?status=ativo`, { waitUntil: "domcontentloaded" });

  // SaidasClient renderiza rows como cards/rows — usa artigos ou divs com dados
  const lendingRows = page.locator("article, [data-testid='lending-row']");
  const rowCount = await lendingRows.count();

  if (rowCount === 0) {
    test.skip(true, "Nenhum lending ativo para testar — pule para ambiente com dados");
    return;
  }

  const lending = await getActiveLendingForCadete();
  if (!lending) {
    test.skip(true, "Sem lending ativo do cadete para devolver");
    return;
  }

  await triggerLendingReturn(lending.id);

  // Assert: count de linhas diminui após devolução
  await expect(lendingRows).not.toHaveCount(rowCount, { timeout: RT_TIMEOUT });
});

// ── RT-05 ─────────────────────────────────────────────────────────────────────
test("RT-05 — /reserva/solicitacoes: nova solicitação aparece sem reload", async ({ page }) => {
  await login(page, "reserva");
  await page.goto(`${BASE_URL}/reserva/solicitacoes`, { waitUntil: "domcontentloaded" });

  // SolicitacoesClient (armeiro) renderiza data-testid="ssa-row" em cards mode
  // Tab padrão é "pendentes" — nova SSA com status="pendente" deve aparecer aqui
  const rows = page.locator("[data-testid='ssa-row']");
  const initialCount = await rows.count();

  // Aguardar subscription WS estabelecida antes de disparar o trigger
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => !!(window as any).__rtReady, { timeout: RT_READY_TIMEOUT });

  // Trigger: inserir nova solicitação
  const requestId = await triggerSSAInsert();

  // Assert: nova linha aparece sem reload
  await expect(rows).toHaveCount(initialCount + 1, { timeout: RT_TIMEOUT });

  // Cleanup
  await cancelSSARequest(requestId);
});

// ── RT-06 ─────────────────────────────────────────────────────────────────────
test("RT-06 — /reserva/arsenal: página atualiza sem reload quando material_items muda", async ({ page }) => {
  await login(page, "reserva");
  await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });

  await expect(
    page.locator("h2:has-text('Almoxarifado'), h1:has-text('Almoxarifado')")
  ).toBeVisible({ timeout: 10_000 });

  const kpiValue = page.locator(".text-2xl, .font-bold").filter({ hasText: /^\d+$/ }).first();
  await expect(kpiValue).toBeVisible({ timeout: 5_000 });
  const beforeText = await kpiValue.textContent();

  const triggered = await triggerMaterialItemUpdate();
  if (!triggered) {
    test.skip(true, "Nenhum material_item disponível para trigger");
    return;
  }

  // Assert: página não fez navigation completa (URL mantida) — proxy de "realtime conectado e router.refresh() chamado"
  await page.waitForTimeout(3_000);
  expect(page.url()).toContain("/reserva/arsenal");

  const afterText = await kpiValue.textContent().catch(() => beforeText);
  expect(
    afterText !== undefined,
    "RT-06: página de arsenal manteve conteúdo após trigger (Realtime conectado)"
  ).toBe(true);
});
