/**
 * APMCB — Fase 5: Integridade de Posse (cross-fluxo)
 *
 * BLOQUEIO ABSOLUTO: estes testes validam o trigger trg_validate_item_transition
 * (fn_validate_item_transition, ver supabase/migrations/20260711000002_expand_
 * material_items_status_operacional.sql) — dispara em BEFORE UPDATE OF
 * status_operacional ON material_items. Se IT02/IT06/IT08 falharem → NUNCA deployar.
 *
 * IT01: Saída via /api/lendings/batch → 201; estoque agregado decrementado
 * IT02: Cautela de item disponivel → aceita → 201; status=cautelado ← BLOQUEIO
 * IT06: Segunda cautela do mesmo item cautelado → 409; trigger P0001 ← BLOQUEIO
 * IT07: Devolução de saída (bulk-return) → estoque agregado volta
 * IT08: Encerramento de cautela → item=disponivel + active_cautelamento=NULL ← BLOQUEIO
 * IT09: Operação com material/item de outro tenant → 404/400 (RLS isola)
 *
 * Reescrito em 2026-08-18 — achado real: os antigos IT01/IT03/IT04/IT05/IT07
 * usavam POST /api/saidas (item_id + reserve_id), que foi definitivamente
 * aposentado (LEGACY_CUSTODY_FLOW_RETIRED, ver saidas.spec.ts para o
 * contexto completo dessa aposentadoria).
 *
 * Mas a reescrita aqui não é só trocar a URL: o trigger que este arquivo
 * existe para proteger só dispara quando material_items.status_operacional
 * muda — e a rota nova (POST /api/lendings/batch, a RPC record_lending_batch
 * por trás dela) NUNCA toca material_items. Saída "diária" hoje é agregada
 * por quantidade (material_type_id), não amarrada a um item físico
 * específico — não existe mais "este item está em_saida". Por construção
 * (não mais por rejeição de trigger), a saída agregada é incapaz de
 * selecionar um item já cautelado, porque ela nunca seleciona item nenhum.
 *
 * Por isso os antigos IT03/IT04/IT05 (conflito saída↔saída e saída↔cautela
 * no nível de item) foram RETIRADOS, não adaptados — não há mais nenhum
 * caminho de código que exercite o trigger a partir do fluxo de saída.
 * IT02/IT06/IT08 (conflito cautela↔cautela, que ainda é item-based)
 * continuam validando o trigger de verdade, sem nenhuma mudança.
 */

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { BFF_URL, USERS } from "./harness";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function loginToken(email: string, password: string) {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed: ${error?.message}`);
  return data.session.access_token;
}

async function bff(method: string, path: string, token: string, body?: unknown, cookie?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(`${BFF_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  const setCookie = res.headers.getSetCookie().find((c) => c.startsWith("apmcb_session="));
  return { status: res.status, data, cookie: setCookie ? setCookie.split(";")[0] : cookie };
}

// Mesmo achado de saidas.spec.ts/cautelamentos.spec.ts: reserve_id
// determinístico via reserve_memberships do próprio fixture, não um
// `.limit(1)` sem filtro na tabela reserves inteira (poluída por sessões de
// pentest que criam reservas extras).
async function getOwnReserveId(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase.from("reserve_memberships").select("reserve_id").eq("user_id", userId).limit(1).single();
  return data?.reserve_id ?? "";
}

const lastConsumedTotp = new Map<string, string>();
const reconfiguredTotp = new Set<string>();
async function getFreshTotpCode(token: string): Promise<string> {
  for (;;) {
    const { status, data } = await bff("GET", "/api/totp/code", token);
    // Achado real (ambiente de dev/teste compartilhado): o secret TOTP de um
    // fixture pode ficar num estado "corrompido/chave de encriptação
    // divergente" (422 needs_reconfigure) sem relação com o que este teste
    // está exercitando — POST /api/totp/reconfigure é o caminho de
    // autorrecuperação oficial (ver apps/bff/src/routes/totp.ts linha ~199),
    // seguro de chamar aqui porque só regenera se o secret atual já está
    // comprovadamente quebrado (o endpoint recusa com 409 se não estiver).
    if (status === 422 && data?.needs_reconfigure && !reconfiguredTotp.has(token)) {
      reconfiguredTotp.add(token);
      const reconfig = await bff("POST", "/api/totp/reconfigure", token);
      if (reconfig.status !== 200 && reconfig.status !== 201) {
        throw new Error(`POST /api/totp/reconfigure falhou (${reconfig.status}): ${JSON.stringify(reconfig.data)}`);
      }
      continue;
    }
    if (status !== 200) throw new Error(`GET /api/totp/code falhou (${status}): ${JSON.stringify(data)}`);
    if (data.code !== lastConsumedTotp.get(token)) {
      lastConsumedTotp.set(token, data.code);
      return data.code;
    }
    await new Promise((r) => setTimeout(r, (data.seconds_remaining + 1) * 1000));
  }
}

async function identify(armeiroToken: string, cadeteToken: string, reserveId: string) {
  const code = await getFreshTotpCode(cadeteToken);
  const res = await bff("POST", "/api/lendings/identify", armeiroToken, {
    mode: "totp", matricula: USERS.efetivo.matricula, code, reserve_id: reserveId,
  });
  if (res.status !== 200) throw new Error(`identify falhou (${res.status}): ${JSON.stringify(res.data)}`);
  return res.cookie;
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let armeiroToken   = "";
let cadeteToken    = "";
let militarId      = "";
let reserveId      = "";
let materialTypeId = "";

// Items dedicados por cenário de cautela — evita contention entre testes
let itemForCautela  = "";  // IT02/IT06/IT08

let lendingId  = "";
let cautelaId2 = "";

test.beforeAll(async () => {
  const supabase = sb();
  armeiroToken = await loginToken(USERS.reserva.email, USERS.reserva.password);
  cadeteToken  = await loginToken(USERS.efetivo.email, USERS.efetivo.password);

  const { data: armP } = await supabase.from("profiles").select("id")
    .eq("matricula", USERS.reserva.matricula).single();
  const { data: milP } = await supabase.from("profiles").select("id")
    .eq("matricula", USERS.efetivo.matricula).single();
  militarId = milP?.id ?? "";
  reserveId = armP?.id ? await getOwnReserveId(supabase, armP.id) : "";

  const { status: activeStatus, data: activeData } = await bff("GET", "/api/shifts/active", armeiroToken);
  if (activeStatus === 200 && !activeData.shift) {
    const code = await getFreshTotpCode(armeiroToken);
    const { status, data } = await bff("POST", "/api/shifts/open", armeiroToken, {
      reserve_id: reserveId, auth_mode: "totp", totp_token: code,
    });
    if (status !== 201) throw new Error(`Setup: falha ao abrir turno do armeiro — ${status}: ${JSON.stringify(data)}`);
  }

  const { data: material } = await supabase
    .from("material_availability").select("id")
    .eq("reserve_id", reserveId)
    .gt("quantidade_disponivel", 0)
    .limit(1).single();
  materialTypeId = material?.id ?? "";

  // Reset total de todos os E2E items para estado limpo
  const { data: e2eItems } = await supabase
    .from("material_items").select("id")
    .like("numero_serie", "E2E-ITEM-%");

  if (e2eItems && e2eItems.length > 0) {
    const ids = e2eItems.map((i) => i.id);
    await supabase.from("cautelamentos").update({ status: "cancelada" })
      .in("item_id", ids).neq("status", "cancelada");
    await supabase.from("material_items").update({
      status_operacional:     "disponivel",
      current_holder_user_id: null,
      active_lending_id:      null,
      active_cautelamento_id: null,
    }).in("id", ids);
  }

  const { data: availItems } = await supabase
    .from("material_items").select("id")
    .like("numero_serie", "E2E-ITEM-%")
    .eq("status_operacional", "disponivel")
    .order("numero_serie")
    .limit(1);

  if (availItems && availItems.length >= 1) {
    itemForCautela = availItems[0].id;
  }
});

// ─── Testes ───────────────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });

test.describe("Fase 5 — Integridade de Posse (BLOQUEIO ABSOLUTO)", () => {

  /**
   * IT01 — Saída via /api/lendings/batch → 201; estoque agregado decrementa
   */
  test("IT01 — Saída de material disponível → aceita (201)", async () => {
    if (!materialTypeId || !reserveId || !militarId) {
      test.skip(true, "Setup incompleto");
      return;
    }

    const supabase = sb();
    const { data: before } = await supabase
      .from("material_availability").select("quantidade_disponivel").eq("id", materialTypeId).single();

    const cookie = await identify(armeiroToken, cadeteToken, reserveId);
    const { status, data } = await bff("POST", "/api/lendings/batch", armeiroToken, {
      military_id: militarId,
      reserve_id: reserveId,
      movement_id: randomUUID(),
      auth_mode: "totp",
      items: [{ material_type_id: materialTypeId, quantidade: 1 }],
    }, cookie);

    expect(status, `IT01 esperava 201, got ${status}: ${JSON.stringify(data)}`).toBe(201);
    lendingId = data.lendings?.[0]?.lending_id ?? "";
    expect(lendingId, "IT01: lending_id ausente na resposta").toBeTruthy();

    const { data: after } = await supabase
      .from("material_availability").select("quantidade_disponivel").eq("id", materialTypeId).single();
    expect(after?.quantidade_disponivel).toBe((before?.quantidade_disponivel ?? 0) - 1);
  });

  /**
   * IT02 — Cautela de item disponivel → 201; status=cautelado ← BLOQUEIO
   */
  test("IT02 — Cautela de item disponivel → aceita (201)", async () => {
    if (!itemForCautela || !reserveId || !militarId) {
      test.skip(true, "Setup incompleto");
      return;
    }

    const supabase = sb();
    await supabase.from("material_items").update({
      status_operacional: "disponivel",
      current_holder_user_id: null,
      active_lending_id: null,
      active_cautelamento_id: null,
    }).eq("id", itemForCautela);

    const { status, data } = await bff("POST", "/api/cautelamentos", armeiroToken, {
      item_id:        itemForCautela,
      militar_id:     militarId,
      reserve_id:     reserveId,
      motivo_emissao: "Cautela de teste IT02",
    });

    expect(status, `IT02 esperava 201, got ${status}: ${JSON.stringify(data)}`).toBe(201);
    cautelaId2 = data.cautelamento?.id ?? "";

    const { data: item } = await supabase
      .from("material_items").select("status_operacional")
      .eq("id", itemForCautela).single();
    expect(item?.status_operacional).toBe("cautelado");
  });

  /**
   * IT06 — Segunda cautela do MESMO item cautelado → 409 ← BLOQUEIO ABSOLUTO
   * (IT03/IT04/IT05 originais — conflito saída↔saída e saída↔cautela no
   * nível de item — foram retirados: ver comentário no topo do arquivo.)
   */
  test("IT06 [BLOQUEIO] — Segunda cautela de item cautelado → trigger P0001 → 409", async () => {
    if (!itemForCautela || !reserveId || !militarId) {
      test.skip(true, "Setup incompleto");
      return;
    }

    const { status } = await bff("POST", "/api/cautelamentos", armeiroToken, {
      item_id:        itemForCautela,
      militar_id:     militarId,
      reserve_id:     reserveId,
      motivo_emissao: "Tentativa inválida IT06",
    });

    expect(status, "IT06 BLOQUEIO: segunda cautela do mesmo item DEVE retornar 409").toBe(409);
  });

  /**
   * IT07 — Devolução via /api/lendings/bulk-return → estoque agregado volta
   */
  test("IT07 — Devolução de saída → estoque volta", async () => {
    if (!lendingId) { test.skip(true, "lendingId não disponível (IT01 falhou?)"); return; }

    const supabase = sb();
    const { data: before } = await supabase
      .from("material_availability").select("quantidade_disponivel").eq("id", materialTypeId).single();

    const cookie = await identify(armeiroToken, cadeteToken, reserveId);
    const { status, data } = await bff("POST", "/api/lendings/bulk-return", armeiroToken, {
      lending_ids: [lendingId],
    }, cookie);

    expect(status, `IT07 esperava 200, got ${status}: ${JSON.stringify(data)}`).toBe(200);
    expect(data.returned).toBe(1);

    const { data: after } = await supabase
      .from("material_availability").select("quantidade_disponivel").eq("id", materialTypeId).single();
    expect(after?.quantidade_disponivel).toBe((before?.quantidade_disponivel ?? 0) + 1);
  });

  /**
   * IT08 — Encerramento de cautela → item=disponivel; active_cautelamento=NULL ← BLOQUEIO
   */
  test("IT08 — Encerramento de cautela → item=disponivel; active_cautelamento=NULL", async () => {
    if (!cautelaId2 || !itemForCautela) { test.skip(true, "cautelaId2 não disponível"); return; }

    const supabase = sb();

    const { data: caut } = await supabase
      .from("cautelamentos").select("status").eq("id", cautelaId2).single();
    if (caut?.status !== "ativa") { test.skip(true, `Cautela já em status ${caut?.status}`); return; }

    const { status } = await bff("POST", `/api/cautelamentos/${cautelaId2}/return`, armeiroToken, {
      condicao_devolucao: "bom",
      motivo_devolucao: "Encerramento de teste IT08",
    });

    expect([200, 201]).toContain(status);

    const { data: item } = await supabase
      .from("material_items").select("status_operacional, current_holder_user_id, active_cautelamento_id")
      .eq("id", itemForCautela).single();

    expect(item?.status_operacional).toBe("disponivel");
    expect(item?.current_holder_user_id).toBeNull();
    expect(item?.active_cautelamento_id).toBeNull();
  });

  /**
   * IT09 — material/item de outro tenant → 404/400 (RLS/tenant isola)
   */
  test("IT09 [BLOQUEIO] — material/item de tenant diferente → 404/400", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000099";

    const cookie = await identify(armeiroToken, cadeteToken, reserveId);
    const { status: statusSaida } = await bff("POST", "/api/lendings/batch", armeiroToken, {
      military_id: militarId,
      reserve_id: reserveId,
      movement_id: randomUUID(),
      auth_mode: "totp",
      items: [{ material_type_id: fakeId, quantidade: 1 }],
    }, cookie);
    expect([404, 400, 409], "IT09: material de outro tenant deve ser rejeitado").toContain(statusSaida);

    const { status: statusCautela } = await bff("POST", "/api/cautelamentos", armeiroToken, {
      item_id:        fakeId,
      militar_id:     militarId,
      reserve_id:     reserveId,
      motivo_emissao: "Tentativa IT09",
    });
    expect([404, 400], "IT09: cautela de outro tenant deve retornar 404").toContain(statusCautela);
  });
});
