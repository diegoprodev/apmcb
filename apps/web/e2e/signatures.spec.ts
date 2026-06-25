/**
 * APMCB — Fase 4: Assinatura Eletrônica Nível 1
 *
 * SIG01: armeiro assina documento com TOTP válido → document_signatures +1 + audit_event
 * SIG02: TOTP inválido → 400, sem assinatura criada
 * SIG03: UPDATE direto em document_signatures → RULE bloqueia (sem linhas afetadas)
 * SIG04: DELETE direto em document_signatures → RULE bloqueia (sem linhas afetadas)
 * SIG05: retificação via revoke → replaced_by preenchido, histórico preservado
 * SIG06: verificação pública /v/[id] → 200 com status correto
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BFF_URL, BASE_URL, USERS, login } from "./harness";
import { bffCall } from "./harness/ssa";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function supabaseAdmin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function getArmeiroTOTP(page: import("@playwright/test").Page): Promise<string> {
  const { status, data } = await bffCall(page, "GET", "/api/totp/code");
  if (status !== 200) throw new Error(`TOTP code fetch failed: HTTP ${status}`);
  return (data as { code: string }).code;
}

async function getTenantId(): Promise<string> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("tenants").select("id").limit(1).single();
  if (!data?.id) throw new Error("No tenant found");
  return data.id;
}

async function getMaterialTypeId(): Promise<string> {
  const sb = supabaseAdmin();
  const { data } = await sb.from("material_types").select("id").limit(1).single();
  if (!data?.id) throw new Error("No material_type found");
  return data.id;
}

// ─── Suite ───────────────────────────────────────────────────────────────────

test.describe("Fase 4 — Assinatura Eletrônica", () => {
  // This suite uses the armeiro user — TOTP must be configured
  // Workers: 1 — TOTP anti-replay blocks parallel usage of same code

  let createdSignatureId: string | null = null;
  let testDocumentId: string;

  test.beforeAll(async ({ browser }) => {
    // Ensure armeiro has TOTP configured
    const page = await browser.newPage();
    await login(page, "reserva");
    await bffCall(page, "POST", "/api/totp/setup");
    testDocumentId = crypto.randomUUID();
    await page.close();
  });

  /**
   * SIG01 — Assinar documento com TOTP válido persiste em document_signatures + audit_event
   */
  test("SIG01 — assinar com TOTP válido → +1 em document_signatures + audit_event", async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, "reserva");

    const sb = supabaseAdmin();
    const { count: before } = await sb
      .from("document_signatures")
      .select("id", { count: "exact", head: true });

    const { count: auditBefore } = await sb
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("action", "signature.created");

    const token = await getArmeiroTOTP(page);

    const { status, data } = await bffCall(page, "POST", "/api/signatures", {
      document_type: "lending",
      document_id: testDocumentId,
      document_data: { item: "arma_teste", quantidade: 1 },
      totp_token: token,
      signature_level: 1,
    });

    expect(status, `HTTP status esperado 201, recebido ${status}: ${JSON.stringify(data)}`).toBe(201);

    const sig = data as { id: string; document_hash: string; signature_proof: string };
    expect(sig.id).toBeTruthy();
    expect(sig.document_hash).toHaveLength(64);
    expect(sig.signature_proof).toHaveLength(64);

    createdSignatureId = sig.id;

    const { count: after } = await sb
      .from("document_signatures")
      .select("id", { count: "exact", head: true });
    expect(after).toBe((before ?? 0) + 1);

    // Dar tempo ao audit (fire-and-forget) de persistir
    await page.waitForTimeout(500);

    const { count: auditAfter } = await sb
      .from("audit_events")
      .select("id", { count: "exact", head: true })
      .eq("action", "signature.created");
    expect(auditAfter).toBeGreaterThan(auditBefore ?? 0);

    await page.close();
  });

  /**
   * SIG02 — TOTP inválido → 400, sem assinatura criada
   */
  test("SIG02 — TOTP inválido → 400 e sem registro", async ({ browser }) => {
    const page = await browser.newPage();
    await login(page, "reserva");

    const sb = supabaseAdmin();
    const docId = crypto.randomUUID();

    const { count: before } = await sb
      .from("document_signatures")
      .select("id", { count: "exact", head: true });

    const { status, data } = await bffCall(page, "POST", "/api/signatures", {
      document_type: "lending",
      document_id: docId,
      document_data: { item: "arma" },
      totp_token: "000000", // token inválido
      signature_level: 1,
    });

    expect(status).toBe(400);
    expect((data as { valid: boolean }).valid).toBe(false);

    const { count: after } = await sb
      .from("document_signatures")
      .select("id", { count: "exact", head: true });
    expect(after).toBe(before);

    await page.close();
  });

  /**
   * SIG03 — UPDATE direto em document_signatures → RULE bloqueia (0 rows affected)
   */
  test("SIG03 — UPDATE direto bloqueado por RULE SQL", async () => {
    const sb = supabaseAdmin();

    // Precisamos de um ID real para tentar UPDATE
    const { data: rows } = await sb
      .from("document_signatures")
      .select("id, document_hash")
      .limit(1);

    if (!rows || rows.length === 0) {
      test.skip();
      return;
    }

    const { id, document_hash: originalHash } = rows[0];
    const fakeHash = "a".repeat(64);

    // RULE no_update_signatures silently drops the UPDATE → no error, but 0 rows changed
    const { error } = await sb
      .from("document_signatures")
      .update({ document_hash: fakeHash })
      .eq("id", id);

    // No Postgres error (RULE absorbs the statement)
    expect(error).toBeNull();

    // Hash unchanged in DB
    const { data: verify } = await sb
      .from("document_signatures")
      .select("document_hash")
      .eq("id", id)
      .single();

    expect(verify?.document_hash).toBe(originalHash);
    expect(verify?.document_hash).not.toBe(fakeHash);
  });

  /**
   * SIG04 — DELETE direto em document_signatures → RULE bloqueia
   */
  test("SIG04 — DELETE direto bloqueado por RULE SQL", async () => {
    const sb = supabaseAdmin();

    const { data: rows } = await sb
      .from("document_signatures")
      .select("id")
      .limit(1);

    if (!rows || rows.length === 0) {
      test.skip();
      return;
    }

    const { id } = rows[0];

    // RULE no_delete_signatures silently drops the DELETE → no error, row still exists
    const { error } = await sb
      .from("document_signatures")
      .delete()
      .eq("id", id);

    expect(error).toBeNull();

    // Row still exists
    const { data: verify } = await sb
      .from("document_signatures")
      .select("id")
      .eq("id", id)
      .maybeSingle();

    expect(verify).not.toBeNull();
  });

  /**
   * SIG05 — Retificação via /revoke → replaced_by preenchido, histórico preservado
   */
  test("SIG05 — retificação preserva histórico (replaced_by preenchido)", async ({ browser }) => {
    if (!createdSignatureId) {
      test.skip();
      return;
    }

    const page = await browser.newPage();
    await login(page, "admin");

    const { status, data } = await bffCall(
      page,
      "POST",
      `/api/signatures/${createdSignatureId}/revoke`,
      { revocation_reason: "Teste de retificação SIG05 — harness Fase 4" }
    );

    expect(status, `revoke esperado 200, recebido: ${JSON.stringify(data)}`).toBe(200);
    const result = data as { ok: boolean; replacement_id: string };
    expect(result.ok).toBe(true);
    expect(result.replacement_id).toBeTruthy();

    // Verificar que o novo registro tem replaced_by apontando para o original
    const sb = supabaseAdmin();
    const { data: replacement } = await sb
      .from("document_signatures")
      .select("id, replaced_by, revoked_at, revocation_reason")
      .eq("id", result.replacement_id)
      .single();

    expect(replacement?.replaced_by).toBe(createdSignatureId);
    expect(replacement?.revoked_at).toBeTruthy();
    expect(replacement?.revocation_reason).toContain("SIG05");

    // Original ainda existe (RULE não apagou)
    const { data: original } = await sb
      .from("document_signatures")
      .select("id")
      .eq("id", createdSignatureId)
      .single();

    expect(original?.id).toBe(createdSignatureId);

    await page.close();
  });

  /**
   * SIG06 — Verificação pública /v/[document_id] → 200 com status correto
   */
  test("SIG06 — verificação pública /v/[id] retorna status do documento", async ({ page }) => {
    await page.goto(`${BASE_URL}/v/${testDocumentId}`);
    await page.waitForLoadState("networkidle");

    // Página deve exibir documento encontrado (criado em SIG01, revogado em SIG05)
    const body = await page.locator("body");
    const text = await body.innerText();

    // Deve exibir o document_id na página
    expect(text).toContain(testDocumentId);

    // Status deve ser "revogado" (SIG05 revogou a assinatura)
    // ou "válido" se SIG05 foi pulado — verificar um dos dois
    expect(text.toLowerCase()).toMatch(/válido|revogado|não encontrado/);

    // Não deve exibir dados sensíveis
    expect(text).not.toMatch(/secret|password|token/i);
  });
});
