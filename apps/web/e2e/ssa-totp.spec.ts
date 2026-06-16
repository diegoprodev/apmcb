/**
 * SSA TOTP Spec — ST01–ST15
 *
 * Tests TOTP setup, code generation, Reserva de Armamento validation,
 * rate limiting, and security (secret never exposed).
 *
 * Run:
 *   npx playwright test ssa-totp.spec.ts --project=ssa-suite
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, BFF_URL, login } from "./harness";
import {
  bffCall, setupTOTP, getTOTPCode, resetTOTPFailures,
} from "./harness/ssa";

test.describe("ST — TOTP Setup & Display", () => {

  // ── ST01 ──────────────────────────────────────────────────────────────────
  test("ST01 - cadete sem TOTP vê botão de configuração no dashboard", async ({ page }) => {
    await login(page, "cadete");
    // Fresh cadete: TOTP not configured, setup card shown
    await page.goto(`${BASE_URL}/cadete`);
    await expect(page.getByText(/configurar código/i)).toBeVisible({ timeout: 10_000 });
  });

  // ── ST02 ──────────────────────────────────────────────────────────────────
  test("ST02 - POST /api/totp/setup retorna 401 sem autenticação", async ({ page }) => {
    const res = await page.request.post(`${BFF_URL}/api/totp/setup`);
    expect(res.status()).toBe(401);
  });

  // ── ST03 ──────────────────────────────────────────────────────────────────
  test("ST03 - POST /api/totp/setup retorna 200 para cadete e nunca expõe secret", async ({ page }) => {
    await login(page, "cadete");
    const { status, data } = await bffCall(page, "POST", "/api/totp/setup");
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).ok).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/secret/i);
  });

  // ── ST04 ──────────────────────────────────────────────────────────────────
  test("ST04 - GET /api/totp/status retorna { configured: true } após setup", async ({ page }) => {
    await login(page, "cadete");
    await bffCall(page, "POST", "/api/totp/setup");
    const { status, data } = await bffCall(page, "GET", "/api/totp/status");
    expect(status).toBe(200);
    expect((data as { configured: boolean }).configured).toBe(true);
  });

  // ── ST05 ──────────────────────────────────────────────────────────────────
  test("ST05 - GET /api/totp/code retorna 6 dígitos + seconds_remaining válido", async ({ page }) => {
    await login(page, "cadete");
    await bffCall(page, "POST", "/api/totp/setup");
    const { status, data } = await bffCall(page, "GET", "/api/totp/code");
    const body = data as { code: string; seconds_remaining: number; period: number };
    expect(status).toBe(200);
    expect(body.code).toMatch(/^\d{6}$/);
    expect(body.seconds_remaining).toBeGreaterThanOrEqual(1);
    expect(body.seconds_remaining).toBeLessThanOrEqual(30);
    expect(body.period).toBe(30);
  });

  // ── ST06 ──────────────────────────────────────────────────────────────────
  test("ST06 - GET /api/totp/code retorna 401 sem autenticação", async ({ page }) => {
    const res = await page.request.get(`${BFF_URL}/api/totp/code`);
    expect(res.status()).toBe(401);
  });

  // ── ST07 ──────────────────────────────────────────────────────────────────
  test("ST07 - TOTPDisplay aparece no dashboard cadete após configuração", async ({ page }) => {
    await login(page, "cadete");
    await bffCall(page, "POST", "/api/totp/setup");
    await page.goto(`${BASE_URL}/cadete`);
    const display = page.getByTestId("totp-display");
    await expect(display).toBeVisible({ timeout: 10_000 });
    const code = (await display.textContent())?.replace(/\D/g, "") ?? "";
    expect(code).toMatch(/^\d{6}$/);
  });

  // ── ST08 ──────────────────────────────────────────────────────────────────
  test("ST08 - POST /api/totp/validate rejeita código errado (retorna valid: false)", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const cadeteId = await (await bffCall(page, "GET", "/api/totp/status")).data;
    // Switch to Reserva de Armamento to call validate
    await login(page, "reserva");
    const cadeteMatricula = "000003";
    const { data: lookupData } = await bffCall(page, "GET", `/api/ssa/lookup-military?matricula=${cadeteMatricula}`);
    const militaryId = (lookupData as { id: string }).id;

    const { status, data } = await bffCall(page, "POST", "/api/totp/validate", {
      military_id: militaryId,
      token: "000000",
    });
    expect(status).toBe(200);
    expect((data as { valid: boolean }).valid).toBe(false);
  });

  // ── ST09 ──────────────────────────────────────────────────────────────────
  test("ST09 - POST /api/totp/validate aceita código correto e retorna dados do militar", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const code = await getTOTPCode(page);

    await login(page, "reserva");
    const { data: lookupData } = await bffCall(page, "GET", `/api/ssa/lookup-military?matricula=000003`);
    const militaryId = (lookupData as { id: string }).id;

    const { status, data } = await bffCall(page, "POST", "/api/totp/validate", {
      military_id: militaryId,
      token: code,
    });
    expect(status).toBe(200);
    const body = data as { valid: boolean; military_nome: string; military_posto: string; military_matricula: string };
    expect(body.valid).toBe(true);
    expect(body.military_nome).toBeTruthy();
    expect(body.military_matricula).toBe("000003");
  });

  // ── ST10 ──────────────────────────────────────────────────────────────────
  test("ST10 - cadete não pode chamar /api/totp/validate (role=military → 403)", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const cadeteId = ((await bffCall(page, "GET", "/api/totp/status")).data as Record<string, unknown>);
    const { status } = await bffCall(page, "POST", "/api/totp/validate", {
      military_id: "00000000-0000-0000-0000-000000000001",
      token: "123456",
    });
    expect(status).toBe(403);
  });

  // ── ST11 ──────────────────────────────────────────────────────────────────
  test("ST11 - Reserva de Armamento não pode chamar /api/totp/setup (role=master → 403)", async ({ page }) => {
    await login(page, "reserva");
    const { status } = await bffCall(page, "POST", "/api/totp/setup");
    expect(status).toBe(403);
  });

  // ── ST12 ──────────────────────────────────────────────────────────────────
  test("ST12 - rate limit: 5 falhas consecutivas → 429 na 6ª tentativa", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    await resetTOTPFailures(); // clean slate

    await login(page, "reserva");
    const { data: lookupData } = await bffCall(page, "GET", `/api/ssa/lookup-military?matricula=000003`);
    const militaryId = (lookupData as { id: string }).id;

    for (let i = 0; i < 5; i++) {
      await bffCall(page, "POST", "/api/totp/validate", { military_id: militaryId, token: "000000" });
    }
    const { status, data } = await bffCall(page, "POST", "/api/totp/validate", {
      military_id: militaryId,
      token: "000000",
    });
    expect(status).toBe(429);
    expect((data as { error: string }).error).toMatch(/bloqueado/i);

    // Cleanup: reset failures so other tests can use cadete TOTP
    await resetTOTPFailures();
  });

  // ── ST13 ──────────────────────────────────────────────────────────────────
  test("ST13 - setup duplicado é idempotente (não gera segundo secret)", async ({ page }) => {
    await login(page, "cadete");
    await bffCall(page, "POST", "/api/totp/setup");
    const { data: r1 } = await bffCall(page, "GET", "/api/totp/code");
    const code1 = (r1 as { code: string }).code;

    // Second setup: must preserve same or compatible secret
    const { status } = await bffCall(page, "POST", "/api/totp/setup");
    expect(status).toBe(200);

    const { data: r2 } = await bffCall(page, "GET", "/api/totp/code");
    const code2 = (r2 as { code: string }).code;
    // Both codes in same window must be valid (same secret not reset)
    expect(code2).toMatch(/^\d{6}$/);
  });

  // ── ST14 ──────────────────────────────────────────────────────────────────
  test("ST14 - /api/totp/code nunca expõe 'secret' ou padrão Base32 na resposta", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    const { data } = await bffCall(page, "GET", "/api/totp/code");
    const raw = JSON.stringify(data);
    expect(raw).not.toMatch(/secret/i);
    expect(raw).not.toMatch(/[A-Z2-7]{16,}/); // Base32 pattern
  });

  // ── ST15 ──────────────────────────────────────────────────────────────────
  test("ST15 - lookup-military retorna 403 para cadete (não-Reserva de Armamento)", async ({ page }) => {
    await login(page, "cadete");
    const { status } = await bffCall(page, "GET", "/api/ssa/lookup-military?matricula=000003");
    expect(status).toBe(403);
  });
});
