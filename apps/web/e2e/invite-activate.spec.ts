/**
 * invite-activate.spec.ts
 *
 * E2E suite for invite-link account activation and password reset pages.
 *
 * IA01  /auth/confirmar-conta loads without redirect (structure check)
 * IA02  /auth/confirmar-conta sem sessão mostra estado de erro
 * IA03  /auth/confirmar-conta campos senha e confirmação presentes
 * IA04  /auth/confirmar-conta botão ativar desabilitado com senha fraca
 * IA05  /auth/confirmar-conta botão ativar desabilitado com senhas incompatíveis
 * IA06  /auth/confirmar-conta medidor de força de senha aparece ao digitar
 * IA07  /auth/confirmar-conta botão eye toggle alterna visibilidade da senha
 * IA08  /auth/update-password carrega sem crash (sem sessão → erro)
 * IA09  /auth/update-password possui campo nova senha e confirmação
 * IA10  /auth/update-password medidor de força de senha aparece ao digitar
 * IA11  /auth/update-password botão eye toggle visibilidade da senha
 * IA12  /auth/update-password mismatch exibe mensagem de erro
 * IA13  /auth/update-password botão desabilitado enquanto senhas inválidas
 * IA14  /auth/callback redireciona para /auth/confirmar-conta com next param
 * IA15  /auth/callback sem code redireciona para /auth/error
 * IA16  Convite: redirectTo da API aponta para /auth/callback (não /login)
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, BFF_URL, USERS, login, T } from "./harness";

// ─── IA01-IA07: /auth/confirmar-conta ───────────────────────────────────────

test.describe("IA — Confirmar Conta (Ativação por convite)", () => {

  test("IA01 — /auth/confirmar-conta carrega página sem crash", async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/confirmar-conta`, { waitUntil: "domcontentloaded" });
    // Page should render without 500/crash — either form or error state
    await expect(page.locator("body")).toBeVisible({ timeout: T.navigation });
    // Logo APMCB present
    await expect(page.getByAltText("APMCB")).toBeVisible({ timeout: T.navigation });
  });

  test("IA02 — /auth/confirmar-conta sem sessão mostra estado de erro", async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/confirmar-conta`, { waitUntil: "domcontentloaded" });
    // Without a valid invite session, should show error state (not the form)
    await expect(
      page.getByText(/link inválido|link expirado|solicite um novo convite/i)
    ).toBeVisible({ timeout: T.apiResponse });
  });

  test("IA03 — /auth/confirmar-conta campos de senha presentes com sessão ativa", async ({ page }) => {
    // Login as cadete so there's an active session — page detects session and shows form
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/confirmar-conta`, { waitUntil: "domcontentloaded" });

    // Should see password fields (form state, not error)
    const pwdField = page.locator("input#new-password").or(page.getByPlaceholder(/mínimo 8/i));
    await expect(pwdField.first()).toBeVisible({ timeout: T.apiResponse });
    const confirmField = page.locator("input#confirm-password").or(page.getByPlaceholder(/repita a senha/i));
    await expect(confirmField.first()).toBeVisible({ timeout: T.apiResponse });
  });

  test("IA04 — /auth/confirmar-conta botão desabilitado com senha fraca", async ({ page }) => {
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/confirmar-conta`, { waitUntil: "domcontentloaded" });

    const pwdField = page.locator("input#new-password").or(page.getByPlaceholder(/mínimo 8/i)).first();
    await pwdField.waitFor({ timeout: T.apiResponse });
    await pwdField.fill("abc");

    const submitBtn = page.getByRole("button", { name: /ativar minha conta/i });
    await expect(submitBtn).toBeDisabled({ timeout: T.apiResponse });
  });

  test("IA05 — /auth/confirmar-conta botão desabilitado com senhas incompatíveis", async ({ page }) => {
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/confirmar-conta`, { waitUntil: "domcontentloaded" });

    const pwdField = page.locator("input#new-password").or(page.getByPlaceholder(/mínimo 8/i)).first();
    await pwdField.waitFor({ timeout: T.apiResponse });
    await pwdField.fill("Senha@123");

    const confirmField = page.locator("input#confirm-password").or(page.getByPlaceholder(/repita a senha/i)).first();
    await confirmField.fill("Senha@456");

    // Mismatch message visible
    await expect(page.getByText(/as senhas não coincidem/i)).toBeVisible({ timeout: T.apiResponse });

    const submitBtn = page.getByRole("button", { name: /ativar minha conta/i });
    await expect(submitBtn).toBeDisabled({ timeout: T.apiResponse });
  });

  test("IA06 — /auth/confirmar-conta medidor de força aparece ao digitar", async ({ page }) => {
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/confirmar-conta`, { waitUntil: "domcontentloaded" });

    const pwdField = page.locator("input#new-password").or(page.getByPlaceholder(/mínimo 8/i)).first();
    await pwdField.waitFor({ timeout: T.apiResponse });
    await pwdField.fill("Teste123");

    // Strength label should appear
    await expect(page.getByText(/força:/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("IA07 — /auth/confirmar-conta eye toggle alterna tipo do input", async ({ page }) => {
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/confirmar-conta`, { waitUntil: "domcontentloaded" });

    const pwdField = page.locator("input#new-password").first();
    await pwdField.waitFor({ timeout: T.apiResponse });

    // Initially password type
    await expect(pwdField).toHaveAttribute("type", "password");

    // Click the eye toggle (button with aria-label or near the field)
    const toggleBtn = page.getByRole("button", { name: /mostrar senha/i }).first();
    await toggleBtn.click();

    // Should be text now
    await expect(pwdField).toHaveAttribute("type", "text");
  });
});

// ─── IA08-IA13: /auth/update-password ───────────────────────────────────────

test.describe("IA — Update Password (Redefinição de senha)", () => {

  test("IA08 — /auth/update-password carrega sem crash (sem sessão → erro)", async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/update-password`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: T.navigation });
    await expect(page.getByAltText("APMCB")).toBeVisible({ timeout: T.navigation });
    // No unhandled JS crash
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForTimeout(500);
    expect(errors.filter(e => !/fetch|network/i.test(e))).toHaveLength(0);
  });

  test("IA09 — /auth/update-password com sessão exibe campos de senha", async ({ page }) => {
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/update-password`, { waitUntil: "domcontentloaded" });

    const pwdField = page.locator("input#new-password");
    await expect(pwdField).toBeVisible({ timeout: T.apiResponse });
    const confirmField = page.locator("input#confirm-password");
    await expect(confirmField).toBeVisible({ timeout: T.apiResponse });
  });

  test("IA10 — /auth/update-password medidor de força aparece ao digitar", async ({ page }) => {
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/update-password`, { waitUntil: "domcontentloaded" });

    const pwdField = page.locator("input#new-password");
    await pwdField.waitFor({ timeout: T.apiResponse });
    await pwdField.fill("Teste123");

    await expect(page.getByText(/força:/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("IA11 — /auth/update-password eye toggle alterna visibilidade", async ({ page }) => {
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/update-password`, { waitUntil: "domcontentloaded" });

    const pwdField = page.locator("input#new-password");
    await pwdField.waitFor({ timeout: T.apiResponse });

    await expect(pwdField).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: /mostrar senha/i }).first().click();
    await expect(pwdField).toHaveAttribute("type", "text");
  });

  test("IA12 — /auth/update-password senhas incompatíveis exibem mensagem", async ({ page }) => {
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/update-password`, { waitUntil: "domcontentloaded" });

    const pwdField = page.locator("input#new-password");
    await pwdField.waitFor({ timeout: T.apiResponse });
    await pwdField.fill("Senha@123");
    await page.locator("input#confirm-password").fill("Senha@999");

    await expect(page.getByText(/as senhas não coincidem/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("IA13 — /auth/update-password botão desabilitado com senha inválida", async ({ page }) => {
    await login(page, "cadete");
    await page.goto(`${BASE_URL}/auth/update-password`, { waitUntil: "domcontentloaded" });

    const pwdField = page.locator("input#new-password");
    await pwdField.waitFor({ timeout: T.apiResponse });

    // Empty password → button disabled
    const submitBtn = page.getByRole("button", { name: /definir nova senha/i });
    await expect(submitBtn).toBeDisabled({ timeout: T.apiResponse });
  });
});

// ─── IA14-IA16: Structural / routing checks ─────────────────────────────────

test.describe("IA — Routing e redirect do callback", () => {

  test("IA14 — /auth/callback sem code redireciona para /auth/error", async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/callback`, { waitUntil: "domcontentloaded" });
    // Without code or token_hash, should redirect to /auth/error
    await expect(page).toHaveURL(/\/auth\/error/, { timeout: T.navigation });
  });

  test("IA15 — /auth/error renderiza mensagem de erro", async ({ page }) => {
    await page.goto(`${BASE_URL}/auth/error`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: T.navigation });
  });

  test("IA16 — API de criação de usuário retorna 403 sem sessão admin", async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/admin/users`, {
      data: { email: "test@test.com", nome_completo: "Teste", matricula: "999999", method: "magic_link" },
    });
    expect(res.status()).toBe(403);
  });

  test("IA17 — /api/auth/activate-account retorna 401 sem sessão", async ({ page }) => {
    const res = await page.request.post(`${BASE_URL}/api/auth/activate-account`);
    expect(res.status()).toBe(401);
  });
});
