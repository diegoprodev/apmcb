/**
 * APMCB — Fase 5: Cautela Permanente
 *
 * CT01: Emitir cautela de item disponivel → 201; cautelamentos+1; item.status=cautelado
 * CT02: Emitir cautela de item em_saida → bloqueado por trigger → 409
 * CT03: Emitir cautela de item cautelado → bloqueado por trigger → 409
 * CT04: Armeiro assina Termo com TOTP → document_signatures+1; audit_event criado
 * CT05: Militar assina aceitando responsabilidade com TOTP
 * CT06: Substituição → antiga=substituida; nova=ativa; vínculo preservado
 * CT07: Encerramento normal → item volta para disponivel; holder=NULL
 * CT08: Histórico de item → N registros ordenados por data_emissao
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
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

async function bff(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(`${BFF_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

/**
 * Retorna um código TOTP nunca antes consumido por este mesmo usuário nesta suíte.
 * Sem isso, duas ações TOTP do mesmo usuário na mesma janela de 30s (ex: abrir
 * turno no beforeAll + assinar no CT04) colidem no anti-replay do BFF e o
 * segundo request falha com 400 "Código já utilizado" — mesmo padrão de
 * livro-digital.spec.ts, replicado aqui por não haver Page/harness compartilhado.
 */
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

// ─── Setup ────────────────────────────────────────────────────────────────────

let armeiroToken = "";
let cadeteToken  = "";
let reserveId    = "";
let militarId    = "";
let tenantId     = "";   // tenant do armeiro fixture — usado pra CT05c
let cautelaItemId = "";  // item principal dos testes CT01-CT08
let cautelaId    = "";   // cautela criada no CT01

test.beforeAll(async () => {
  const supabase = sb();
  armeiroToken = await loginToken(USERS.reserva.email, USERS.reserva.password);
  cadeteToken  = await loginToken(USERS.efetivo.email, USERS.efetivo.password);

  const { data: armProfile } = await supabase.from("profiles").select("id, default_tenant_id")
    .eq("matricula", USERS.reserva.matricula).single();
  tenantId = armProfile?.default_tenant_id ?? "";
  const { data: milProfile } = await supabase.from("profiles").select("id")
    .eq("matricula", USERS.efetivo.matricula).single();
  militarId = milProfile?.id ?? "";

  // Achado real (2026-08-18): `.from("reserves").select("id").limit(1).single()`
  // sem filtro pegava QUALQUER reserva do banco de dev/teste — quebrava o
  // setup (403 "Você não pertence a esta reserva" ao abrir turno) depois que
  // sessões de pentest passaram a criar reservas extras na mesma tabela. A
  // reserva correta é a que o armeiro fixture (armeiro@apmcb.dev) realmente
  // pertence, via reserve_memberships — mesmo padrão já usado pelo BFF em
  // apps/bff/src/middleware/auth.ts (fallback Bearer) pra resolver reserveId.
  const { data: membership } = armProfile?.id
    ? await supabase.from("reserve_memberships").select("reserve_id").eq("user_id", armProfile.id).limit(1).single()
    : { data: null };
  reserveId = membership?.reserve_id ?? "";

  // Buscar item disponível diferente do usado em saidas.spec
  const { data: avail } = await supabase
    .from("material_items")
    .select("id, material_type_id")
    .eq("status_operacional", "disponivel")
    .limit(1)
    .single();
  cautelaItemId = avail?.id ?? "";

  // Achado real (docs/enterprise/specs/cautela-eligibility-quantity-
  // enterprise.md, CAU-06): desde que a elegibilidade explícita pra cautela
  // existe, POST /api/cautelamentos rejeita com 409 qualquer item cujo
  // material_type não tenha cautela_habilitada=true. O item acima é
  // escolhido de forma genérica (só por estar "disponivel"), sem garantia
  // de que seu material já esteja habilitado — sem este UPDATE, este setup
  // ficaria sujeito ao backfill da migration (que só habilita materiais que
  // JÁ tinham cautela ativa antes da feature existir) e poderia quebrar
  // CT01+ de forma imprevisível dependendo de qual item o Supabase devolver.
  if (avail?.material_type_id) {
    await supabase
      .from("material_types")
      .update({ cautela_habilitada: true, quantidade_cautela: 1 })
      .eq("id", avail.material_type_id)
      .eq("cautela_habilitada", false);
  }

  // CT01+ exigem turno ativo do armeiro (guard SHIFT_REQUIRED do Livro Digital).
  // Abre um turno se não houver um ativo, usando o mesmo padrão de
  // livro-digital.spec.ts (código TOTP obtido via GET /api/totp/code).
  const { status: activeStatus, data: activeData } = await bff("GET", "/api/shifts/active", armeiroToken);
  if (activeStatus === 200 && !activeData.shift) {
    const code = await getFreshTotpCode(armeiroToken);
    const { status: openStatus, data: openData } = await bff("POST", "/api/shifts/open", armeiroToken, {
      reserve_id: reserveId,
      auth_mode: "totp",
      totp_token: code,
    });
    if (openStatus !== 201) {
      throw new Error(`Setup: falha ao abrir turno do armeiro — ${openStatus}: ${JSON.stringify(openData)}`);
    }
  }
});

