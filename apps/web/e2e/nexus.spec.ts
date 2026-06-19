/**
 * nexus.spec.ts
 *
 * E2E suite for the /nexus super-admin control panel.
 *
 * NX01  /nexus/login carrega sem crash
 * NX02  /nexus sem sessão nexus redireciona para /nexus/login
 * NX03  step 1 com credenciais inválidas exibe erro
 * NX04  step 2 com TOTP inválido retorna erro (não avança)
 * NX05  GET /api/nexus/health retorna 401 sem sessão nexus
 * NX06  GET /api/nexus/events retorna 401 sem sessão nexus
 * NX07  GET /api/nexus/errors retorna 401 sem sessão nexus
 * NX08  POST /api/nexus/clear-rate-limit retorna 401 sem sessão nexus
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, BFF_URL, T } from "./harness";

test.describe("NX — Nexus Super Admin", () => {

  test("NX01 — /nexus/login carrega sem crash", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/login`, { waitUntil: "domcontentloaded" });
    await expect(page.getByAltText("APMCB")).toBeVisible({ timeout: T.navigation });
    await expect(page.getByText(/NEXUS/i)).toBeVisible({ timeout: T.navigation });
    await expect(page.getByText(/Acesso ao Nexus/i)).toBeVisible({ timeout: T.navigation });
  });

  test("NX02 — /nexus sem sessão nexus redireciona para /nexus/login", async ({ page }) => {
    // Navigate directly — no nexus session cookie, guard should redirect
    await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/nexus\/login/, { timeout: T.navigation });
  });

  test("NX03 — step 1 com credenciais inválidas exibe erro", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/login`, { waitUntil: "domcontentloaded" });

    // Fill wrong credentials
    await page.getByPlaceholder(/admin@apmcb/i).fill("wrong@wrong.com");
    await page.locator("input[type='password']").fill("WrongPass@123");
    await page.getByRole("button", { name: /continuar/i }).click();

    // Should show error toast / message
    await expect(
      page.getByText(/credenciais inválidas|acesso restrito|erro no login/i)
    ).toBeVisible({ timeout: T.apiResponse });

    // Should still be on step 1 (not advance to TOTP step)
    await expect(page.getByText(/Acesso ao Nexus/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("NX04 — step 2 com TOTP inválido não avança para dashboard", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/login`, { waitUntil: "domcontentloaded" });

    // Complete step 1 with valid admin credentials
    await page.getByPlaceholder(/admin@apmcb/i).fill("admin@apmcb.dev");
    await page.locator("input[type='password']").fill("Admin@123");
    await page.getByRole("button", { name: /continuar/i }).click();

    // Should advance to TOTP step
    await expect(page.getByText(/Verificação 2FA/i)).toBeVisible({ timeout: T.apiResponse });

    // Fill invalid TOTP
    await page.locator("input[inputmode='numeric']").fill("000000");
    await page.getByRole("button", { name: /Entrar no Nexus/i }).click();

    // Should show error — should NOT navigate to /nexus
    await expect(
      page.getByText(/código inválido|inválido|bloqueado/i)
    ).toBeVisible({ timeout: T.apiResponse });

    // URL must not be /nexus dashboard
    await expect(page).not.toHaveURL(/^.*\/nexus$/, { timeout: 1000 });
  });

  test("NX05 — GET /api/nexus/health retorna 401 sem sessão nexus", async ({ page }) => {
    const res = await page.request.get(`${BFF_URL}/api/nexus/health`, {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(401);
    expect(res.status()).toBeLessThanOrEqual(403);
  });

  test("NX06 — GET /api/nexus/events retorna 401 sem sessão nexus", async ({ page }) => {
    const res = await page.request.get(`${BFF_URL}/api/nexus/events`);
    expect(res.status()).toBeGreaterThanOrEqual(401);
    expect(res.status()).toBeLessThanOrEqual(403);
  });

  test("NX07 — GET /api/nexus/errors retorna 401 sem sessão nexus", async ({ page }) => {
    const res = await page.request.get(`${BFF_URL}/api/nexus/errors`);
    expect(res.status()).toBeGreaterThanOrEqual(401);
    expect(res.status()).toBeLessThanOrEqual(403);
  });

  test("NX08 — POST /api/nexus/clear-rate-limit retorna 401 sem sessão nexus", async ({ page }) => {
    const res = await page.request.post(`${BFF_URL}/api/nexus/clear-rate-limit`, {
      data: { ip: "1.2.3.4" },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(401);
    expect(res.status()).toBeLessThanOrEqual(403);
  });
});
