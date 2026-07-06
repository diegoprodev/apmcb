/**
 * SSA-FLUX — Regressão: Fluxo "Solicitar Armamento" ponta-a-ponta
 *
 * Guarda contra a regressão onde POST /api/ssa/requests retornava 500
 * por TypeError no mapeamento itemRows (mat undefined) ou por erro não tratado.
 *
 * SSA-01: GET /available-materials autenticado → 200 com lista
 * SSA-02: POST /requests TOTP inválido → 400 (não 500)
 * SSA-03: POST /requests payload inválido → 400 (Zod)
 * SSA-04: POST /requests com solicitação pendente existente → 403
 * SSA-05: POST /requests com TOTP válido → 201 com request_id
 *
 * Run:
 *   pnpm exec playwright test e2e/fluxo-ssa.spec.ts --project=fluxo-ssa
 */

import { test, expect } from "@playwright/test";
import { login } from "./harness";
import {
  bffCall,
  getTOTPCode,
  getFirstAvailableMaterial,
  cleanupRequests,
  createMaterialRequest,
} from "./harness/ssa";

test.beforeEach(async () => {
  await cleanupRequests();
});

// ── SSA-01 ────────────────────────────────────────────────────────────────────
test("SSA-01 — GET /available-materials autenticado retorna lista sem campos de quantidade", async ({ page }) => {
  await login(page, "efetivo");

  const { status, data } = await bffCall(page, "GET", "/api/ssa/available-materials");

  expect(status).toBe(200);
  const items = data as Record<string, unknown>[];
  expect(Array.isArray(items)).toBe(true);
  expect(items.length).toBeGreaterThan(0);

  for (const item of items) {
    expect(item.quantidade_disponivel, "campo de quantidade não deve ser exposto").toBeUndefined();
    expect(item.disponivel).toBe(true);
  }
});

// ── SSA-02 ────────────────────────────────────────────────────────────────────
test("SSA-02 — POST /requests TOTP inválido → 400, jamais 500", async ({ page }) => {
  // Antes do fix: TypeError uncaught no mapeamento itemRows poderia causar 500.
  // Com TOTP errado, agora deve retornar 400 antes de chegar no mapeamento.
  await login(page, "efetivo");

  const material = await getFirstAvailableMaterial(page);

  const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
    items: [{ material_type_id: material.id, quantity: 1 }],
    totp_token: "000000",
  });

  expect(
    status,
    `POST /requests com TOTP inválido deveria retornar 400, retornou ${status}: ${JSON.stringify(data)}`
  ).toBe(400);

  expect(status).not.toBe(500);
});

// ── SSA-03 ────────────────────────────────────────────────────────────────────
test("SSA-03 — POST /requests payload inválido → 400 (Zod validation)", async ({ page }) => {
  await login(page, "efetivo");

  const { status } = await bffCall(page, "POST", "/api/ssa/requests", {
    items: [], // min(1) violado
    totp_token: "123456",
  });

  expect(status).toBe(400);
});

// ── SSA-04 ────────────────────────────────────────────────────────────────────
test("SSA-04 — POST /requests com solicitação pendente existente → 403", async ({ page }) => {
  await login(page, "efetivo");

  // Criar primeira solicitação
  await createMaterialRequest(page);

  // Tentar criar segunda — deve retornar 403
  const material = await getFirstAvailableMaterial(page);
  const code = await getTOTPCode(page);

  const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
    items: [{ material_type_id: material.id, quantity: 1 }],
    totp_token: code,
  });

  expect(
    status,
    `Segunda solicitação deveria retornar 403, retornou ${status}: ${JSON.stringify(data)}`
  ).toBe(403);
});

// ── SSA-05 ────────────────────────────────────────────────────────────────────
test("SSA-05 — POST /requests TOTP válido → 201 com request_id", async ({ page }) => {
  await login(page, "efetivo");

  const material = await getFirstAvailableMaterial(page);
  const code = await getTOTPCode(page);

  const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
    items: [{ material_type_id: material.id, quantity: 1 }],
    totp_token: code,
  });

  expect(
    status,
    `POST /requests com TOTP válido deveria retornar 201, retornou ${status}: ${JSON.stringify(data)}`
  ).toBe(201);

  const body = data as { request_id?: string; status?: string };
  expect(typeof body.request_id).toBe("string");
  expect(body.status).toBe("pendente");
});