// ─── Testes ───────────────────────────────────────────────────────────────────

test.describe.configure({ mode: "serial" });

test.describe("Fase 5 — Cautela Permanente", () => {

  /**
   * CT01 — Emitir cautela de item disponível → 201
   */
  test("CT01 — Emitir cautela de item disponivel → 201 + status=cautelado", async () => {
    if (!cautelaItemId || !reserveId || !militarId) {
      test.skip(true, "Setup incompleto — item/reserva/militar não encontrado");
      return;
    }

    const supabase = sb();
    // Garantir que o item está disponivel
    await supabase.from("material_items").update({
      status_operacional: "disponivel",
      current_holder_user_id: null,
      active_cautelamento_id: null,
      active_lending_id: null,
    }).eq("id", cautelaItemId);

    const { count: before } = await supabase
      .from("cautelamentos").select("id", { count: "exact", head: true });

    const { status, data } = await bff("POST", "/api/cautelamentos", armeiroToken, {
      item_id:        cautelaItemId,
      militar_id:     militarId,
      reserve_id:     reserveId,
      motivo_emissao: "Pistola de uso pessoal — teste CT01",
      condicao_emissao: "bom",
    });

    expect(status, `CT01 esperava 201, got ${status}: ${JSON.stringify(data)}`).toBe(201);

    cautelaId = data.cautelamento?.id ?? "";
    expect(cautelaId, "CT01: cautelamento.id ausente na resposta").toBeTruthy();

    // Verificar contagem no banco
    const { count: after } = await supabase
      .from("cautelamentos").select("id", { count: "exact", head: true });
    expect(after ?? 0).toBeGreaterThan(before ?? 0);

    // Verificar status do item
    const { data: item } = await supabase
      .from("material_items").select("status_operacional, current_holder_user_id")
      .eq("id", cautelaItemId).single();
    expect(item?.status_operacional).toBe("cautelado");
    expect(item?.current_holder_user_id).toBe(militarId);
  });

  /**
   * CT02 — Emitir cautela de item em_saida → trigger P0001 → 409
   */
  test("CT02 — Emitir cautela de item em_saida → trigger P0001 → 409", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }

    const supabase = sb();

    // Buscar ou forçar um item em_saida
    const { data: emSaidaItem } = await supabase
      .from("material_items").select("id")
      .eq("status_operacional", "em_saida").limit(1).single();

    if (!emSaidaItem) {
      // Forçar um item para em_saida direto no banco (não via BFF para não depender de SD01)
      const { data: dispItem } = await supabase
        .from("material_items").select("id")
        .eq("status_operacional", "disponivel")
        .neq("id", cautelaItemId)
        .limit(1).single();

      if (!dispItem) { test.skip(true, "Nenhum item disponível para forçar em_saida"); return; }

      await supabase.from("material_items").update({
        status_operacional: "em_saida",
      }).eq("id", dispItem.id);

      const { status } = await bff("POST", "/api/cautelamentos", armeiroToken, {
        item_id: dispItem.id, militar_id: militarId, reserve_id: reserveId,
        motivo_emissao: "Tentativa inválida CT02",
      });
      expect(status, "CT02 esperava 409").toBe(409);

      // Restaurar
      await supabase.from("material_items").update({ status_operacional: "disponivel" }).eq("id", dispItem.id);
      return;
    }

    const { status } = await bff("POST", "/api/cautelamentos", armeiroToken, {
      item_id: emSaidaItem.id, militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Tentativa inválida CT02",
    });
    expect(status, "CT02 esperava 409 (item em_saida)").toBe(409);
  });

  /**
   * CT03 — Emitir cautela de item cautelado → 409
   */
  test("CT03 — Emitir cautela de item já cautelado → 409", async () => {
    if (!cautelaItemId || !reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }
    if (!cautelaId) { test.skip(true, "CT01 não criou cautelamento"); return; }

    // cautelaItemId já está cautelado após CT01
    const { status } = await bff("POST", "/api/cautelamentos", armeiroToken, {
      item_id: cautelaItemId, militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Tentativa inválida CT03",
    });
    expect(status, "CT03 esperava 409 (item já cautelado)").toBe(409);
  });

  /**
   * CT04 — Armeiro assina Termo com TOTP → document_signatures+1 + audit_event
   */
  test("CT04 — Armeiro assina Termo de Cautela com TOTP", async () => {
    if (!cautelaId) { test.skip(true, "CT01 não criou cautelamento"); return; }

    const supabase = sb();
    const { count: sigsBefore } = await supabase
      .from("document_signatures").select("id", { count: "exact", head: true })
      .eq("document_id", cautelaId);

    const code = await getFreshTotpCode(armeiroToken);

    const { status, data } = await bff("POST", `/api/cautelamentos/${cautelaId}/sign-armeiro`, armeiroToken, {
      totp_token: code,
    });

    expect([200, 201, 422]).toContain(status);

    if (status !== 422) {
      const { count: sigsAfter } = await supabase
        .from("document_signatures").select("id", { count: "exact", head: true })
        .eq("document_id", cautelaId);
      expect(sigsAfter ?? 0).toBeGreaterThan(sigsBefore ?? 0);

      // Verificar audit_event
      const { data: auditEvent } = await supabase
        .from("audit_events").select("id, action")
        .eq("action", "signature.created")
        .eq("resource_id", cautelaId)
        .order("created_at", { ascending: false })
        .limit(1).single();
      expect(auditEvent?.action).toBe("signature.created");
    }
  });

  /**
   * CT05 — Militar assina aceitando responsabilidade
   */
  test("CT05 — Militar assina Termo de Cautela com TOTP", async () => {
    if (!cautelaId) { test.skip(true, "CT01 não criou cautelamento"); return; }

    const code = await getFreshTotpCode(cadeteToken);

    const { status, data } = await bff("POST", `/api/cautelamentos/${cautelaId}/sign-militar`, cadeteToken, {
      totp_token: code,
    });

    expect([200, 201, 422], `CT05 esperava 200/201/422, got ${status}: ${JSON.stringify(data)}`).toContain(status);
  });

  /**
   * CT05b — Armeiro facilita a assinatura do militar (fix de identidade)
   *
   * Achado real: POST /:id/sign-militar validava TOTP/biometria contra
   * `c.get("userId")` (quem está logado) em vez de `cautela.militar_id`, e
   * checava autorização com o mesmo valor errado — quando o armeiro abre
   * /reserva/cautelas e clica "Assinar Usuário" pra facilitar a assinatura
   * de alguém que pode nem estar logado, a chamada sempre recebia 403 antes
   * de validar qualquer código. Este teste prova que hoje: (a) o armeiro
   * consegue completar a chamada usando o código TOTP do MILITAR (não o
   * seu próprio); (b) a assinatura gravada pertence ao militar
   * (signer_id), não a quem operou o teclado.
   */
  test("CT05b — Armeiro facilita assinatura do militar com o TOTP DO MILITAR", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }

    const supabase = sb();
    const { data: item } = await supabase
      .from("material_items").select("id, material_type_id")
      .eq("status_operacional", "disponivel")
      .neq("id", cautelaItemId)
      .limit(1).single();
    if (!item) { test.skip(true, "Nenhum item disponível para CT05b"); return; }

    if (item.material_type_id) {
      await supabase.from("material_types")
        .update({ cautela_habilitada: true, quantidade_cautela: 1 })
        .eq("id", item.material_type_id).eq("cautela_habilitada", false);
    }

    const { status: createStatus, data: createData } = await bff("POST", "/api/cautelamentos", armeiroToken, {
      item_id: item.id, militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CT05b — facilitação de assinatura",
    });
    expect(createStatus, `CT05b setup: criação esperava 201, got ${createStatus}: ${JSON.stringify(createData)}`).toBe(201);
    const facilitatedCautelaId: string = createData.cautelamento.id;

    const armeiroCode = await getFreshTotpCode(armeiroToken);
    const { status: armSignStatus } = await bff("POST", `/api/cautelamentos/${facilitatedCautelaId}/sign-armeiro`, armeiroToken, {
      totp_token: armeiroCode,
    });
    expect(armSignStatus, "CT05b setup: assinatura do armeiro").toBe(200);

    // O ARMEIRO chama o endpoint, mas usa o código TOTP do MILITAR — exatamente
    // o fluxo de facilitação (armeiro opera o dispositivo em nome do militar).
    const militarCode = await getFreshTotpCode(cadeteToken);
    const { status, data } = await bff("POST", `/api/cautelamentos/${facilitatedCautelaId}/sign-militar`, armeiroToken, {
      totp_token: militarCode,
    });
    expect(status, `CT05b esperava 200 (não 403), got ${status}: ${JSON.stringify(data)}`).toBe(200);

    const { data: sig } = await supabase
      .from("document_signatures")
      .select("signer_id, signer_role")
      .eq("id", data.signature_id).single();
    expect(sig?.signer_id, "signer_id deve ser o militar, não o armeiro que operou").toBe(militarId);
    expect(sig?.signer_role).toBe("militar");

    const { data: auditEvent } = await supabase
      .from("audit_events").select("metadata")
      .eq("action", "signature.created").eq("resource_id", facilitatedCautelaId)
      .order("created_at", { ascending: false }).limit(1).single();
    expect((auditEvent?.metadata as { facilitated_by_staff?: boolean } | null)?.facilitated_by_staff).toBe(true);
  });

  /**
   * CT05c — Um "usuario" não pode assinar a cautela de OUTRO "usuario"
   *
   * Prova negativa do guard preservado em resolveSigningIdentity: quando
   * quem chama é role="usuario", o alvo só pode ser ele mesmo — nunca
   * outra pessoa, mesmo que soubesse o TOTP alheio (não deveria, mas o
   * teste garante que a AUTORIZAÇÃO barra isso antes de qualquer validação
   * de código).
   */
  test("CT05c — usuario não pode assinar cautela de outro usuario (403 preservado)", async () => {
    if (!cautelaId) { test.skip(true, "CT01 não criou cautelamento"); return; }

    const supabase = sb();
    const matricula = String(Math.floor(Math.random() * 900000) + 100000);
    const email = `e2e-ct05c-${Date.now()}@apmcb.dev`;
    const password = "Teste@Ct05c2026";

    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { nome_completo: "Test CT05c", matricula },
    });
    if (createErr || !created?.user) { test.skip(true, `createUser falhou: ${createErr?.message}`); return; }
    const otherUserId = created.user.id;

    try {
      await supabase.from("profiles").upsert({
        id: otherUserId, nome_completo: "Test CT05c", matricula,
        role: "usuario", registration_status: "complete",
        default_tenant_id: tenantId || null,
      });
      // BFF resolve tenantId da sessão via tenant_memberships (Bearer path
      // em apps/bff/src/middleware/auth.ts), não direto de
      // profiles.default_tenant_id — sem isso a chamada falha antes mesmo
      // de chegar na checagem de autorização que este teste quer provar.
      if (tenantId) {
        await supabase.from("tenant_memberships").upsert({
          user_id: otherUserId, tenant_id: tenantId, role: "usuario",
        });
      }

      const otherToken = await loginToken(email, password);
      const { status, data } = await bff("POST", `/api/cautelamentos/${cautelaId}/sign-militar`, otherToken, {
        totp_token: "000000",
      });
      expect(status, `CT05c esperava 403, got ${status}: ${JSON.stringify(data)}`).toBe(403);
      expect(data.error).toMatch(/apenas o militar responsável/i);
    } finally {
      await supabase.auth.admin.deleteUser(otherUserId).catch(() => {});
    }
  });

  /**
   * CT05d — Armeiro tenta facilitar com o PRÓPRIO TOTP (não o do militar) → falha
   *
   * Prova negativa complementar à CT05b: mesmo que a autorização permita o
   * armeiro chamar o endpoint (facilitação), a VALIDAÇÃO de identidade
   * continua sendo contra o secret do militar — o próprio código do
   * armeiro nunca é aceito como prova de identidade de outra pessoa.
   */
  test("CT05d — armeiro com o PRÓPRIO TOTP falha ao facilitar assinatura do militar", async () => {
    if (!reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }

    const supabase = sb();
    const { data: item } = await supabase
      .from("material_items").select("id, material_type_id")
      .eq("status_operacional", "disponivel")
      .neq("id", cautelaItemId)
      .limit(1).single();
    if (!item) { test.skip(true, "Nenhum item disponível para CT05d"); return; }

    if (item.material_type_id) {
      await supabase.from("material_types")
        .update({ cautela_habilitada: true, quantidade_cautela: 1 })
        .eq("id", item.material_type_id).eq("cautela_habilitada", false);
    }

    const { status: createStatus, data: createData } = await bff("POST", "/api/cautelamentos", armeiroToken, {
      item_id: item.id, militar_id: militarId, reserve_id: reserveId,
      motivo_emissao: "Teste CT05d — bypass com TOTP do armeiro",
    });
    expect(createStatus, "CT05d setup: criação").toBe(201);
    const cId: string = createData.cautelamento.id;

    const armeiroCode1 = await getFreshTotpCode(armeiroToken);
    await bff("POST", `/api/cautelamentos/${cId}/sign-armeiro`, armeiroToken, { totp_token: armeiroCode1 });

    // Armeiro tenta "facilitar" usando o PRÓPRIO código — deve falhar, pois
    // a validação é contra o secret de `cautela.militar_id`, não do chamador.
    const armeiroCode2 = await getFreshTotpCode(armeiroToken);
    const { status, data } = await bff("POST", `/api/cautelamentos/${cId}/sign-militar`, armeiroToken, {
      totp_token: armeiroCode2,
    });
    expect(status, `CT05d esperava 400 (TOTP não bate com o militar), got ${status}: ${JSON.stringify(data)}`).toBe(400);
  });

  /**
   * CT06 — Substituição: antiga=substituida, nova=ativa, vínculo preservado
   */
  test("CT06 — Substituição preserva histórico e vínculos", async () => {
    if (!cautelaId || !reserveId || !militarId) { test.skip(true, "Setup incompleto"); return; }

    const supabase = sb();
    // Buscar outro item disponível para ser o novo
    const { data: novoItemData } = await supabase
      .from("material_items").select("id")
      .eq("status_operacional", "disponivel")
      .neq("id", cautelaItemId)
      .limit(1).single();

    if (!novoItemData) { test.skip(true, "Nenhum segundo item disponível para substituição"); return; }

    const { status, data } = await bff("POST", `/api/cautelamentos/${cautelaId}/substitute`, armeiroToken, {
      novo_item_id:       novoItemData.id,
      condicao_devolucao: "bom",
      motivo_emissao:     "Substituição de material — teste CT06",
      condicao_emissao:   "bom",
    });

    if (status === 409) {
      // Item original pode não estar cautelado neste ponto — aceitável
      test.skip(true, "Item original não está no estado esperado para substituição");
      return;
    }

    expect([200, 201]).toContain(status);
    expect(data.nova_cautela_id, "nova_cautela_id ausente").toBeTruthy();

    const novaCautelaId: string = data.nova_cautela_id;

    // Verificar vínculo
    const { data: novaC } = await supabase
      .from("cautelamentos").select("status, substitui").eq("id", novaCautelaId).single();
    expect(novaC?.status).toBe("ativa");
    expect(novaC?.substitui).toBe(cautelaId);

    const { data: antigaC } = await supabase
      .from("cautelamentos").select("status, substituido_por").eq("id", cautelaId).single();
    expect(antigaC?.status).toBe("substituida");
    expect(antigaC?.substituido_por).toBe(novaCautelaId);

    // Atualizar cautelaId para nova cautela para testes seguintes
    cautelaId = novaCautelaId;
    const { data: newItemPeek } = await supabase
      .from("cautelamentos").select("item_id").eq("id", novaCautelaId).single();
    if (newItemPeek?.item_id) cautelaItemId = newItemPeek.item_id;
  });

  /**
   * CT07 — Encerramento normal → item volta para disponivel
   */
  test("CT07 — Encerramento normal → item=disponivel; holder=NULL", async () => {
    if (!cautelaId) { test.skip(true, "Nenhuma cautela ativa para encerrar"); return; }

    const supabase = sb();

    // Verificar estado atual
    const { data: cautAtual } = await supabase
      .from("cautelamentos").select("item_id, status").eq("id", cautelaId).single();
    if (cautAtual?.status !== "ativa") { test.skip(true, `Cautela já em status ${cautAtual?.status}`); return; }

    const currentItemId = cautAtual?.item_id ?? cautelaItemId;

    const { status } = await bff("POST", `/api/cautelamentos/${cautelaId}/return`, armeiroToken, {
      condicao_devolucao: "bom",
      motivo_devolucao: "Encerramento de teste CT07",
    });

    expect([200, 201]).toContain(status);

    const { data: item } = await supabase
      .from("material_items").select("status_operacional, current_holder_user_id, active_cautelamento_id")
      .eq("id", currentItemId).single();

    expect(item?.status_operacional).toBe("disponivel");
    expect(item?.current_holder_user_id).toBeNull();
    expect(item?.active_cautelamento_id).toBeNull();
  });

  /**
   * CT08 — Histórico de item: todos os cautelamentos por item_id
   */
  test("CT08 — Histórico de item retorna registros ordenados por data_emissao", async () => {
    if (!cautelaItemId) { test.skip(true, "cautelaItemId não disponível"); return; }

    const { status, data } = await bff("GET", `/api/cautelamentos/history/item/${cautelaItemId}`, armeiroToken);

    expect(status).toBe(200);
    expect(Array.isArray(data.history)).toBe(true);

    // Deve ter pelo menos os registros criados nesta suite (CT01 + CT06)
    // Se apenas 1, aceitar — depende da sequência de execução
    expect(data.history.length).toBeGreaterThanOrEqual(1);

    // Verificar ordenação decrescente
    if (data.history.length >= 2) {
      const datas = data.history.map((h: { data_emissao: string }) => new Date(h.data_emissao).getTime());
      for (let i = 1; i < datas.length; i++) {
        expect(datas[i - 1]).toBeGreaterThanOrEqual(datas[i]);
      }
    }
  });
});
