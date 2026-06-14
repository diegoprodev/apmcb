/**
 * SSA Enterprise Stress & Validation Harness — ESS01–ESS12
 *
 * Tests concurrent access, data consistency, audit immutability,
 * secret leakage prevention, and full happy-path flows.
 *
 * IMPORTANT: Run with workers=1 to isolate race-condition tests.
 *   npx playwright test ssa-stress.spec.ts --project=ssa-stress
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";
import {
  bffCall, setupTOTP, getTOTPCode,
  createMaterialRequest, cleanupRequests,
  getFirstAvailableMaterial, forceExpireRequest,
  resetTOTPFailures, assertAuditLog,
} from "./harness/ssa";
import { createClient } from "@supabase/supabase-js";

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

test.describe("ESS — Enterprise Stress & Validation", () => {

  // ── ESS01 — Race condition: duplo submit ──────────────────────────────────
  test("ESS01 - concurrent submit: apenas 1 pedido criado de 2 simultâneos", async ({ browser }) => {
    await cleanupRequests();

    // Two isolated contexts, both logged in as cadete
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const p1 = await ctx1.newPage();
    const p2 = await ctx2.newPage();

    await login(p1, "cadete");
    await login(p2, "cadete");

    await setupTOTP(p1);
    const material = await getFirstAvailableMaterial(p1);
    const code1 = await getTOTPCode(p1);
    const code2 = await getTOTPCode(p2);

    const [r1, r2] = await Promise.all([
      bffCall(p1, "POST", "/api/ssa/requests", {
        items: [{ material_type_id: material.id, quantity: 1 }],
        totp_token: code1,
      }),
      bffCall(p2, "POST", "/api/ssa/requests", {
        items: [{ material_type_id: material.id, quantity: 1 }],
        totp_token: code2,
      }),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    // One 201 and one 403 expected
    expect(statuses).toEqual([201, 403]);

    await ctx1.close();
    await ctx2.close();
  });

  // ── ESS02 — Race condition: dupla aprovação ────────────────────────────────
  test("ESS02 - concurrent approve: apenas 1 aprovação aceita (sem duplicata)", async ({ browser }) => {
    await cleanupRequests();
    const pg = await (await browser.newContext()).newPage();
    await login(pg, "cadete");
    await setupTOTP(pg);
    const { request_id } = await createMaterialRequest(pg);

    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const a1 = await ctx1.newPage();
    const a2 = await ctx2.newPage();
    await login(a1, "armeiro");
    await login(a2, "armeiro");

    const [r1, r2] = await Promise.all([
      bffCall(a1, "PATCH", `/api/ssa/requests/${request_id}/approve`),
      bffCall(a2, "PATCH", `/api/ssa/requests/${request_id}/approve`),
    ]);

    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses[0]).toBe(200);
    expect([409, 404, 400]).toContain(statuses[1]);

    await ctx1.close();
    await ctx2.close();
  });

  // ── ESS03 — Consistência: deliver cria lending ativo ─────────────────────
  test("ESS03 - consistência de estoque: deliver cria lending com status=ativo", async ({ page }) => {
    await cleanupRequests();
    await login(page, "cadete");
    await setupTOTP(page);
    const material = await getFirstAvailableMaterial(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    const { data } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/deliver`);
    const { lending_ids } = data as { lending_ids: string[] };

    // Verify lending exists in DB
    const db = supabaseAdmin();
    const { data: lendings } = await db
      .from("lendings")
      .select("id, status, material_type_id")
      .in("id", lending_ids);

    expect(lendings?.length).toBeGreaterThan(0);
    for (const l of lendings ?? []) {
      expect(l.status).toBe("ativo");
      expect(l.material_type_id).toBe(material.id);
    }
  });

  // ── ESS04 — Rate limit TOTP bloqueia e libera após reset ─────────────────
  test("ESS04 - rate limit TOTP: 5 falhas bloqueiam, reset libera", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    await resetTOTPFailures();

    await login(page, "armeiro");
    const { data: lookupData } = await bffCall(page, "GET", "/api/ssa/lookup-military?matricula=000003");
    const militaryId = (lookupData as { id: string }).id;

    for (let i = 0; i < 5; i++) {
      await bffCall(page, "POST", "/api/totp/validate", { military_id: militaryId, token: "000000" });
    }

    const { status: blockedStatus } = await bffCall(page, "POST", "/api/totp/validate", {
      military_id: militaryId,
      token: "000000",
    });
    expect(blockedStatus).toBe(429);

    await resetTOTPFailures();

    // After reset, valid code should work
    await login(page, "cadete");
    const code = await getTOTPCode(page);
    await login(page, "armeiro");
    const { data: valData } = await bffCall(page, "POST", "/api/totp/validate", {
      military_id: militaryId,
      token: code,
    });
    expect((valData as { valid: boolean }).valid).toBe(true);
  });

  // ── ESS05 — audit_logs imutáveis (DELETE bloqueado) ───────────────────────
  test("ESS05 - audit_logs SSA são imutáveis: DELETE via service_role é bloqueado", async ({ page }) => {
    await cleanupRequests();
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    const db = supabaseAdmin();
    const { data: logs } = await db
      .from("audit_logs")
      .select("id")
      .eq("resource_id", request_id);

    expect(logs?.length).toBeGreaterThan(0);

    const { error } = await db
      .from("audit_logs")
      .delete()
      .eq("resource_id", request_id);

    // If RULE blocks DELETE, error is returned
    expect(error).toBeTruthy();
  });

  // ── ESS06 — Secret nunca vaza em endpoints públicos ───────────────────────
  test("ESS06 - secret TOTP ausente em todos os endpoints SSA/TOTP", async ({ page }) => {
    await login(page, "cadete");
    await setupTOTP(page);
    await cleanupRequests();
    await createMaterialRequest(page);

    const endpoints = [
      "/api/totp/code",
      "/api/totp/status",
      "/api/ssa/available-materials",
      "/api/ssa/requests",
    ];

    for (const ep of endpoints) {
      const { data } = await bffCall(page, "GET", ep);
      const raw = JSON.stringify(data);
      expect(raw, `Endpoint ${ep} leaked 'secret'`).not.toMatch(/secret/i);
      expect(raw, `Endpoint ${ep} leaked Base32 pattern`).not.toMatch(/[A-Z2-7]{16,}/);
    }
  });

  // ── ESS07 — Fluxo completo Modo B ─────────────────────────────────────────
  test("ESS07 - fluxo completo Modo B: pendente → aprovado → retirado + audit trail", async ({ page }) => {
    await cleanupRequests();
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    // Approve
    await login(page, "armeiro");
    const { status: s1, data: d1 } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    expect(s1).toBe(200);
    expect((d1 as { ok: boolean }).ok).toBe(true);

    // Verify state = aprovado
    const { data: midList } = await bffCall(page, "GET", "/api/ssa/requests");
    const mid = (midList as { id: string; status: string; expires_at: string }[]).find((r) => r.id === request_id);
    expect(mid?.status).toBe("aprovado");
    expect(mid?.expires_at).toBeTruthy();

    // Deliver
    const { status: s2, data: d2 } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/deliver`);
    expect(s2).toBe(200);
    expect((d2 as { lending_ids: string[] }).lending_ids.length).toBeGreaterThan(0);

    // Final state = retirado
    const { data: finalList } = await bffCall(page, "GET", "/api/ssa/requests");
    const final = (finalList as { id: string; status: string; delivered_at: string }[]).find((r) => r.id === request_id);
    expect(final?.status).toBe("retirado");
    expect(final?.delivered_at).toBeTruthy();

    // Audit trail
    await assertAuditLog(request_id, "ssa.solicitado");
    await assertAuditLog(request_id, "ssa.aprovado");
    await assertAuditLog(request_id, "ssa.retirado");
  });

  // ── ESS08 — Fluxo completo Modo A ─────────────────────────────────────────
  test("ESS08 - fluxo completo Modo A: armeiro cria+entrega em única chamada", async ({ page }) => {
    await cleanupRequests();
    await login(page, "cadete");
    await setupTOTP(page);
    const code = await getTOTPCode(page);
    const material = await getFirstAvailableMaterial(page);

    const { data: lookupData } = await bffCall(page, "GET", "/api/ssa/lookup-military?matricula=000003");
    const militaryId = (lookupData as { id: string }).id;

    // Modo A: switch to armeiro
    await login(page, "armeiro");
    const { status, data } = await bffCall(page, "POST", "/api/ssa/modo-a", {
      military_id: militaryId,
      totp_token: code,
      items: [{ material_type_id: material.id, quantity: 1 }],
    });

    expect(status).toBe(200);
    const body = data as { ok: boolean; request_id: string; lending_ids: string[] };
    expect(body.ok).toBe(true);
    expect(body.lending_ids.length).toBeGreaterThan(0);

    // Verify lending in DB
    const db = supabaseAdmin();
    const { data: lendings } = await db.from("lendings").select("status").in("id", body.lending_ids);
    expect(lendings?.every((l) => l.status === "ativo")).toBe(true);
  });

  // ── ESS09 — Rejeição permite nova solicitação ──────────────────────────────
  test("ESS09 - após rejeição, cadete pode fazer nova solicitação imediatamente", async ({ page }) => {
    await cleanupRequests();
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/reject`, {
      reason: "Material em manutenção preventiva agendada",
    });

    // Cadete tries again
    await login(page, "cadete");
    const { request_id: request_id_2 } = await createMaterialRequest(page);
    expect(request_id_2).not.toBe(request_id);
    expect(request_id_2).toMatch(/^[0-9a-f-]{36}$/);
  });

  // ── ESS10 — Auto-expiração via expire_material_requests() ─────────────────
  test("ESS10 - expire_material_requests() expira aprovados vencidos sem afetar outros", async ({ page }) => {
    await cleanupRequests();
    await login(page, "cadete");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "armeiro");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);

    // Force expiry
    await forceExpireRequest(request_id);

    // Cadete sees status = expirado
    await login(page, "cadete");
    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const req = (data as { id: string; status: string }[]).find((r) => r.id === request_id);
    expect(req?.status).toBe("expirado");

    // After expiry, cadete can make new request (expired != active)
    const { request_id: newId } = await createMaterialRequest(page);
    expect(newId).toBeTruthy();
  });

  // ── ESS11 — Modo A com TOTP inválido → 400 ────────────────────────────────
  test("ESS11 - modo-a com código TOTP inválido retorna 400", async ({ page }) => {
    await cleanupRequests();
    await login(page, "cadete");
    await setupTOTP(page);
    const material = await getFirstAvailableMaterial(page);

    const { data: lookupData } = await bffCall(page, "GET", "/api/ssa/lookup-military?matricula=000003");
    const militaryId = (lookupData as { id: string }).id;

    await login(page, "armeiro");
    const { status } = await bffCall(page, "POST", "/api/ssa/modo-a", {
      military_id: militaryId,
      totp_token: "000000",
      items: [{ material_type_id: material.id, quantity: 1 }],
    });
    expect(status).toBe(400);
  });

  // ── ESS12 — Performance: GET /requests armeiro < 800ms ────────────────────
  test("ESS12 - performance: GET /api/ssa/requests (armeiro) responde em < 800ms", async ({ page }) => {
    await login(page, "armeiro");
    const start = Date.now();
    const { status } = await bffCall(page, "GET", "/api/ssa/requests");
    const elapsed = Date.now() - start;
    expect(status).toBe(200);
    expect(elapsed, `Response took ${elapsed}ms, expected < 800ms`).toBeLessThan(800);
  });
});
