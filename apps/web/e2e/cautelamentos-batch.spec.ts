/**
 * Cautela com múltiplos materiais — POST /api/cautelamentos/batch +
 * assinatura em lote. Ver docs/enterprise/specs/cautela-multi-item-batch-
 * enterprise.md e o plano aprovado desta feature.
 *
 * CMB01: lote de 2 itens → mesmo movement_id, 2 linhas independentes em cautelamentos
 * CMB02: item duplicado no mesmo lote → rejeitado, nada persistido
 * CMB03: item não elegível (cautela_habilitada=false) dentro do lote → falha atômica
 * CMB04: lote de 1 item continua funcionando (regressão de granularidade)
 * CMB05: devolver 1 cautela do lote não afeta as outras
 * CMB06: assinar em lote como armeiro cria N document_signatures independentes
 * CMB07: assinar em lote facilitado (armeiro usa o TOTP do militar)
 * CMB07b: o próprio militar assina o lote (self-sign, não facilitado)
 * CMB08: replay do mesmo movement_id com os mesmos itens é idempotente
 * CMB09: replay do mesmo movement_id com itens divergentes é rejeitado
 * CMB10: duas assinaturas concorrentes com o mesmo TOTP — só uma vence
 * CMB11: POST /batch sem turno ativo do armeiro → SHIFT_REQUIRED
 *
 * Achado de code review (corrigido nesta versão): a versão anterior deste
 * arquivo mutava `material_types.cautela_habilitada` de tipos REAIS e
 * pré-existentes (não criados pelo teste) — inclusive desligando a flag de
 * um tipo real em CMB03, sem nenhum revert. Como este projeto roda os
 * testes contra a MESMA instância Supabase de produção (local só significa
 * app rodando em localhost, banco é o real), isso alterou permanentemente
 * configuração de negócio real. Corrigido: todo material usado aqui agora é
 * sintético, criado via o mesmo fluxo real de aprovação que
 * cautela-eligibility.spec.ts já usa com segurança (POST /api/arsenal/
 * requests + approve) — nunca mais um UPDATE direto em linhas
 * pré-existentes de material_types/material_items.
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BFF_URL, USERS } from "./harness";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function sb() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function loginToken(email: string, password: string) {
  const { data, error } = await sb().auth.signInWithPassword({ email, password });
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

const lastConsumedTotp = new Map<string, string>();
async function getFreshTotpCode(token: string): Promise<string> {
  for (;;) {
    const { status, data } = await bff("GET", "/api/totp/code", token);
    if (status !== 200) throw new Error(`GET /api/totp/code falhou (${status}): ${JSON.stringify(data)}`);
    if (data.code !== lastConsumedTotp.get(token)) {
      lastConsumedTotp.set(token, data.code);
      return data.code;
    }
    await new Promise((r) => setTimeout(r, (data.seconds_remaining + 1) * 1000));
  }
}

function uniqueMaterialName(prefix: string) {
  return `E2E CautelaBatch ${prefix} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

let armeiroToken      = "";
let adminReservaToken = "";
let cadeteToken       = "";
let reserveId         = "";
let militarId         = "";

/**
 * Cria um material_type SINTÉTICO novo (nunca reaproveita um pré-existente)
 * com N material_items sintéticos, já elegíveis para cautela — via o mesmo
 * fluxo real de aprovação (Cenário B: cautela_habilitada=true gera N itens
 * individuais automaticamente na aprovação) que cautela-eligibility.spec.ts
 * já usa com segurança. Nunca faz UPDATE em linhas pré-existentes.
 */
async function createEligibleItems(count: number): Promise<{ id: string; material_type_id: string }[]> {
  const supabase = sb();
  const nome = uniqueMaterialName("Eligible");
  const createRes = await bff("POST", "/api/arsenal/requests", adminReservaToken, {
    type: "material_addition",
    nome,
    categoria: "acessorio",
    quantidade_total: count,
    cautela_habilitada: true,
    quantidade_cautela: count,
  });
  if (createRes.status !== 201) {
    throw new Error(`createEligibleItems: falha ao criar solicitação (${createRes.status}): ${JSON.stringify(createRes.data)}`);
  }
  const approveRes = await bff("PATCH", `/api/arsenal/requests/${createRes.data.request_id}/approve`, adminReservaToken, {});
  if (approveRes.status !== 200) {
    throw new Error(`createEligibleItems: falha ao aprovar (${approveRes.status}): ${JSON.stringify(approveRes.data)}`);
  }
  const { data: material } = await supabase.from("material_types").select("id").eq("nome", nome).single();
  const { data: items } = await supabase.from("material_items").select("id, material_type_id")
    .eq("material_type_id", material!.id).eq("status_operacional", "disponivel");
  return (items ?? []).map((i) => ({ id: i.id, material_type_id: i.material_type_id }));
}

