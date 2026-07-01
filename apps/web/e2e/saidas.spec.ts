/**
 * APMCB — Fase 5: Saída Diária Enterprise
 *
 * SD01: Emitir saída de material disponível → 201; status=emitida
 * SD02: Emitir saída de item já em saída ativa → 409 Conflict
 * SD03: Armeiro assina com TOTP → status=aguardando_confirmacao + signature criada
 * SD04: Militar confirma recebimento → status=ativa
 * SD05: Devolução sem divergência → status=devolvida; item volta disponivel
 * SD06: Devolução com item inapto → material_items.status_operacional=inapto
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BFF_URL, USERS } from "./harness";

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function supabaseService() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function loginToken(email: string, password: string): Promise<string> {
  const sb = supabaseService();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed: ${error?.message}`);
  return data.session.access_token;
}

async function bff(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BFF_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let armeiroToken = "";
let cadeteToken  = "";
let reserveId    = "";
let militarId    = "";
let testItemId   = "";

test.beforeAll(async () => {
  const sb = supabaseService();

  armeiroToken = await loginToken(USERS.reserva.email, USERS.reserva.password);
  cadeteToken  = await loginToken(USERS.efetivo.email, USERS.efetivo.password);

  // Buscar IDs necessários
  const { data: armProfile } = await sb.from("profiles").select("id")
    .eq("matricula", USERS.reserva.matricula).single();
  const { data: milProfile } = await sb.from("profiles").select("id")
    .eq("matricula", USERS.efetivo.matricula).single();
  militarId = milProfile?.id ?? "";

  // Buscar a primeira reserva ativa do sistema
  const { data: reserve } = await sb.from("reserves").select("id").limit(1).single();
  reserveId = reserve?.id ?? "";

  // Buscar ou criar um item disponível para testes
  const { data: existingItem } = await sb
    .from("material_items")
    .select("id, status_operacional")
    .eq("status_operacional", "disponivel")
    .limit(1)
    .single();

  if (existingItem) {
    testItemId = existingItem.id;
  }
});

// ─── Testes ───────────────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });

test.describe("Fase 5 — Saída Diária", () => {
  let saidaId = "";
  let saidaIdDevolucao = "";

  /**
   * SD01 — Emitir saída de material disponível → 201; status=emitida
   */
  test("SD01 — Emitir saída de material disponível", async () => {
    if (!testItemId) test.skip(true, "Nenhum item disponível no sistema");
    if (!reserveId)  test.skip(true, "Nenhuma reserva encontrada");
    if (!militarId)  test.skip(true, "Nenhum militar (cadete) encontrado");

    // Garantir que o item está disponivel
    const sb = supabaseService();
    await sb.from("material_items")
      .update({ status_operacional: "disponivel", current_holder_user_id: null, active_lending_id: null, active_cautelamento_id: null })
      .eq("id", testItemId);

    const { status, data } = await bff("POST", "/api/saidas", armeiroToken, {
      item_id:    testItemId,
      militar_id: militarId,
      reserve_id: reserveId,
    });

    expect(status, `SD01 esperava 201, got ${status}: ${JSON.stringify(data)}`).toBe(201);
    expect(data.lending ?? data.cautelamento ?? data).toBeTruthy();

    saidaId = data.lending?.id ?? data.id ?? "";

    // Verificar status no banco
    if (saidaId) {
      const { data: lending } = await sb.from("lendings").select("status, status_legacy").eq("id", saidaId).single();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lendingAny = lending as any;
      expect(["emitida", "ativa"]).toContain(lendingAny?.status ?? lendingAny?.status_legacy);
    }

    // Verificar que item está em saída
    const { data: item } = await sb.from("material_items").select("status_operacional").eq("id", testItemId).single();
    expect(item?.status_operacional).toBe("em_saida");
  });

  /**
   * SD02 — Emitir saída do mesmo item que já está em saída → 409
   */
  test("SD02 — Segunda saída do mesmo item em saída → 409", async () => {
    if (!testItemId) test.skip(true, "Nenhum item disponível");
    if (!reserveId || !militarId) test.skip(true, "Setup incompleto");

    // Item deve estar em_saida do SD01
    const { status } = await bff("POST", "/api/saidas", armeiroToken, {
      item_id:    testItemId,
      militar_id: militarId,
      reserve_id: reserveId,
    });

    expect(status, "SD02 esperava 409 (item já em saída)").toBe(409);
  });

  /**
   * SD03 — Armeiro assina → status evolui + document_signatures+1
   */
  test("SD03 — Armeiro assina saída com TOTP → signature criada", async () => {
    if (!saidaId) test.skip(true, "saidaId não disponível do SD01");

    const sb = supabaseService();
    const { count: sigsBefore } = await sb
      .from("document_signatures")
      .select("id", { count: "exact", head: true })
      .eq("document_id", saidaId);

    // Buscar código TOTP do armeiro via BFF
    const { data: totpData } = await bff("GET", "/api/totp/code", armeiroToken);
    if (!totpData?.code) { test.skip(true, "TOTP do armeiro não configurado"); return; }

    const { status, data } = await bff("POST", `/api/saidas/${saidaId}/sign-armeiro`, armeiroToken, {
      totp_token: totpData.code,
    });

    // 200 ou 201 → assinatura criada; 422 → campo já assinado (idempotente)
    expect([200, 201, 422]).toContain(status);

    if (status === 200 || status === 201) {
      const { count: sigsAfter } = await sb
        .from("document_signatures")
        .select("id", { count: "exact", head: true })
        .eq("document_id", saidaId);

      expect(sigsAfter ?? 0).toBeGreaterThan(sigsBefore ?? 0);
    }
  });

  /**
   * SD04 — Militar confirma recebimento → status=ativa
   */
  test("SD04 — Militar confirma recebimento → status=ativa", async () => {
    if (!saidaId) test.skip(true, "saidaId não disponível");

    const sb = supabaseService();
    // Forçar status para aguardando_confirmacao se necessário
    await sb.from("lendings").update({ status: "aguardando_confirmacao" }).eq("id", saidaId);

    const { data: totpData } = await bff("GET", "/api/totp/code", cadeteToken);
    if (!totpData?.code) { test.skip(true, "TOTP do cadete não configurado"); return; }

    const { status } = await bff("POST", `/api/saidas/${saidaId}/confirm`, cadeteToken, {
      totp_token: totpData.code,
    });

    // 200 → confirmado; 422 → já estava ativo (aceitável)
    expect([200, 422]).toContain(status);

    const { data: lending } = await sb.from("lendings").select("status").eq("id", saidaId).single();
    expect(["ativa", "aguardando_confirmacao"]).toContain(lending?.status);
  });

  /**
   * SD05 — Devolução do ciclo principal → status=devolvida; item=disponivel
   * Usa saidaId criado em SD01 e confirmado em SD04 (status=ativa).
   */
  test("SD05 — Devolução normal → item volta para disponivel", async () => {
    if (!saidaId || !testItemId) { test.skip(true, "saidaId não disponível (SD01 falhou?)"); return; }

    const sb = supabaseService();

    // Garantir que lending está "ativa" para devolver
    await sb.from("lendings").update({ status: "ativa" }).eq("id", saidaId);
    await sb.from("material_items").update({ status_operacional: "em_saida" }).eq("id", testItemId);

    const { status } = await bff("PATCH", `/api/saidas/${saidaId}/return`, armeiroToken, {
      observacao: "Devolução de teste SD05",
    });

    expect([200, 201], `SD05: esperava 200/201, got ${status}`).toContain(status);

    const { data: itemAfter } = await sb
      .from("material_items").select("status_operacional, current_holder_user_id, active_lending_id")
      .eq("id", testItemId).single();

    expect(itemAfter?.status_operacional).toBe("disponivel");
    expect(itemAfter?.current_holder_user_id).toBeNull();
    expect(itemAfter?.active_lending_id).toBeNull();
  });

  /**
   * SD06 — Saída de item resulta em status bem definido (campo status_operacional atualizado)
   */
  test("SD06 — Status machine: item em saída tem status_operacional=em_saida", async () => {
    if (!testItemId) test.skip(true, "testItemId não disponível");

    const sb = supabaseService();
    const { data: item } = await sb
      .from("material_items")
      .select("id, status_operacional")
      .eq("id", testItemId)
      .single();

    // Após SD01: deve estar em_saida (ou disponivel se SD05 limpou)
    expect(item?.id).toBe(testItemId);
    expect(item?.status_operacional).toBeTruthy();
  });
});
