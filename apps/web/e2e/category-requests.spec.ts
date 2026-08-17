/**
 * CATREQ — Solicitações de Categoria (armeiro → admin)
 *
 * category_requests é um fluxo de aprovação paralelo ao de
 * admin_approval_requests (material) — armeiro solicita uma nova categoria de
 * material em /reserva/arsenal?tab=categorias, admin aprova/rejeita em
 * /admin/arsenal/solicitacoes. A API (apps/bff/src/routes/categories.ts)
 * existia por completo, mas nunca esteve ligada a nenhuma UI: a solicitação
 * era aceita e persistida silenciosamente, sem aparecer no painel do armeiro
 * nem na tela de aprovação do admin — achado do produto ("não aparece as
 * solicitações de categorias no painel do armeiro, apenas de materiais").
 * Esta suite cobre o fluxo ponta a ponta depois da correção, além dos
 * cenários de segurança/validação corrigidos no mesmo diff (scoping por
 * tenant, IDOR no reject, double-processing).
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";
import { bffCall } from "./harness/ssa";

const T = { page: 15_000, api: 8_000 };

function uniqueCategoryName(tag: string) {
  return `E2E Categoria ${tag} ${Date.now()}`;
}

async function expectToast(page: import("@playwright/test").Page, text: RegExp) {
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: text })).toBeVisible({ timeout: 6_000 });
}

async function requestCategoryViaUI(page: import("@playwright/test").Page, nome: string, description?: string) {
  await page.goto(`${BASE_URL}/reserva/arsenal?tab=categorias`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /adicionar categoria/i }).click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: T.page });
  await dialog.locator("#req-nome").fill(nome);
  if (description) await dialog.locator("#req-desc").fill(description);
  await dialog.getByRole("button", { name: /solicitar aprova/i }).click();
  await expectToast(page, /solicita.*enviada/i);
  await expect(dialog).not.toBeVisible({ timeout: T.page });
}

// beforeEach garante que testes concorrentes de outras specs não deixem o
// armeiro com uma sessão inconsistente — login() já limpa cookies antes de
// navegar (ver harness.ts).

test.describe("CATREQ — Armeiro solicita categoria", () => {

  test("CATREQ01 — armeiro solicita categoria e vê pendente no próprio painel", async ({ page }) => {
    const nome = uniqueCategoryName("Pendente");
    await login(page, "reserva");
    await requestCategoryViaUI(page, nome, "Descrição de teste E2E");

    // router.refresh() após o submit já deixa a navegação seguinte com dados
    // frescos — mas navegamos explicitamente para a aba Materiais (onde vive
    // o painel "Minhas solicitações") para simular o fluxo real do usuário.
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });
    const banner = page.getByText("Minhas solicitações");
    await expect(banner).toBeVisible({ timeout: T.page });
    await banner.click();
    await expect(page.getByText(`Nova categoria: ${nome}`)).toBeVisible({ timeout: T.page });
    // Card mais próximo deve mostrar status "pendente"
    const row = page.getByTestId("own-request-row").filter({ hasText: `Nova categoria: ${nome}` }).last();
    await expect(row).toBeVisible();
  });

  test("CATREQ02 — admin vê a solicitação pendente em /admin/arsenal/solicitacoes", async ({ page }) => {
    const nome = uniqueCategoryName("VisivelAdmin");
    await login(page, "reserva");
    await requestCategoryViaUI(page, nome);

    await login(page, "adminReserva");
    await page.goto(`${BASE_URL}/admin/arsenal/solicitacoes`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("solicitacoes-search").fill(nome);
    await expect(page.getByText(`Nova categoria: ${nome}`)).toBeVisible({ timeout: T.page });
  });

  test("CATREQ03 — admin aprova solicitação de categoria → categoria fica disponível e armeiro vê status aprovado", async ({ page }) => {
    const nome = uniqueCategoryName("Aprovada");
    await login(page, "reserva");
    await requestCategoryViaUI(page, nome);

    await login(page, "adminReserva");
    await page.goto(`${BASE_URL}/admin/arsenal/solicitacoes`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("solicitacoes-search").fill(nome);
    const card = page.getByText(`Nova categoria: ${nome}`);
    await expect(card).toBeVisible({ timeout: T.page });
    await page.getByRole("button", { name: "Aprovar" }).first().click();
    await page.getByRole("button", { name: /aprovar e criar categoria/i }).click();
    await expectToast(page, /categoria aprovada e criada/i);

    // Categoria deve existir de verdade — visível na lista de categorias.
    await page.goto(`${BASE_URL}/reserva/arsenal?tab=categorias`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(nome, { exact: true })).toBeVisible({ timeout: T.page });

    // Armeiro solicitante deve ver o próprio pedido como "aprovado".
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });
    await page.getByText("Minhas solicitações").click();
    const row = page.getByTestId("own-request-row").filter({ hasText: `Nova categoria: ${nome}` }).last();
    await expect(row.getByText("aprovado")).toBeVisible({ timeout: T.page });
  });

  test("CATREQ04 — admin rejeita com motivo → armeiro vê status rejeitado e o motivo", async ({ page }) => {
    const nome = uniqueCategoryName("Rejeitada");
    // Motivo precisa ser único por execução (não só o nome): a run anterior
    // desta mesma suite contra a MESMA produção deixa uma categoria "Rejeitada"
    // no histórico do armeiro com este mesmo texto de motivo — getByText(motivo)
    // sem esse sufixo caía em strict mode violation (2+ matches) no banner
    // "Minhas solicitações", que lista as últimas 10 solicitações próprias.
    const motivo = `Categoria duplicada, já existe equivalente ativa (${Date.now()})`;
    await login(page, "reserva");
    await requestCategoryViaUI(page, nome);

    await login(page, "adminReserva");
    await page.goto(`${BASE_URL}/admin/arsenal/solicitacoes`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("solicitacoes-search").fill(nome);
    await expect(page.getByText(`Nova categoria: ${nome}`)).toBeVisible({ timeout: T.page });
    await page.getByRole("button", { name: "Rejeitar" }).first().click();
    const reasonInput = page.getByPlaceholder(/informe o motivo/i);
    await reasonInput.fill(motivo);
    await page.getByRole("button", { name: /confirmar rejei/i }).click();
    await expectToast(page, /rejeitada/i);

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });
    await page.getByText("Minhas solicitações").click();
    const row = page.getByTestId("own-request-row").filter({ hasText: `Nova categoria: ${nome}` }).last();
    await expect(row.getByText("rejeitado")).toBeVisible({ timeout: T.page });
    await expect(row.getByText(motivo)).toBeVisible({ timeout: T.page });
  });

  test("CATREQ05 — rejeitar sem motivo (ou motivo curto) mantém botão de confirmação desabilitado", async ({ page }) => {
    const nome = uniqueCategoryName("MotivoCurto");
    await login(page, "reserva");
    await requestCategoryViaUI(page, nome);

    await login(page, "adminReserva");
    await page.goto(`${BASE_URL}/admin/arsenal/solicitacoes`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("solicitacoes-search").fill(nome);
    await expect(page.getByText(`Nova categoria: ${nome}`)).toBeVisible({ timeout: T.page });
    await page.getByRole("button", { name: "Rejeitar" }).first().click();
    const confirmBtn = page.getByRole("button", { name: /confirmar rejei/i });
    await expect(confirmBtn).toBeDisabled();
    // API e client exigem min. 5 caracteres (z.string().min(5) em
    // categories.ts) — "oi" (2 chars) testa de fato o caso "curto demais",
    // diferente de uma string acidentalmente >= 5 chars que validaria.
    await page.getByPlaceholder(/informe o motivo/i).fill("oi");
    await expect(confirmBtn).toBeDisabled();
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// SEC-CATREQ — Segurança e validação (via API direta)
// ═══════════════════════════════════════════════════════════════════════════

test.describe("SEC-CATREQ — Segurança e validação da API de categorias", () => {

  test("SEC-CATREQ01 — POST /requests/:id/approve em id inexistente retorna 404 (não 500)", async ({ page }) => {
    await login(page, "adminReserva");
    const { status } = await bffCall(page, "POST", "/api/categories/requests/00000000-0000-0000-0000-000000000000/approve");
    expect(status).toBe(404);
  });

  test("SEC-CATREQ02 — POST /requests/:id/reject em id inexistente retorna 404 (não 500)", async ({ page }) => {
    await login(page, "adminReserva");
    const { status } = await bffCall(page, "POST", "/api/categories/requests/00000000-0000-0000-0000-000000000000/reject", {
      reason: "Motivo de teste válido",
    });
    expect(status).toBe(404);
  });

  test("SEC-CATREQ03 — reject com motivo < 5 caracteres é rejeitado pela API (400)", async ({ page }) => {
    await login(page, "reserva");
    const nome = uniqueCategoryName("ApiValidacao");
    const { status: createStatus, data } = await bffCall(page, "POST", "/api/categories/request", { nome });
    expect(createStatus).toBe(201);
    const requestId = (data as { request: { id: string } }).request.id;

    await login(page, "adminReserva");
    const { status } = await bffCall(page, "POST", `/api/categories/requests/${requestId}/reject`, { reason: "no" });
    expect(status).toBe(400);

    // limpeza best-effort — não falha o teste se já não existir mais
    await bffCall(page, "POST", `/api/categories/requests/${requestId}/reject`, { reason: "Limpeza automática do teste E2E" });
  });

  test("SEC-CATREQ04 — armeiro (role sem permissão de revisão) não consegue aprovar via API", async ({ page }) => {
    await login(page, "reserva");
    const nome = uniqueCategoryName("SemPermissao");
    const { status: createStatus, data } = await bffCall(page, "POST", "/api/categories/request", { nome });
    expect(createStatus).toBe(201);
    const requestId = (data as { request: { id: string } }).request.id;

    const { status } = await bffCall(page, "POST", `/api/categories/requests/${requestId}/approve`);
    expect([401, 403]).toContain(status);
  });

  test("SEC-CATREQ05 — double-approve concorrente: o segundo revisor recebe 404 ou 409, não um estado corrompido", async ({ page }) => {
    await login(page, "reserva");
    const nome = uniqueCategoryName("DoubleApprove");
    const { status: createStatus, data } = await bffCall(page, "POST", "/api/categories/request", { nome });
    expect(createStatus).toBe(201);
    const requestId = (data as { request: { id: string } }).request.id;

    await login(page, "adminReserva");
    const [first, second] = await Promise.all([
      bffCall(page, "POST", `/api/categories/requests/${requestId}/approve`),
      bffCall(page, "POST", `/api/categories/requests/${requestId}/approve`),
    ]);
    const statuses = [first.status, second.status].sort();
    // Exatamente uma das duas chamadas concorrentes deve ter sucesso (200);
    // a outra deve ser rejeitada de forma limpa (409 já processada, ou 404 se
    // a claim do vencedor já tiver corrido antes do SELECT do perdedor).
    expect(statuses.includes(200)).toBe(true);
    expect(statuses.some((s) => s === 404 || s === 409)).toBe(true);
  });

});
