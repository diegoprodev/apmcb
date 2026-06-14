/**
 * SSA Approval Spec — SA01–SA18
 *
 * Tests armeiro approve/reject/deliver flow, Modo A dialog,
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

test.describe("SA — Approval Flow (Armeiro)", () => {

  // ── SA01 ──────────────────────────────────────────────────────────────────
  test("SA01 - dashboard armeiro exibe card 'Pendências Remotas'", async ({ page }) => {
    await login(page, "armeiro");
    await page.goto(`${BASE_URL}/armeiro`);
    await expect(page.getByTestId("card-pendencias-remotas")).toBeVisible({ timeout: 10_000 });
  });

  // ── SA02 ──────────────────────────────────────────────────────────────────
  test("SA02 - badge de pendências aumenta após cadete criar solicitação", async ({ page }) => {
    await login(page, "armeiro");
    await page.goto(`${BASE_URL}/armeiro`);
    const badgeBefore = await page.getByTestId("badge-pendencias").textContent().catch(() => "0");

    // Create request as cadete
    await login(page, "cadete");
    await setupTOTP(page);
    await createMaterialRequest(page);

    // Reload armeiro page
    await login(page, "armeiro");
    await page.goto(`${BASE_URL}/armeiro`);
    const badgeAfter = await page.getByTestId("badge-pendencias").textContent();
    expect(Number(badgeAfter)).toBeGreaterThan(Number(badgeBefore ?? "0"));
  });

  // ── SA03 ──────────────────────────────────────────────────────────────────
  test("SA03 - PATCH /approve retorna 200 com expires_at = +6h ±5min", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
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
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);

    await login(page, "cadete");
    await page.goto(`${BASE_URL}/cadete`);
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
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/reject`, {});
    expect(status).toBe(400);
  });

  // ── SA06 ──────────────────────────────────────────────────────────────────
  test("SA06 - PATCH /reject com motivo válido notifica cadete", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/reject`, {
      reason: "Material em manutenção preventiva agendada",
    });
    expect(status).toBe(200);

    await login(page, "cadete");
    const { data } = await bffCall(page, "GET", "/api/notifications");
    const notifs = (data as { notifications: { type: string }[] }).notifications ?? [];
    expect(notifs.find((n) => n.type === "armament_rejected")).toBeTruthy();
  });

  // ── SA07 ──────────────────────────────────────────────────────────────────
  test("SA07 - PATCH /deliver cria lending records e retorna lending_ids", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
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
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);

    await forceExpireRequest(request_id);

    const { status, data } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/deliver`);
    expect(status).toBe(409);
    expect((data as { error: string }).error).toMatch(/expir/i);
  });

  // ── SA09 ──────────────────────────────────────────────────────────────────
  test("SA09 - cadete não pode aprovar nem rejeitar (403)", async ({ page }) => {
    await login(page, "cadete");
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
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    // Second approve attempt
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    expect(status).toBe(409);
  });

  // ── SA11 ──────────────────────────────────────────────────────────────────
  test("SA11 - /armeiro/solicitacoes carrega sem erro e mostra tabela", async ({ page }) => {
    await login(page, "armeiro");
    await page.goto(`${BASE_URL}/armeiro/solicitacoes`);
    await expect(page.getByTestId("ssa-table")).toBeVisible({ timeout: 15_000 });
  });

  // ── SA12 ──────────────────────────────────────────────────────────────────
  test("SA12 - tab Pendentes mostra apenas rows com status 'Pendente'", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    await createMaterialRequest(page);

    await login(page, "armeiro");
    await page.goto(`${BASE_URL}/armeiro/solicitacoes`);
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
  test("SA13 - botão 'Aprovar' visível em pedido pendente expandido", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    await createMaterialRequest(page);

    await login(page, "armeiro");
    await page.goto(`${BASE_URL}/armeiro/solicitacoes`);
    await page.getByTestId("tab-pendentes").click();
    // Expand first row
    await page.getByTestId("ssa-row").first().click();
    await expect(page.getByTestId("btn-aprovar").first()).toBeVisible({ timeout: 5_000 });
  });

  // ── SA14 ──────────────────────────────────────────────────────────────────
  test("SA14 - UI: rejeição sem motivo bloqueia botão de confirmar", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    await createMaterialRequest(page);

    await login(page, "armeiro");
    await page.goto(`${BASE_URL}/armeiro/solicitacoes`);
    await page.getByTestId("tab-pendentes").click();
    await page.getByTestId("ssa-row").first().click();
    await page.getByTestId("btn-rejeitar").first().click();

    const confirmBtn = page.getByTestId("btn-confirmar-rejeicao");
    await expect(confirmBtn).toBeVisible();
    await expect(confirmBtn).toBeDisabled(); // disabled until reason is filled
  });

  // ── SA15 ──────────────────────────────────────────────────────────────────
  test("SA15 - expire_material_requests() muda status aprovado-vencido para expirado", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    await forceExpireRequest(request_id);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { id: string; status: string }[];
    const req = requests.find((r) => r.id === request_id);
    expect(req?.status).toBe("expirado");
  });

  // ── SA16 ──────────────────────────────────────────────────────────────────
  test("SA16 - audit_logs registra ssa.solicitado, ssa.aprovado e ssa.retirado", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/deliver`);

    await assertAuditLog(request_id, "ssa.solicitado");
    await assertAuditLog(request_id, "ssa.aprovado");
    await assertAuditLog(request_id, "ssa.retirado");
  });

  // ── SA17 ──────────────────────────────────────────────────────────────────
  test("SA17 - Modo A: botão 'Verificar Código' visível no dashboard armeiro", async ({ page }) => {
    await login(page, "armeiro");
    await page.goto(`${BASE_URL}/armeiro`);
    await expect(page.getByTestId("btn-verificar-codigo")).toBeVisible({ timeout: 10_000 });
  });

  // ── SA18 ──────────────────────────────────────────────────────────────────
  test("SA18 - Modo A: código TOTP correto no dialog libera seleção de material", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const code = await getTOTPCode(page);

    await login(page, "armeiro");
    await page.goto(`${BASE_URL}/armeiro`);
    await page.getByTestId("btn-verificar-codigo").click();
    await expect(page.getByTestId("dialog-verificar-totp")).toBeVisible({ timeout: 5_000 });

    await page.getByTestId("input-matricula").fill("000003");
    await page.getByTestId("input-totp-code").fill(code);
    await page.getByTestId("btn-verificar-submit").click();

    // After validation: military name shown + saída direta button
    await expect(page.getByTestId("militar-verified-name")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId("btn-saida-direta")).toBeVisible();
  });
});
