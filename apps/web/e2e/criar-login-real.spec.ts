"use strict";
/**
 * Teste direto: cadastrar militar novo com convite de login por Magic Link
 * e por Senha, no dialog único "Cadastrar Usuário" (modo "Novo militar" +
 * checkbox "Enviar convite de login agora" — antes existia um dialog
 * "Criar Login" separado que criava o militar e o acesso em um único POST a
 * /api/admin/users; unificado nesta tarefa, o fluxo agora sempre cadastra o
 * militar via /api/admin/militares e, se o convite estiver marcado, envia o
 * acesso via /api/admin/users no mesmo submit — ver
 * apps/web/src/app/(dashboard)/admin/usuarios/_cadastrar-militar-dialog.tsx).
 *
 * Magic link → e-mail único gerado por run (ver nota abaixo)
 * Senha → e2e_senha_test@apmcb.test
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login, T } from "./harness";

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

test.describe("Cadastrar Usuário + convite — Magic Link + Senha (testes reais)", () => {
  test("ML01 — magic link cria usuário novo (verificar toast + sem 500)", async ({ page }) => {
    // Precisa de um e-mail NUNCA usado antes: a rota é "criar usuário", não
    // idempotente — reusar um e-mail já cadastrado (ex: o real do dev) sempre
    // retorna 409 a partir do segundo run e quebra a suite permanentemente.
    const id = uid();
    const email = `e2e.ml.${id}@apmcb.test`;

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({ timeout: T.navigation });

    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    await dialog.getByLabel(/nome completo/i).fill(`Teste ML ${id}`);
    await dialog.getByLabel(/matrícula/i).fill(`ML${id.toUpperCase()}`);

    // Magic Link já é o método padrão ao marcar o convite
    await dialog.getByLabel(/enviar convite de login agora/i).check();
    await dialog.getByLabel(/e-mail do usuário/i).fill(email);

    const submitBtn = dialog.getByTestId("cm-submit-btn");
    await expect(submitBtn).toBeEnabled({ timeout: 3000 });

    const militaresRespPromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/militares") && r.request().method() === "POST",
      { timeout: T.apiResponse * 4 }
    );
    const usersRespPromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/users") && r.request().method() === "POST",
      { timeout: T.apiResponse * 4 }
    );

    await submitBtn.click();

    const militaresResp = await militaresRespPromise;
    const militaresBody = await militaresResp.json().catch(() => ({}));
    console.log(`[ML01] /api/admin/militares status: ${militaresResp.status()}, body:`, JSON.stringify(militaresBody));
    expect(
      militaresResp.status(),
      `API /api/admin/militares retornou ${militaresResp.status()}: ${JSON.stringify(militaresBody)}`
    ).toBe(200);

    const usersResp = await usersRespPromise;
    const usersBody = await usersResp.json().catch(() => ({}));
    console.log(`[ML01] /api/admin/users status: ${usersResp.status()}, body:`, JSON.stringify(usersBody));
    console.log("[ML01] Console errors:", consoleErrors);

    expect(
      usersResp.status(),
      `API /api/admin/users (magic_link) retornou ${usersResp.status()}: ${JSON.stringify(usersBody)}`
    ).toBe(200);

    // Toast/tela de sucesso deve aparecer
    await expect(dialog.getByText(/cadastrado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse * 2,
    });
    await expect(dialog.getByText(/convite enviado para/i)).toBeVisible();

    // Sem 500 no console
    const criticalErrors = consoleErrors.filter(
      (e) => e.includes("500") || e.includes("SUPABASE_SERVICE_ROLE_KEY")
    );
    expect(criticalErrors, `Erros 500 detectados: ${criticalErrors.join("; ")}`).toHaveLength(0);
  });

  test("PW01 — criar login por senha (verificar fluxo completo)", async ({ page }) => {
    const id = uid();
    const email = `e2e.pw.${id}@apmcb.test`;
    const matricula = `PW${id.toUpperCase()}`;

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({ timeout: T.navigation });

    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    await dialog.getByLabel(/nome completo/i).fill(`Teste PW ${id}`);
    await dialog.getByLabel(/matrícula/i).fill(matricula);

    await dialog.getByLabel(/enviar convite de login agora/i).check();
    // Selecionar método senha
    await dialog.getByRole("button", { name: /^senha$/i }).click();
    await dialog.getByLabel(/e-mail do usuário/i).fill(email);
    await dialog.getByLabel(/senha temporária/i).fill("Teste@123456");

    const submitBtn = dialog.getByTestId("cm-submit-btn");
    await expect(submitBtn).toBeEnabled({ timeout: 3000 });

    const militaresRespPromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/militares") && r.request().method() === "POST",
      { timeout: T.apiResponse * 4 }
    );
    const usersRespPromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/users") && r.request().method() === "POST",
      { timeout: T.apiResponse * 4 }
    );

    await submitBtn.click();

    const militaresResp = await militaresRespPromise;
    const militaresBody = await militaresResp.json().catch(() => ({}));
    console.log(`[PW01] /api/admin/militares status: ${militaresResp.status()}, body:`, JSON.stringify(militaresBody));
    expect(
      militaresResp.status(),
      `API /api/admin/militares retornou ${militaresResp.status()}: ${JSON.stringify(militaresBody)}`
    ).toBe(200);

    const usersResp = await usersRespPromise;
    const usersBody = await usersResp.json().catch(() => ({}));
    console.log(`[PW01] /api/admin/users status: ${usersResp.status()}, body:`, JSON.stringify(usersBody));
    console.log("[PW01] Console errors:", consoleErrors);

    expect(
      usersResp.status(),
      `API /api/admin/users (password) retornou ${usersResp.status()}: ${JSON.stringify(usersBody)}`
    ).toBe(200);

    await expect(dialog.getByText(/cadastrado com sucesso/i)).toBeVisible({ timeout: T.apiResponse * 2 });

    const criticalErrors = consoleErrors.filter(
      (e) => e.includes("500") || e.includes("SUPABASE_SERVICE_ROLE_KEY")
    );
    expect(criticalErrors, `Erros 500 detectados: ${criticalErrors.join("; ")}`).toHaveLength(0);
  });
});
