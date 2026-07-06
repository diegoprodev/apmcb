/**
 * RECV — Regressão: Fluxo "Receber Material" (DesarmamentoModal)
 *
 * Guarda contra a regressão onde checkTotpForMatricula filtrava profiles
 * por tenant_id (coluna inexistente) → PostgREST 400 → 404 "Credenciais inválidas"
 * mesmo para usuários válidos com TOTP correto.
 *
 * RECV-01: identify com matrícula conhecida + TOTP errado → 401 (NÃO 404 por bug de tenant)
 * RECV-02: identify com matrícula desconhecida → 404
 * RECV-03: identify com payload inválido → 400 (Zod validation)
 * RECV-04: modal abre ao clicar "Receber Material"
 * RECV-05: identify com TOTP válido do cadete retorna profile (não 500)
 *
 * Run:
 *   pnpm exec playwright test e2e/fluxo-receber.spec.ts --project=fluxo-receber
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";
import { bffCall, getTOTPCode, cleanupRequests } from "./harness/ssa";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CADETE_MATRICULA = "000003";

test.beforeEach(async () => {
  await cleanupRequests();
});

// ── RECV-01 ───────────────────────────────────────────────────────────────────
test("RECV-01 — identify matrícula válida + TOTP errado → 401, nunca 404", async ({ page }) => {
  // Antes do fix: .eq("tenant_id") causava 404 mesmo com matrícula existente.
  // Agora deve retornar 401 (credenciais erradas — profile encontrado, código inválido).
  await login(page, "reserva"); // armeiro

  const { status, data } = await bffCall(page, "POST", "/api/lendings/identify", {
    mode: "totp",
    matricula: CADETE_MATRICULA,
    code: "000000",
  });

  expect(
    status,
    `identify deveria retornar 401 (TOTP errado) mas retornou ${status}: ${JSON.stringify(data)}`
  ).toBe(401);

  const body = data as { error?: string };
  expect(body.error).toMatch(/credenciais inválidas/i);
});

// ── RECV-02 ───────────────────────────────────────────────────────────────────
test("RECV-02 — identify matrícula inexistente → 404", async ({ page }) => {
  await login(page, "reserva");

  const { status } = await bffCall(page, "POST", "/api/lendings/identify", {
    mode: "totp",
    matricula: "999999",
    code: "123456",
  });

  expect(status).toBe(404);
});

// ── RECV-03 ───────────────────────────────────────────────────────────────────
test("RECV-03 — identify sem campos obrigatórios → 400 (validação Zod)", async ({ page }) => {
  await login(page, "reserva");

  const { status } = await bffCall(page, "POST", "/api/lendings/identify", {
    mode: "totp",
    // sem matricula nem code
  });

  expect(status).toBe(400);
});

// ── RECV-04 ───────────────────────────────────────────────────────────────────
test("RECV-04 — modal 'Receber Material' abre ao clicar no botão", async ({ page }) => {
  await login(page, "reserva");
  await page.goto(`${BASE_URL}/reserva/saidas`, { waitUntil: "domcontentloaded" });

  const btn = page.locator("button").filter({ hasText: /Receber Material/i }).first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  await expect(
    page.locator("h3, [role='dialog'] h2, [data-slot='dialog-title']").filter({ hasText: /Receber Material/i })
  ).toBeVisible({ timeout: 8_000 });
});

// ── RECV-05 ───────────────────────────────────────────────────────────────────
test("RECV-05 — identify com TOTP válido do cadete → 200 com profile", async ({ page, browser }) => {
  // Passo 1: obter TOTP code atual como efetivo (cadete)
  const cadeteCtx = await browser.newContext();
  const cadetePage = await cadeteCtx.newPage();
  await login(cadetePage, "efetivo");
  const code = await getTOTPCode(cadetePage);
  await cadeteCtx.close();

  // Passo 2: como armeiro, chamar identify com o código real
  await login(page, "reserva");
  const { status, data } = await bffCall(page, "POST", "/api/lendings/identify", {
    mode: "totp",
    matricula: CADETE_MATRICULA,
    code,
  });

  expect(
    status,
    `identify com TOTP válido deveria retornar 200, retornou ${status}: ${JSON.stringify(data)}`
  ).toBe(200);

  const body = data as { profile?: { matricula?: string } };
  expect(body.profile?.matricula).toBe(CADETE_MATRICULA);
});