/**
 * Busca um item físico EXISTENTE cujo material_type já não é elegível pra
 * cautela — estado natural, sem mutar nada. Usado só pra provar que a RPC
 * rejeita item não elegível dentro de um lote (CMB03).
 */
async function findExistingNonEligibleItem(): Promise<string | null> {
  const supabase = sb();
  const { data } = await supabase
    .from("material_items")
    .select("id, material_types!inner(cautela_habilitada)")
    .eq("status_operacional", "disponivel")
    .eq("material_types.cautela_habilitada", false)
    .limit(1);
  return data && data.length > 0 ? data[0].id : null;
}

test.beforeAll(async () => {
  const supabase = sb();
  armeiroToken      = await loginToken(USERS.reserva.email, USERS.reserva.password);
  adminReservaToken = await loginToken(USERS.adminReserva.email, USERS.adminReserva.password);
  cadeteToken       = await loginToken(USERS.efetivo.email, USERS.efetivo.password);

  const { data: armProfile } = await supabase.from("profiles").select("id")
    .eq("matricula", USERS.reserva.matricula).single();
  const { data: milProfile } = await supabase.from("profiles").select("id")
    .eq("matricula", USERS.efetivo.matricula).single();
  militarId = milProfile?.id ?? "";

  const { data: membership } = armProfile?.id
    ? await supabase.from("reserve_memberships").select("reserve_id").eq("user_id", armProfile.id).limit(1).single()
    : { data: null };
  reserveId = membership?.reserve_id ?? "";

  const { status: activeStatus, data: activeData } = await bff("GET", "/api/shifts/active", armeiroToken);
  if (activeStatus === 200 && !activeData.shift) {
    const code = await getFreshTotpCode(armeiroToken);
    await bff("POST", "/api/shifts/open", armeiroToken, { reserve_id: reserveId, auth_mode: "totp", totp_token: code });
  }
});

test.describe.configure({ mode: "serial" });

