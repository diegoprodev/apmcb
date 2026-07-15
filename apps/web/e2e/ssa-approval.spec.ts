/**
 * SSA Approval Spec — SA01–SA18
 *
 * Tests Reserva de Armamento approve/reject/deliver flow, Modo A dialog,
 * auto-expiry, audit logs and UI interactions.
 *
 * Run:
 *   npx playwright test ssa-approval.spec.ts --project=ssa-suite
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";
import {
  bffCall, setupTOTP, getTOTPCode,
  createMaterialRequest, cleanupRequests,
  forceExpireRequest, assertAuditLog,
} from "./harness/ssa";

test.beforeEach(async () => {
  await cleanupRequests();
});

test.describe("SA — Approval Flow (Reserva de Armamento)", () => {

  // ── SA01 ──────────────────────────────────────────────────────────────────
  test("SA01 - dashboard Reserva de Armamento exibe card 'Pendências Remotas'", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`);
    await expect(page.getByTestId("card-pendencias-remotas")).toBeVisible({ timeout: 10_000 });
  });

  // ── SA02 ──────────────────────────────────────────────────────────────────
  test("SA02 - badge de pendências aumenta após cadete criar solicitação", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`);
    // Scope badge to the "Pendências Remotas" card specifically (multiple badges on this page)
    const remotasBadge = page.getByTestId("card-pendencias-remotas").getByTestId("badge-pendencias");
    const badgeBefore = await remotasBadge.textContent().catch(() => "0");

    // Create request as cadete
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);

    // Reload Reserva de Armamento page
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`);
    const badgeAfter = await page.getByTestId("card-pendencias-remotas").getByTestId("badge-pendencias").textContent();
    expect(Number(badgeAfter)).toBeGreaterThan(Number(badgeBefore ?? "0"));
  });

  // ── SA03 ──────────────────────────────────────────────────────────────────
  test("SA03 - PATCH /approve retorna 200 com expires_at = +6h ±5min", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    const { status, data } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    expect(status).toBe(200);
    const body = data as { ok: boolean; expires_at: string };
    expect(body.ok).toBe(true);

    const diffMs = new Date(body.expires_at).getTime() - Date.now();
    expect(diffMs).toBeGreaterThan((6 * 3600 - 300) * 1000); // at least 5h55m
    expect(diffMs).toBeLessThan((6 * 3600 + 300) * 1000);   // at most 6h05m
  });

  // ── SA04 ──────────────────────────────────────────────────────────────────
  test("SA04 - cadete recebe notificação 'armament_approved' após aprovação", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);

    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`);
    // Notification bell should show unread count
    const bellCount = page.locator('[aria-label="Notificações"] + span, button[aria-label="Notificações"] span');
    // Alternatively check via API
    const { data: notifData } = await bffCall(page, "GET", "/api/notifications");
    const notifs = (notifData as { notifications: { type: string }[] }).notifications ?? [];
    const approvedNotif = notifs.find((n) => n.type === "armament_approved");
    expect(approvedNotif).toBeTruthy();
  });

  // ── SA05 ──────────────────────────────────────────────────────────────────
  test("SA05 - PATCH /reject sem motivo retorna 400", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/reject`, {});
    expect(status).toBe(400);
  });

  // ── SA06 ──────────────────────────────────────────────────────────────────
  test("SA06 - PATCH /reject com motivo válido notifica cadete", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/reject`, {
      reason: "Material em manutenção preventiva agendada",
    });
    expect(status).toBe(200);

    await login(page, "efetivo");
    const { data } = await bffCall(page, "GET", "/api/notifications");
    const notifs = (data as { notifications: { type: string }[] }).notifications ?? [];
    expect(notifs.find((n) => n.type === "armament_rejected")).toBeTruthy();
  });

  // ── SA07 ──────────────────────────────────────────────────────────────────
  test("SA07 - PATCH /deliver cria lending records e retorna lending_ids", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    const { status, data } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/deliver`);

    expect(status).toBe(200);
    const body = data as { ok: boolean; lending_ids: string[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.lending_ids)).toBe(true);
    expect(body.lending_ids.length).toBeGreaterThan(0);
  });

  // ── SA08 ──────────────────────────────────────────────────────────────────
  test("SA08 - PATCH /deliver em pedido expirado retorna 409", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);

    await forceExpireRequest(request_id);

    const { status, data } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/deliver`);
    expect(status).toBe(409);
    expect((data as { error: string }).error).toMatch(/expir/i);
  });

  // ── SA09 ──────────────────────────────────────────────────────────────────
  test("SA09 - cadete não pode aprovar nem rejeitar (403)", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    const { status: s1 } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    expect(s1).toBe(403);

    const { status: s2 } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/reject`, {
      reason: "Tentativa indevida",
    });
    expect(s2).toBe(403);
  });

  // ── SA10 ──────────────────────────────────────────────────────────────────
  test("SA10 - aprovar pedido já aprovado retorna 409 (estado inválido)", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    // Second approve attempt
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    expect(status).toBe(409);
  });

  // ── SA11 ──────────────────────────────────────────────────────────────────
  test("SA11 - /reserva/solicitacoes carrega sem erro e mostra tabela", async ({ page }) => {
    // Self-contained: não depende de estado residual de outros testes (a tela
    // de Pendentes fica vazia se um teste anterior já aprovou/rejeitou tudo).
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes`);
    // CF Edge Workers occasionally hit CPU limits under load; reload with backoff if 1102 appears
    if (await page.getByText(/1102|resource limits/i).isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.waitForTimeout(15_000);
      await page.goto(`${BASE_URL}/reserva/solicitacoes`);
    }
    // Vista padrão é "cards" — trocar para tabela antes de checar ssa-table.
    await page.getByRole("button", { name: /ver em lista/i }).click();
    await expect(page.getByTestId("ssa-table")).toBeVisible({ timeout: 15_000 });
  });

  // ── SA12 ──────────────────────────────────────────────────────────────────
  test("SA12 - tab Pendentes mostra apenas rows com status 'Pendente'", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes`);
    await page.getByTestId("tab-pendentes").click();

    const rows = page.getByTestId("ssa-row");
    await expect(rows.first()).toBeVisible({ timeout: 8_000 });

    const badges = rows.locator('[data-testid="status-badge"]');
    const count = await badges.count();
    for (let i = 0; i < count; i++) {
      await expect(badges.nth(i)).toHaveText(/pendente/i);
    }
  });

  // ── SA13 ──────────────────────────────────────────────────────────────────
  // A UI antiga tinha botões separados "Aprovar"/"Rejeitar"; foi substituída por
  // um único <select data-testid="select-acao"> + botão de confirmação genérico
  // (data-testid="btn-confirmar-acao") cujo rótulo muda conforme a ação escolhida.
  test("SA13 - ação 'Aprovar' disponível em pedido pendente expandido", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes`);
    await page.getByTestId("tab-pendentes").click();
    // Expand first row
    const rows = page.getByTestId("ssa-row");
    await expect(rows.first()).toBeVisible({ timeout: 8_000 });
    await rows.first().click();
    const select = page.getByTestId("select-acao").first();
    await expect(select).toBeVisible({ timeout: 5_000 });
    await select.selectOption("aprovar");
    await expect(page.getByTestId("btn-confirmar-acao").first()).toBeVisible({ timeout: 5_000 });
  });

  // ── SA14 ──────────────────────────────────────────────────────────────────
  test("SA14 - UI: rejeição sem motivo bloqueia botão de confirmar", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes`);
    await page.getByTestId("tab-pendentes").click();
    const rows = page.getByTestId("ssa-row");
    await expect(rows.first()).toBeVisible({ timeout: 8_000 });
    await rows.first().click();
    await page.getByTestId("select-acao").first().selectOption("rejeitar");

    const confirmBtn = page.getByTestId("btn-confirmar-acao").first();
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeDisabled(); // desabilitado até motivo ter ≥ 5 caracteres
  });

  // ── SA15 ──────────────────────────────────────────────────────────────────
  test("SA15 - expire_material_requests() muda status aprovado-vencido para expirado", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    await forceExpireRequest(request_id);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { id: string; status: string }[];
    const req = requests.find((r) => r.id === request_id);
    expect(req?.status).toBe("expirado");
  });

  // ── SA16 ──────────────────────────────────────────────────────────────────
  test("SA16 - audit_logs registra ssa.solicitado, ssa.aprovado e ssa.retirado", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/deliver`);

    await assertAuditLog(request_id, "ssa.solicitado");
    await assertAuditLog(request_id, "ssa.aprovado");
    await assertAuditLog(request_id, "ssa.retirado");
  });

  // ── SA17 ──────────────────────────────────────────────────────────────────
  test("SA17 - Modo A: botão 'Verificar Código' visível no dashboard Reserva de Armamento", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`);
    await expect(page.getByTestId("btn-verificar-codigo")).toBeVisible({ timeout: 10_000 });
  });

  // ── SA18 ──────────────────────────────────────────────────────────────────
  test("SA18 - Modo A: código TOTP correto no dialog libera seleção de material", async ({ page, browser }) => {
    await login(page, "efetivo");
    await setupTOTP(page);

    // Contexto isolado dedicado a buscar o código TOTP do cadete: login()
    // faz page.context().clearCookies() no CONTEXTO INTEIRO — reusar `page`
    // (que logo troca para "reserva") dentro do loop de retry buscaria o
    // TOTP do ARMEIRO, não do cadete. Confirmado empiricamente: com esse bug,
    // 100% das tentativas retornavam "Código inválido" (não era flakiness de
    // borda TOTP, era buscar o código do usuário errado).
    const cadeteContext = await browser.newContext();
    const cadetePage = await cadeteContext.newPage();
    await login(cadetePage, "efetivo");

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`);
    await page.getByTestId("btn-verificar-codigo").click();
    await expect(page.getByTestId("dialog-verificar-totp")).toBeVisible({ timeout: 5_000 });

    // Retry no envio: o código pode expirar entre getTOTPCode() e o submit
    // (mesmo padrão de retry usado em harness/ssa.ts createMaterialRequest).
    let confirmed = false;
    for (let attempt = 0; attempt < 3 && !confirmed; attempt++) {
      const code = await getTOTPCode(cadetePage);
      await page.getByTestId("input-matricula").fill("000003");
      await page.getByTestId("input-totp-code").fill(code);
      await page.getByTestId("btn-verificar-submit").click();
      const invalido = page.getByText(/código inválido/i);
      const verificado = page.getByText(/identidade verificada/i);
      confirmed = await Promise.race([
        verificado.waitFor({ timeout: 8_000 }).then(() => true),
        invalido.waitFor({ timeout: 8_000 }).then(() => false),
      ]).catch(() => false);
      if (!confirmed && attempt < 2) await page.waitForTimeout(31_000);
    }
    await cadeteContext.close();
    expect(confirmed, "TOTP válido não confirmou identidade após 3 tentativas").toBe(true);

    // Fase "confirm": identidade validada, botão "Armar {nome}" (mesmo testid
    // btn-saida-direta é reusado nas duas fases) avança para seleção de material.
    await page.getByTestId("btn-saida-direta").click();

    // Fase "select-material": nome do militar + botão de saída direta (desabilitado sem seleção)
    await expect(page.getByTestId("militar-verified-name")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("btn-saida-direta")).toBeVisible();
  });
});
