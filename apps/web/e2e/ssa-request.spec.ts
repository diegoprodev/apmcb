/**
 * SSA Request Spec — SR01–SR20
 *
 * Tests military-side request flow (Modo B):
 * available materials, submit, 1-active limit, UI wizard, cancel.
 *
 * Run:
 *   npx playwright test ssa-request.spec.ts --project=ssa-suite
 */

import { type Page, test, expect } from "@playwright/test";
import { BASE_URL, BFF_URL, login } from "./harness";
import {
  bffCall, setupTOTP, getTOTPCode,
  createMaterialRequest, cleanupRequests, getFirstAvailableMaterial,
} from "./harness/ssa";

test.beforeEach(async () => {
  await cleanupRequests();
});

// O sheet SolicitarArmamentoSheet começa no step "reserve" (combobox) e só
// pula direto para "materials" quando /api/reserves/mine retorna exatamente
// 1 reserva acessível. Como o tenant de teste tem múltiplas reservas com
// allow_remote_requests, o step "reserve" normalmente aparece — escolhe a
// reserva onde o cadete é membro (badge-membro) para permanecer no fluxo
// "mesma reserva" (não-externo), que é o que SR11-SR13 testam.
async function openRequestSheetToMaterials(page: Page) {
  await page.getByTestId("btn-solicitar-armamento").click();
  const reserveStep = page.getByTestId("ssa-step-reserve");
  if (await reserveStep.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.getByTestId("ssa-reserve-combobox").click();
    const memberOption = page
      .locator('[data-testid^="ssa-reserve-option-"]')
      .filter({ has: page.getByTestId("badge-membro") })
      .first();
    await memberOption.click();
  }
  await expect(page.getByTestId("ssa-step-materials")).toBeVisible({ timeout: 12_000 });
}

// O step "materials" só lista resultados após digitar uma busca (RR-06) —
// não há mais lista estática de "material-card". Busca por um material real
// (via API) e clica no card correspondente (data-testid=ssa-material-item-{id}).
async function clickFirstMaterialCard(page: Page) {
  const material = await getFirstAvailableMaterial(page);
  const search = page.getByTestId("ssa-material-search");
  for (let attempt = 0; attempt < 8; attempt++) {
    const retry = page.getByRole("button", { name: /tentar novamente/i });
    if (await retry.isVisible().catch(() => false)) await retry.click();
    await search.fill(material.nome);
    const item = page.locator(`[data-testid="ssa-material-item-${material.id}"]`);
    const appeared = await item.waitFor({ state: "visible", timeout: 8_000 }).then(() => true).catch(() => false);
    if (appeared) {
      await item.click();
      return;
    }
    if (attempt === 7) await expect(item).toBeVisible({ timeout: 8_000 });
  }
}