test.describe("Cautela em lote — múltiplos materiais", () => {

  test("CMB01 — lote de 2 itens cria 2 cautelas com o mesmo movement_id", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const items = await createEligibleItems(2);
    if (items.length < 2) { test.skip(true, "Falha ao criar itens sintéticos"); return; }

    const movementId = crypto.randomUUID();
    const { status, data } = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB01 — lote de 2 itens",
      movement_id: movementId,
      items: items.map((i) => ({ item_id: i.id })),
    });

    expect(status, `CMB01 esperava 201, got ${status}: ${JSON.stringify(data)}`).toBe(201);
    expect(data.cautelamentos).toHaveLength(2);

    const supabase = sb();
    const { data: rows } = await supabase.from("cautelamentos").select("id, movement_id, item_id").eq("movement_id", movementId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows!.map((r) => r.movement_id)).size).toBe(1);

    const { data: itemRows } = await supabase.from("material_items").select("id, status_operacional").in("id", items.map((i) => i.id));
    for (const row of itemRows ?? []) expect(row.status_operacional).toBe("cautelado");
  });

  test("CMB02 — item duplicado no mesmo lote é rejeitado", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const items = await createEligibleItems(1);
    if (items.length < 1) { test.skip(true, "Falha ao criar item sintético"); return; }

    const movementId = crypto.randomUUID();
    const { status, data } = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB02 — item duplicado",
      movement_id: movementId,
      items: [{ item_id: items[0].id }, { item_id: items[0].id }],
    });

    expect(status, `CMB02 esperava 409, got ${status}: ${JSON.stringify(data)}`).toBe(409);
    expect(data.error).toMatch(/DUPLICATE/i);

    const supabase = sb();
    const { count } = await supabase.from("cautelamentos").select("id", { count: "exact", head: true }).eq("movement_id", movementId);
    expect(count ?? 0).toBe(0);
  });

  test("CMB03 — item não elegível dentro do lote derruba o lote inteiro (atomicidade)", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const eligible = await createEligibleItems(1);
    const notEligibleId = await findExistingNonEligibleItem();
    if (eligible.length < 1 || !notEligibleId) { test.skip(true, "Setup incompleto (item elegível ou não-elegível ausente)"); return; }

    const movementId = crypto.randomUUID();
    const { status, data } = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB03 — item não elegível no lote",
      movement_id: movementId,
      items: [{ item_id: eligible[0].id }, { item_id: notEligibleId }],
    });

    expect(status, `CMB03 esperava 409, got ${status}: ${JSON.stringify(data)}`).toBe(409);
    expect(data.error).toMatch(/NOT_ELIGIBLE/i);

    // Atomicidade: NENHUMA linha foi criada, nem a do item elegível.
    const supabase = sb();
    const { count } = await supabase.from("cautelamentos").select("id", { count: "exact", head: true }).eq("movement_id", movementId);
    expect(count ?? 0).toBe(0);
    const { data: eligibleItem } = await supabase.from("material_items").select("status_operacional").eq("id", eligible[0].id).single();
    expect(eligibleItem?.status_operacional).toBe("disponivel");
  });

  test("CMB04 — lote de 1 item continua funcionando via /batch", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const items = await createEligibleItems(1);
    if (items.length < 1) { test.skip(true, "Falha ao criar item sintético"); return; }

    const movementId = crypto.randomUUID();
    const { status, data } = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB04 — lote de 1 item",
      movement_id: movementId,
      items: [{ item_id: items[0].id }],
    });

    expect(status, `CMB04 esperava 201, got ${status}: ${JSON.stringify(data)}`).toBe(201);
    expect(data.cautelamentos).toHaveLength(1);
  });

  test("CMB06 — assinatura em lote pelo armeiro cria N document_signatures", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const items = await createEligibleItems(2);
    if (items.length < 2) { test.skip(true, "Falha ao criar itens sintéticos"); return; }

    const movementId = crypto.randomUUID();
    const { status: createStatus, data: createData } = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB06 — assinatura em lote (armeiro)",
      movement_id: movementId,
      items: items.map((i) => ({ item_id: i.id })),
    });
    expect(createStatus, "CMB06 setup: criação").toBe(201);

    const armCode = await getFreshTotpCode(armeiroToken);
    const { status: armStatus, data: armData } = await bff("POST", `/api/cautelamentos/batch/${movementId}/sign-armeiro`, armeiroToken, {
      totp_token: armCode,
    });
    expect(armStatus, `assinatura armeiro em lote esperava 200, got ${armStatus}: ${JSON.stringify(armData)}`).toBe(200);
    expect(armData.results).toHaveLength(2);
    expect(armData.results.every((r: { skipped: boolean }) => r.skipped === false)).toBe(true);

    const supabase = sb();
    const { count } = await supabase.from("document_signatures").select("id", { count: "exact", head: true })
      .in("document_id", createData.cautelamentos.map((c: { cautelamento_id: string }) => c.cautelamento_id))
      .eq("signer_role", "armeiro");
    expect(count).toBe(2);
  });

  test("CMB07 — assinatura em lote facilitada: armeiro usa o TOTP do militar", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const items = await createEligibleItems(2);
    if (items.length < 2) { test.skip(true, "Falha ao criar itens sintéticos"); return; }

    const movementId = crypto.randomUUID();
    const { status: createStatus, data: createData } = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB07 — facilitação de assinatura em lote",
      movement_id: movementId,
      items: items.map((i) => ({ item_id: i.id })),
    });
    expect(createStatus, "CMB07 setup: criação").toBe(201);

    const armCode = await getFreshTotpCode(armeiroToken);
    const armSign = await bff("POST", `/api/cautelamentos/batch/${movementId}/sign-armeiro`, armeiroToken, { totp_token: armCode });
    expect(armSign.status, "CMB07 setup: assinatura do armeiro").toBe(200);

    // O ARMEIRO chama o endpoint, mas usa o TOTP DO MILITAR — facilitação.
    const milCode = await getFreshTotpCode(cadeteToken);
    const { status, data } = await bff("POST", `/api/cautelamentos/batch/${movementId}/sign-militar`, armeiroToken, {
      totp_token: milCode,
    });
    expect(status, `CMB07 esperava 200, got ${status}: ${JSON.stringify(data)}`).toBe(200);
    expect(data.results).toHaveLength(2);

    const supabase = sb();
    const { count } = await supabase.from("document_signatures").select("id", { count: "exact", head: true })
      .in("document_id", createData.cautelamentos.map((c: { cautelamento_id: string }) => c.cautelamento_id))
      .eq("signer_role", "militar");
    expect(count).toBe(2);
  });

  test("CMB07b — o próprio militar assina o lote (self-sign, sem facilitação)", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const items = await createEligibleItems(2);
    if (items.length < 2) { test.skip(true, "Falha ao criar itens sintéticos"); return; }

    const movementId = crypto.randomUUID();
    const { status: createStatus, data: createData } = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB07b — self-sign do militar em lote",
      movement_id: movementId,
      items: items.map((i) => ({ item_id: i.id })),
    });
    expect(createStatus, "CMB07b setup: criação").toBe(201);

    const armCode = await getFreshTotpCode(armeiroToken);
    const armSign = await bff("POST", `/api/cautelamentos/batch/${movementId}/sign-armeiro`, armeiroToken, { totp_token: armCode });
    expect(armSign.status, "CMB07b setup: assinatura do armeiro").toBe(200);

    // O próprio MILITAR (cadeteToken) chama o endpoint pra assinar o lote dele mesmo.
    const milCode = await getFreshTotpCode(cadeteToken);
    const { status, data } = await bff("POST", `/api/cautelamentos/batch/${movementId}/sign-militar`, cadeteToken, {
      totp_token: milCode,
    });
    expect(status, `CMB07b esperava 200, got ${status}: ${JSON.stringify(data)}`).toBe(200);
    expect(data.results).toHaveLength(2);

    const supabase = sb();
    const { data: sigs } = await supabase.from("document_signatures").select("signer_id")
      .in("document_id", createData.cautelamentos.map((c: { cautelamento_id: string }) => c.cautelamento_id))
      .eq("signer_role", "militar");
    expect(sigs).toHaveLength(2);
    for (const sig of sigs ?? []) expect(sig.signer_id).toBe(militarId);
  });

  test("CMB08 — replay do mesmo movement_id com os mesmos itens é idempotente", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const items = await createEligibleItems(1);
    if (items.length < 1) { test.skip(true, "Falha ao criar item sintético"); return; }

    const movementId = crypto.randomUUID();
    const payload = {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB08 — replay idempotente",
      movement_id: movementId,
      items: [{ item_id: items[0].id }],
    };

    const first = await bff("POST", "/api/cautelamentos/batch", armeiroToken, payload);
    expect(first.status, "CMB08 primeira chamada").toBe(201);

    const second = await bff("POST", "/api/cautelamentos/batch", armeiroToken, payload);
    expect(second.status, `CMB08 replay esperava 201 (idempotente), got ${second.status}: ${JSON.stringify(second.data)}`).toBe(201);
    expect(second.data.cautelamentos[0].cautelamento_id).toBe(first.data.cautelamentos[0].cautelamento_id);

    const supabase = sb();
    const { count } = await supabase.from("cautelamentos").select("id", { count: "exact", head: true }).eq("movement_id", movementId);
    expect(count).toBe(1);
  });

  test("CMB09 — replay do mesmo movement_id com itens divergentes é rejeitado", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const item1 = await createEligibleItems(1);
    const item2 = await createEligibleItems(1);
    if (item1.length < 1 || item2.length < 1) { test.skip(true, "Falha ao criar itens sintéticos"); return; }

    const movementId = crypto.randomUUID();
    const first = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB09 — primeira chamada",
      movement_id: movementId,
      items: [{ item_id: item1[0].id }],
    });
    expect(first.status, "CMB09 primeira chamada").toBe(201);

    const second = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB09 — replay com item diferente",
      movement_id: movementId,
      items: [{ item_id: item2[0].id }],
    });
    expect(second.status, `CMB09 esperava 409, got ${second.status}: ${JSON.stringify(second.data)}`).toBe(409);
    expect(second.data.error).toMatch(/ITEMS_MISMATCH/i);
  });

  test("CMB05 — devolver 1 cautela do lote não afeta as outras", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const items = await createEligibleItems(2);
    if (items.length < 2) { test.skip(true, "Falha ao criar itens sintéticos"); return; }

    const movementId = crypto.randomUUID();
    const { status, data } = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
      militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB05 — devolução parcial do lote",
      movement_id: movementId,
      items: items.map((i) => ({ item_id: i.id })),
    });
    expect(status, "CMB05 setup: criação").toBe(201);
    const [first, second] = data.cautelamentos as { cautelamento_id: string; item_id: string }[];

    const { status: returnStatus } = await bff("POST", `/api/cautelamentos/${first.cautelamento_id}/return`, armeiroToken, {
      condicao_devolucao: "bom", motivo_devolucao: "Teste CMB05",
    });
    expect(returnStatus, "CMB05: devolução da primeira cautela do lote").toBe(200);

    const supabase = sb();
    const { data: firstRow } = await supabase.from("cautelamentos").select("status").eq("id", first.cautelamento_id).single();
    const { data: secondRow } = await supabase.from("cautelamentos").select("status").eq("id", second.cautelamento_id).single();
    expect(firstRow?.status).toBe("devolvida");
    expect(secondRow?.status).toBe("ativa");

    const { data: secondItem } = await supabase.from("material_items").select("status_operacional").eq("id", second.item_id).single();
    expect(secondItem?.status_operacional).toBe("cautelado");
  });

  /**
   * CMB10 — Duas requisições simultâneas com o MESMO código TOTP: só uma
   * pode vencer. Prova sob concorrência real (não sequencial) o fix de
   * atomicidade em validateTotp (achado de code review desta feature —
   * SELECT+UPDATE separados permitiam duplo consumo do mesmo código).
   */
  test("CMB10 — duas assinaturas concorrentes com o mesmo TOTP: só uma vence", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    const items = await createEligibleItems(1);
    if (items.length < 1) { test.skip(true, "Falha ao criar item sintético"); return; }

    const { status: createStatus, data: createData } = await bff("POST", "/api/cautelamentos", armeiroToken, {
      item_id: items[0].id, militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CMB10 — concorrência de TOTP",
    });
    expect(createStatus, "CMB10 setup: criação").toBe(201);
    const cautelaId: string = createData.cautelamento.id;

    const code = await getFreshTotpCode(armeiroToken);
    const [r1, r2] = await Promise.all([
      bff("POST", `/api/cautelamentos/${cautelaId}/sign-armeiro`, armeiroToken, { totp_token: code }),
      bff("POST", `/api/cautelamentos/${cautelaId}/sign-armeiro`, armeiroToken, { totp_token: code }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses, `CMB10 esperava [200,400], got ${JSON.stringify(statuses)} — ${JSON.stringify([r1.data, r2.data])}`).toEqual([200, 400]);

    const supabase = sb();
    const { count } = await supabase.from("document_signatures").select("id", { count: "exact", head: true }).eq("document_id", cautelaId);
    expect(count, "CMB10: exatamente 1 assinatura persistida, não 2").toBe(1);
  });

  /**
   * CMB11 — POST /batch sem turno ativo do armeiro → SHIFT_REQUIRED.
   * Mesmo gate já testado pro fluxo singular (cautelamentos.spec.ts) —
   * precisa valer também pros 3 endpoints novos de lote.
   */
  test("CMB11 — POST /batch sem turno ativo do armeiro retorna SHIFT_REQUIRED", async () => {
    if (!reserveId) { test.skip(true, "Setup incompleto"); return; }
    const { status: activeStatus, data: activeData } = await bff("GET", "/api/shifts/active", armeiroToken);
    if (activeStatus !== 200 || !activeData.shift) { test.skip(true, "Sem turno ativo pra fechar"); return; }
    const shiftId = activeData.shift.id;

    const closeCode = await getFreshTotpCode(armeiroToken);
    const closeRes = await bff("POST", `/api/shifts/${shiftId}/close`, armeiroToken, { auth_mode: "totp", totp_token: closeCode });
    if (closeRes.status !== 200) { test.skip(true, `Não foi possível fechar o turno pro teste (${closeRes.status}): ${JSON.stringify(closeRes.data)}`); return; }

    try {
      const { status, data } = await bff("POST", "/api/cautelamentos/batch", armeiroToken, {
        militar_id: militarId, reserve_id: reserveId,
        motivo_emissao: "Teste CMB11 — sem turno",
        movement_id: crypto.randomUUID(),
        items: [{ item_id: crypto.randomUUID() }],
      });
      expect(status, `CMB11 esperava 403, got ${status}: ${JSON.stringify(data)}`).toBe(403);
      expect(data.error).toBe("SHIFT_REQUIRED");
    } finally {
      // Reabre o turno pra não deixar os testes seguintes (que rodam depois
      // deste, mode:"serial") sem turno ativo.
      const reopenCode = await getFreshTotpCode(armeiroToken);
      await bff("POST", "/api/shifts/open", armeiroToken, { reserve_id: reserveId, auth_mode: "totp", totp_token: reopenCode });
    }
  });

});
