"use strict";
/**
 * Teste direto: criar login por Magic Link e por Senha
 * Magic link → e-mail único gerado por run (ver nota abaixo)
 * Senha → e2e_senha_test@apmcb.test
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login, T } from "./harness";

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

test.describe("Criar Login — Magic Link + Senha (testes reais)", () => {
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

    await page.getByRole("button", { name: /criar login/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    // Magic Link já deve ser o método padrão
    await dialog.getByLabel(/e-mail/i).fill(email);
    await dialog.getByLabel(/nome completo/i).fill(`Teste ML ${id}`);
    await dialog.getByLabel(/matrícula/i).fill(`ML${id.toUpperCase()}`);

    const submitBtn = dialog.getByRole("button", { name: /enviar convite/i });
    await expect(submitBtn).toBeEnabled({ timeout: 3000 });

    const apiResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/users") && r.request().method() === "POST",
      { timeout: T.apiResponse * 4 }
    );

    await submitBtn.click();

    const apiResp = await apiResponsePromise;
    const apiBody = await apiResp.json().catch(() => ({}));

    console.log(`[ML01] API status: ${apiResp.status()}, body:`, JSON.stringify(apiBody));
    console.log("[ML01] Console errors:", consoleErrors);

    expect(
      apiResp.status(),
      `API /api/admin/users (magic_link) retornou ${apiResp.status()}: ${JSON.stringify(apiBody)}`
    ).toBe(200);

    // Toast de sucesso deve aparecer
    await expect(page.getByText(/convite enviado|criado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse * 2,
    });

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

    await page.getByRole("button", { name: /criar login/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    // Selecionar método senha
    await dialog.getByRole("button", { name: /define senha/i }).click();

    await dialog.getByLabel(/e-mail/i).fill(email);
    await dialog.getByLabel(/senha temporária/i).fill("Teste@123456");
    await dialog.getByLabel(/nome completo/i).fill(`Teste PW ${id}`);
    await dialog.getByLabel(/matrícula/i).fill(matricula);

    const submitBtn = dialog.getByRole("button", { name: /criar conta/i });
    await expect(submitBtn).toBeEnabled({ timeout: 3000 });

    const apiResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/users") && r.request().method() === "POST",
      { timeout: T.apiResponse * 4 }
    );

    await submitBtn.click();

    const apiResp = await apiResponsePromise;
    const apiBody = await apiResp.json().catch(() => ({}));

    console.log(`[PW01] API status: ${apiResp.status()}, body:`, JSON.stringify(apiBody));
    console.log("[PW01] Console errors:", consoleErrors);

    expect(
      apiResp.status(),
      `API /api/admin/users (password) retornou ${apiResp.status()}: ${JSON.stringify(apiBody)}`
    ).toBe(200);

    await expect(dialog.getByText(/criado com sucesso/i)).toBeVisible({ timeout: T.apiResponse * 2 });

    const criticalErrors = consoleErrors.filter(
      (e) => e.includes("500") || e.includes("SUPABASE_SERVICE_ROLE_KEY")
    );
    expect(criticalErrors, `Erros 500 detectados: ${criticalErrors.join("; ")}`).toHaveLength(0);
  });
});