test.describe("SR — Material Request (Cadete)", () => {

  // ── SR01 ──────────────────────────────────────────────────────────────────
  test("SR01 - GET /available-materials retorna lista sem campos de quantidade", async ({ page }) => {
    await login(page, "efetivo");
    const { status, data } = await bffCall(page, "GET", "/api/ssa/available-materials");
    expect(status).toBe(200);
    const items = data as Record<string, unknown>[];
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.quantidade_disponivel).toBeUndefined();
      expect(item.quantidade_total).toBeUndefined();
      expect(item.quantidade_reservada).toBeUndefined();
      expect(item.disponivel).toBe(true);
    }
  });

  // ── SR02 ──────────────────────────────────────────────────────────────────
  test("SR02 - GET /available-materials retorna 401 sem autenticação", async ({ page }) => {
    const res = await page.request.get(`${BFF_URL}/api/ssa/available-materials`);
    expect(res.status()).toBe(401);
  });

  // ── SR03 ──────────────────────────────────────────────────────────────────
  test("SR03 - POST /requests retorna 400 com código TOTP errado", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const material = await getFirstAvailableMaterial(page);

    const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
      items: [{ material_type_id: material.id, quantity: 1 }],
      totp_token: "000000",
    });
    expect(status).toBe(400);
    expect((data as { error: string }).error).toMatch(/código/i);
  });

  // ── SR04 ──────────────────────────────────────────────────────────────────
  test("SR04 - POST /requests cria solicitação com status 'pendente' e TOTP válido", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);
    expect(request_id).toMatch(/^[0-9a-f-]{36}$/);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { id: string; status: string; totp_validated: boolean }[];
    const req = requests.find((r) => r.id === request_id);
    expect(req?.status).toBe("pendente");
    expect(req?.totp_validated).toBe(true);
  });

  // ── SR05 ──────────────────────────────────────────────────────────────────
  test("SR05 - segundo pedido com 1 pendente retorna 403", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);

    // Attempt second request
    const material = await getFirstAvailableMaterial(page);
    const code = await getTOTPCode(page);
    const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
      items: [{ material_type_id: material.id, quantity: 1 }],
      totp_token: code,
    });
    expect(status).toBe(403);
    expect((data as { error: string }).error).toMatch(/pendente|aprovad/i);
  });

  // ── SR06 ──────────────────────────────────────────────────────────────────
  test("SR06 - POST /requests retorna 403 para Reserva de Armamento (role=master)", async ({ page }) => {
    await login(page, "reserva");
    const { status } = await bffCall(page, "POST", "/api/ssa/requests", {
      items: [{ material_type_id: "00000000-0000-0000-0000-000000000001", quantity: 1 }],
      totp_token: "123456",
    });
    expect(status).toBe(403);
  });

  // ── SR07 ──────────────────────────────────────────────────────────────────
  test("SR07 - GET /requests retorna apenas pedidos do próprio cadete", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { military: { matricula: string } }[];
    for (const r of requests) {
      expect(r.military?.matricula).toBe("000003");
    }
  });

  // ── SR08 ──────────────────────────────────────────────────────────────────
  test("SR08 - DELETE /requests/:id cancela pedido pendente (próprio militar)", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    const { status } = await bffCall(page, "DELETE", `/api/ssa/requests/${request_id}`);
    expect(status).toBe(200);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { id: string; status: string }[];
    const req = requests.find((r) => r.id === request_id);
    expect(req?.status).toBe("cancelado");
  });

  // ── SR09 ──────────────────────────────────────────────────────────────────
  test("SR09 - cadete não pode cancelar pedido já aprovado (403)", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    // Approve as Reserva de Armamento
    await login(page, "reserva");
    const { status: approveStatus } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    expect(approveStatus).toBe(200);

    // Try cancel as cadete
    await login(page, "efetivo");
    const { status } = await bffCall(page, "DELETE", `/api/ssa/requests/${request_id}`);
    expect(status).toBe(403);
  });

  // ── SR10 ──────────────────────────────────────────────────────────────────
  test("SR10 - UI: botão 'Solicitar Armamento' visível no dashboard cadete", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`);
    await expect(page.getByTestId("btn-solicitar-armamento")).toBeVisible({ timeout: 10_000 });
  });

  // ── SR11 ──────────────────────────────────────────────────────────────────
  test("SR11 - UI: Sheet abre, seleciona reserva e busca mostra materiais no Passo de materiais", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`);
    await openRequestSheetToMaterials(page);
    // Sem busca digitada, nenhuma lista aparece (RR-06 — busca obrigatória)
    await expect(page.getByTestId("ssa-material-search")).toBeVisible();
    const material = await getFirstAvailableMaterial(page);
    await page.getByTestId("ssa-material-search").fill(material.nome);
    const items = page.locator('[data-testid^="ssa-material-item-"]');
    await expect(items.first()).toBeVisible({ timeout: 15_000 });
  });

  // ── SR12 ──────────────────────────────────────────────────────────────────
  test("SR12 - UI: avança para Passo 2 com TOTPDisplay após selecionar material", async ({ page }) => {
    await login(page, "efetivo");
    await bffCall(page, "POST", "/api/totp/setup");
    await page.goto(`${BASE_URL}/efetivo`);
    await openRequestSheetToMaterials(page);
    await clickFirstMaterialCard(page);
    await page.getByTestId("btn-step-next").click();
    await expect(page.getByTestId("totp-display")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("totp-input")).toBeVisible();
  });

  // ── SR13 ──────────────────────────────────────────────────────────────────
  test("SR13 - UI: submeter com código errado exibe mensagem de erro inline", async ({ page }) => {
    await login(page, "efetivo");
    await bffCall(page, "POST", "/api/totp/setup");
    await page.goto(`${BASE_URL}/efetivo`);
    await openRequestSheetToMaterials(page);
    await clickFirstMaterialCard(page);
    await page.getByTestId("btn-step-next").click();
    await expect(page.getByTestId("totp-display")).toBeVisible({ timeout: 10_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="totp-code"]');
        return el !== null && /\d{6}/.test((el.textContent ?? "").replace(/\D/g, ""));
      },
      { timeout: 50_000 }
    );
    // Intercept the submit: return deterministic 400 for bad TOTP.
    // SR03 covers the real BFF 400 response; SR13 tests the UI error display.
    // This decouples the submit from BFF uptime so the test is stable.
    await page.route("**/api/ssa/requests", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Código inválido. Verifique o código e tente novamente." }),
        });
      } else {
        await route.continue();
      }
    });
    await page.getByTestId("totp-input").fill("000000");
    await page.getByTestId("btn-submit-request").click();
    await expect(page.getByText(/código inválido/i)).toBeVisible({ timeout: 10_000 });
  });

  // ── SR14 ──────────────────────────────────────────────────────────────────
  // O botão nunca é ocultado (UX: some CTA some sem explicação é ruim) — em vez
  // disso, muda de rótulo ("Solicitação Remota") e o sheet mostra um bloqueio
  // "Solicitação já em andamento" no lugar do combobox de reserva.
  test("SR14 - UI: pedido ativo mostra bloqueio ao abrir o sheet (botão continua visível)", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);
    await page.goto(`${BASE_URL}/efetivo`);
    const btn = page.getByTestId("btn-solicitar-armamento");
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await btn.click();
    await expect(page.getByText(/solicitação já em andamento/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("ssa-reserve-combobox")).not.toBeVisible();
  });

  // ── SR15 ──────────────────────────────────────────────────────────────────
  test("SR15 - items retornam com snapshots de nome e categoria", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { items: { material_nome_snapshot: string; material_categoria_snapshot: string }[] }[];
    expect(requests[0].items[0].material_nome_snapshot).toBeTruthy();
    expect(requests[0].items[0].material_categoria_snapshot).toBeTruthy();
  });

  // ── SR16 ──────────────────────────────────────────────────────────────────
  test("SR16 - POST /requests com quantity=0 retorna 400 (validação Zod)", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const code = await getTOTPCode(page);
    const material = await getFirstAvailableMaterial(page);

    const { status } = await bffCall(page, "POST", "/api/ssa/requests", {
      items: [{ material_type_id: material.id, quantity: 0 }],
      totp_token: code,
    });
    expect(status).toBe(400);
  });

  // ── SR17 ──────────────────────────────────────────────────────────────────
  test("SR17 - POST /requests sem items retorna 400", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const code = await getTOTPCode(page);

    const { status } = await bffCall(page, "POST", "/api/ssa/requests", {
      items: [],
      totp_token: code,
    });
    expect(status).toBe(400);
  });

  // ── SR18 ──────────────────────────────────────────────────────────────────
  test("SR18 - totp_validated=true e totp_validated_at preenchidos no DB", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { id: string; totp_validated: boolean; totp_validated_at: string }[];
    const req = requests.find((r) => r.id === request_id);
    expect(req?.totp_validated).toBe(true);
    expect(req?.totp_validated_at).toBeTruthy();
  });

  // ── SR19 ──────────────────────────────────────────────────────────────────
  test("SR19 - Reserva de Armamento vê todos os pedidos (não filtrado por military_id)", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { id: string }[];
    const found = requests.find((r) => r.id === request_id);
    expect(found).toBeTruthy();
  });

  // ── SR20 ──────────────────────────────────────────────────────────────────
  test("SR20 - cadete não vê pedidos de outros militares (RLS)", async ({ page }) => {
    // Create request as cadete
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    // Admin cannot see cadete's requests via cadete endpoint
    // (different test: here we confirm the list only has cadete's own)
    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { military: { matricula: string } }[];
    for (const r of requests) {
      // Every request should belong to the current user (cadete)
      expect(r.military?.matricula).toBe("000003");
    }
  });
});
