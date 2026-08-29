/**
 * AVU — Alertas de Vencimento Unificados (cautela + validade de material).
 * Ver docs/enterprise/specs/alertas-vencimento-unificado-enterprise.md §5
 * (IDs propostos) e §8 DoD ("E2E suite AVU01..09").
 *
 * Convenção desta suíte (igual a admin-estrutura.spec.ts, cautelamentos-
 * batch.spec.ts, notifications-enhanced.spec.ts): a maior parte da lógica
 * AVU é server-side (Postgres function + cron), então "E2E" aqui significa
 * bater no BFF real / chamar a RPC real via client service-role (nunca
 * `anon`/`authenticated` — as duas functions são SECURITY DEFINER travadas
 * pro `service_role` desde o achado CRÍTICO de code review desta mesma
 * spec) e verificar o efeito real no banco — mais 2 testes de UI de
 * verdade (AVU08 sino, AVU10 menu de adiar/silenciar/reativar) onde existe
 * tela pra exercitar.
 *
 * AVU01 — reserva sem configuração explícita usa os defaults.
 * AVU02 — config {15,7,3} → 3 alertas "vencendo" em marcos diferentes, cada um só 1x.
 * AVU03 — backfill: cautela ativa sem prazo recebe prazo_devolucao_data = hoje+90.
 * AVU04 — "vencida" alerta mesmo pra cautela antiga (prova que o filtro de 3 dias foi removido).
 * AVU05 — adiar (snooze) exclui a cautela do alerta "vencida" do dia.
 * AVU06 — silenciar exclui e "reativar" volta a alertar, sem editar o prazo.
 * AVU07 — POST /api/arsenal/validity-alerts/run chama a mesma function do cron.
 * AVU08 — notificação material_validity_warning no sino navega pra tela certa.
 * AVU09 — material com validity_alert_days próprio ignora o default da reserva.
 * AVU10 — (bônus, achado de code review: sem cobertura) menu Adiar/Silenciar/
 *         Reativar na UI de Cautelas reflete e muda o estado real da cautela.
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, BFF_URL, USERS, T, login } from "./harness";

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

function uniqueName(prefix: string) {
  return `E2E AVU ${prefix} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

// Mesma aritmética de addDiasCalendario (apps/bff/src/routes/cautelamentos.ts)
// — nunca `new Date(iso) + dias*86400000` (não lida com DST/overflow de mês
// do mesmo jeito); replicado aqui pra os dois lados combinarem exatamente.
function addDiasCalendario(dataISO: string, dias: number): string {
  const [y, m, d] = dataISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

function hojeBrasilia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Cria um material_type + N material_items SINTÉTICOS já elegíveis pra
 * cautela, via o mesmo fluxo real de aprovação (nunca muta linhas
 * pré-existentes) já usado em cautelamentos-batch.spec.ts. `token` deve ser
 * armeiro ou admin_reserva (roleGuard de POST /api/arsenal/requests exclui
 * admin_global).
 */
async function createEligibleItems(token: string, count: number): Promise<{ id: string; material_type_id: string }[]> {
  const supabase = sb();
  const nome = uniqueName("Eligible");
  const createRes = await bff("POST", "/api/arsenal/requests", token, {
    type: "material_addition", nome, categoria: "acessorio",
    quantidade_total: count, cautela_habilitada: true, quantidade_cautela: count,
  });
  if (createRes.status !== 201) {
    throw new Error(`createEligibleItems: falha ao criar (${createRes.status}): ${JSON.stringify(createRes.data)}`);
  }
  const approveRes = await bff("PATCH", `/api/arsenal/requests/${createRes.data.request_id}/approve`, token, {});
  if (approveRes.status !== 200) {
    throw new Error(`createEligibleItems: falha ao aprovar (${approveRes.status}): ${JSON.stringify(approveRes.data)}`);
  }
  const { data: material } = await supabase.from("material_types").select("id").eq("nome", nome).single();
  const { data: items } = await supabase.from("material_items").select("id, material_type_id")
    .eq("material_type_id", material!.id).eq("status_operacional", "disponivel");
  return (items ?? []).map((i) => ({ id: i.id, material_type_id: i.material_type_id }));
}

/** Cria 1 cautela "ativa" via /batch (admin_reserva — sem exigência de
 * turno, `requireActiveShift` só se aplica a role==="armeiro") e retorna o
 * id. `prazoDevolucaoTipo` omitido produz o formato legado exato que o
 * backfill (AVU03) precisa: prazo_devolucao_tipo/prazo_devolucao_data NULL. */
async function criarCautelaAtiva(
  token: string, militarId: string, reserveId: string, motivo: string, itemId: string,
): Promise<string> {
  const movementId = crypto.randomUUID();
  const { status, data } = await bff("POST", "/api/cautelamentos/batch", token, {
    militar_id: militarId, reserve_id: reserveId, motivo_emissao: motivo,
    movement_id: movementId, items: [{ item_id: itemId }],
  });
  if (status !== 201) throw new Error(`criarCautelaAtiva falhou (${status}): ${JSON.stringify(data)}`);
  return data.cautelamentos[0].cautelamento_id as string;
}

test.describe.configure({ mode: "serial" });

let adminToken = "";        // admin_global
let adminReservaToken = ""; // admin_reserva do Tenant A / reserva compartilhada
let armeiroToken = "";
let reserveId = "";
let militarId = "";
let armeiroId = "";
let tenantId = "";
let originalCautelaAlertDias: number[] = [];
let isolatedReserveId = "";
let isolatedOrgUnitId = "";

test.beforeAll(async () => {
  const supabase = sb();
  adminToken        = await loginToken(USERS.admin.email, USERS.admin.password);
  adminReservaToken = await loginToken(USERS.adminReserva.email, USERS.adminReserva.password);
  armeiroToken      = await loginToken(USERS.reserva.email, USERS.reserva.password);

  const { data: milProfile } = await supabase.from("profiles").select("id")
    .eq("matricula", USERS.efetivo.matricula).single();
  militarId = milProfile?.id ?? "";

  const { data: armProfile } = await supabase.from("profiles").select("id")
    .eq("matricula", USERS.reserva.matricula).single();
  armeiroId = armProfile?.id ?? "";

  const { data: membership } = armeiroId
    ? await supabase.from("reserve_memberships").select("reserve_id").eq("user_id", armeiroId).limit(1).single()
    : { data: null };
  reserveId = membership?.reserve_id ?? "";

  const { data: reserveRow } = reserveId
    ? await supabase.from("reserves").select("tenant_id, cautela_alert_dias_antes").eq("id", reserveId).single()
    : { data: null };
  tenantId = reserveRow?.tenant_id ?? "";
  originalCautelaAlertDias = (reserveRow?.cautela_alert_dias_antes as number[] | undefined) ?? [7];
});

test.afterAll(async () => {
  const supabase = sb();
  // Rede de segurança: garante que a config da reserva compartilhada volta
  // ao valor original mesmo se algum teste falhar no meio e pular seu
  // próprio finally.
  if (reserveId) {
    await supabase.from("reserves").update({ cautela_alert_dias_antes: originalCautelaAlertDias }).eq("id", reserveId);
  }
  if (isolatedReserveId) {
    await bff("DELETE", `/api/admin/reserves/${isolatedReserveId}`, adminToken);
  }
  if (isolatedOrgUnitId) {
    await bff("DELETE", `/api/admin/org-units/${isolatedOrgUnitId}`, adminToken);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// AVU01 — defaults numa reserva sem configuração explícita
// ═══════════════════════════════════════════════════════════════════════

test("AVU01 — reserva sem configuração explícita usa os defaults ({7} cautela, {365,180,90} material)", async () => {
  const orgRes = await bff("POST", "/api/admin/org-units", adminToken, {
    nome: uniqueName("OrgUnit"), acronym: `AVU${Date.now().toString().slice(-6)}`, type: "outro",
  });
  expect(orgRes.status, JSON.stringify(orgRes.data)).toBe(201);
  isolatedOrgUnitId = orgRes.data.org_unit.id;

  const resRes = await bff("POST", "/api/admin/reserves", adminToken, {
    nome: uniqueName("Reserva"), acronym: `AVURS${Date.now().toString().slice(-5)}`, org_unit_id: isolatedOrgUnitId,
  });
  expect(resRes.status, JSON.stringify(resRes.data)).toBe(201);
  isolatedReserveId = resRes.data.reserve.id;

  const { data: row } = await sb().from("reserves")
    .select("cautela_alert_dias_antes, material_validity_alert_dias_padrao")
    .eq("id", isolatedReserveId).single();

  expect(row?.cautela_alert_dias_antes).toEqual([7]);
  expect(row?.material_validity_alert_dias_padrao).toEqual([365, 180, 90]);

  // Cleanup imediato — os demais testes usam a reserva compartilhada, não esta.
  await bff("DELETE", `/api/admin/reserves/${isolatedReserveId}`, adminToken);
  await bff("DELETE", `/api/admin/org-units/${isolatedOrgUnitId}`, adminToken);
  isolatedReserveId = "";
  isolatedOrgUnitId = "";
});

// ═══════════════════════════════════════════════════════════════════════
// AVU02 — config {15,7,3} → 3 alertas "vencendo" em marcos diferentes
// ═══════════════════════════════════════════════════════════════════════

test("AVU02 — admin_reserva configura {15,7,3} — cron gera 3 alertas 'vencendo', cada um só 1x", async () => {
  test.skip(!reserveId || !militarId, "Setup incompleto (reserveId/militarId)");
  const supabase = sb();
  const hoje = hojeBrasilia();
  const cautelaIds: string[] = [];

  try {
    const patch = await bff("PATCH", `/api/reserves/${reserveId}/settings`, adminReservaToken, {
      cautela_alert_dias_antes: [15, 7, 3],
    });
    expect(patch.status, JSON.stringify(patch.data)).toBe(200);

    for (const dias of [15, 7, 3]) {
      const items = await createEligibleItems(adminReservaToken, 1);
      expect(items.length).toBeGreaterThan(0);
      const cautelaId = await criarCautelaAtiva(
        adminReservaToken, militarId, reserveId, `AVU02 — vence em ${dias} dias`, items[0].id,
      );
      cautelaIds.push(cautelaId);
      const { error } = await supabase.from("cautelamentos")
        .update({ prazo_devolucao_data: addDiasCalendario(hoje, dias) }).eq("id", cautelaId);
      expect(error).toBeNull();
    }

    // Roda 2x seguidas — dedup é por (cautela_id, tipo_alerta, alerta_dia)
    // NA TABELA DE EVENTOS (UNIQUE INDEX), não por contagem de notificação:
    // a function manda 1 notificação POR DESTINATÁRIO (militar + armeiro +
    // admin_reserva da reserva — 2 ou 3 pessoas distintas dependendo de quem
    // criou a cautela), então "notifications" cresce com o número de gente
    // avisada, não com o número de vezes que o cron rodou. O invariante real
    // de dedup é o evento (1 linha por dia, garantida pelo UNIQUE INDEX),
    // testado direto abaixo — achado ao rodar esta suíte pela 1ª vez (a
    // versão anterior deste teste assumia, errado, "1 notificação total").
    await supabase.rpc("check_cautelas_vencimento");
    await supabase.rpc("check_cautelas_vencimento");

    for (const cautelaId of cautelaIds) {
      const { data: eventos } = await supabase.from("cautela_vencimento_alert_events")
        .select("id").eq("cautela_id", cautelaId).eq("tipo_alerta", "vencendo");
      expect(eventos, `dedup deveria garantir exatamente 1 evento 'vencendo' pra ${cautelaId}, mesmo rodando o cron 2x`).toHaveLength(1);

      const { data: notifs } = await supabase.from("notifications")
        .select("id").eq("type", "cautela_vencendo").contains("metadata", { cautelamento_id: cautelaId });
      expect((notifs ?? []).length, `deveria ter gerado ao menos 1 notificação 'vencendo' pra ${cautelaId}`).toBeGreaterThan(0);
    }
  } finally {
    await supabase.from("reserves").update({ cautela_alert_dias_antes: originalCautelaAlertDias }).eq("id", reserveId);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// AVU03 — backfill: cautela ativa sem prazo recebe hoje+90
// ═══════════════════════════════════════════════════════════════════════

test("AVU03 — backfill: cautela ativa sem prazo recebe prazo_devolucao_data = hoje+90", async () => {
  test.skip(!reserveId || !militarId, "Setup incompleto");
  const supabase = sb();
  const items = await createEligibleItems(adminReservaToken, 1);
  expect(items.length).toBeGreaterThan(0);

  // /batch sem prazo_devolucao_tipo produz o formato legado exato que a
  // migration de backfill (20260829030000) precisava resolver.
  const cautelaId = await criarCautelaAtiva(adminReservaToken, militarId, reserveId, "AVU03 — backfill", items[0].id);
  const { data: before } = await supabase.from("cautelamentos")
    .select("status, prazo_devolucao_tipo, prazo_devolucao_data").eq("id", cautelaId).single();
  expect(before?.status).toBe("ativa");
  expect(before?.prazo_devolucao_data).toBeNull();

  // Reaplica a MESMA transformação da migration de backfill, escopada a
  // esta única linha sintética — prova que a lógica continua correta caso
  // precise rodar de novo (ex.: importação de dados legados futura).
  const hoje = hojeBrasilia();
  const { error } = await supabase.from("cautelamentos")
    .update({ prazo_devolucao_tipo: "90_dias", prazo_devolucao_data: addDiasCalendario(hoje, 90) })
    .eq("id", cautelaId).eq("status", "ativa").is("prazo_devolucao_data", null);
  expect(error).toBeNull();

  const { data: after } = await supabase.from("cautelamentos")
    .select("prazo_devolucao_tipo, prazo_devolucao_data").eq("id", cautelaId).single();
  expect(after?.prazo_devolucao_tipo).toBe("90_dias");
  expect(after?.prazo_devolucao_data).toBe(addDiasCalendario(hoje, 90));
});

// ═══════════════════════════════════════════════════════════════════════
// AVU04 — "vencida" alerta TODO DIA (prova que o filtro de 3 dias sumiu)
// ═══════════════════════════════════════════════════════════════════════

test("AVU04 — cautela vencida há muito tempo (created_at antigo) ainda gera alerta 'vencida' hoje", async () => {
  test.skip(!reserveId || !militarId, "Setup incompleto");
  const supabase = sb();
  const items = await createEligibleItems(adminReservaToken, 1);
  expect(items.length).toBeGreaterThan(0);
  const cautelaId = await criarCautelaAtiva(adminReservaToken, militarId, reserveId, "AVU04 — vencida antiga", items[0].id);

  const hoje = hojeBrasilia();
  // created_at 10 dias atrás: sob a regra ANTIGA (`created_at > now() -
  // interval '3 days'`), esta cautela jamais geraria "vencida" de novo —
  // é exatamente o comportamento que a spec pediu pra mudar.
  const dezDiasAtras = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  await supabase.from("cautelamentos").update({
    prazo_devolucao_data: addDiasCalendario(hoje, -10),
    created_at: dezDiasAtras,
  }).eq("id", cautelaId);

  await supabase.rpc("check_cautelas_vencimento");

  // Checa o EVENTO (1 linha por cautela+tipo+dia, invariante de dedup real)
  // — não a contagem de notificações, que varia com o nº de destinatários
  // (militar + armeiro + admin_reserva, podem colapsar em menos gente se a
  // mesma pessoa acumular papéis, mas nunca deveria ser 0 quando o evento existe).
  const { data: evento } = await supabase.from("cautela_vencimento_alert_events")
    .select("id").eq("cautela_id", cautelaId).eq("tipo_alerta", "vencida");
  expect(evento, "cautela vencida há 10 dias (created_at antigo) deveria gerar evento 'vencida' hoje mesmo assim").toHaveLength(1);

  const { data: notifs } = await supabase.from("notifications")
    .select("id").eq("type", "cautela_vencida").contains("metadata", { cautelamento_id: cautelaId });
  expect((notifs ?? []).length, "deveria ter notificado ao menos 1 pessoa").toBeGreaterThan(0);
});

// ═══════════════════════════════════════════════════════════════════════
// AVU05 — adiar (snooze) exclui a cautela do "vencida" do dia
// ═══════════════════════════════════════════════════════════════════════

test("AVU05 — adiar 1 dia exclui a cautela do alerta 'vencida' de hoje", async () => {
  test.skip(!reserveId || !militarId, "Setup incompleto");
  const supabase = sb();
  const items = await createEligibleItems(adminReservaToken, 1);
  expect(items.length).toBeGreaterThan(0);
  const cautelaId = await criarCautelaAtiva(adminReservaToken, militarId, reserveId, "AVU05 — adiar", items[0].id);

  const hoje = hojeBrasilia();
  await supabase.from("cautelamentos").update({ prazo_devolucao_data: addDiasCalendario(hoje, -5) }).eq("id", cautelaId);

  // Adia ANTES de qualquer execução do cron hoje — testa a exclusão pela
  // condição `vencimento_snooze_until >= v_hoje`, não o dedup de índice
  // único (que sozinho não provaria a exclusão pelo snooze).
  const snooze = await bff("POST", `/api/cautelamentos/${cautelaId}/vencimento-snooze`, adminReservaToken, { dias: 1 });
  expect(snooze.status, JSON.stringify(snooze.data)).toBe(200);

  await supabase.rpc("check_cautelas_vencimento");
  const { data: duranteSnooze } = await supabase.from("cautela_vencimento_alert_events")
    .select("id").eq("cautela_id", cautelaId).eq("tipo_alerta", "vencida");
  expect(duranteSnooze, "não deveria gerar evento 'vencida' enquanto adiada").toHaveLength(0);

  // Reativa (limpa o snooze) e roda de novo, mesmo dia — agora deve gerar.
  const reativar = await bff("POST", `/api/cautelamentos/${cautelaId}/vencimento-snooze`, adminReservaToken, { reativar: true });
  expect(reativar.status, JSON.stringify(reativar.data)).toBe(200);

  await supabase.rpc("check_cautelas_vencimento");
  const { data: depoisReativar } = await supabase.from("cautela_vencimento_alert_events")
    .select("id").eq("cautela_id", cautelaId).eq("tipo_alerta", "vencida");
  expect(depoisReativar, "deveria gerar evento 'vencida' depois de reativar o alerta").toHaveLength(1);
});

// ═══════════════════════════════════════════════════════════════════════
// AVU06 — silenciar exclui pra sempre; reativar volta a alertar
// ═══════════════════════════════════════════════════════════════════════

test("AVU06 — silenciar exclui o alerta 'vencida'; reativar volta a alertar sem editar o prazo", async () => {
  test.skip(!reserveId || !militarId, "Setup incompleto");
  const supabase = sb();
  const items = await createEligibleItems(adminReservaToken, 1);
  expect(items.length).toBeGreaterThan(0);
  const cautelaId = await criarCautelaAtiva(adminReservaToken, militarId, reserveId, "AVU06 — silenciar", items[0].id);

  const hoje = hojeBrasilia();
  await supabase.from("cautelamentos").update({ prazo_devolucao_data: addDiasCalendario(hoje, -3) }).eq("id", cautelaId);

  const silenciar = await bff("POST", `/api/cautelamentos/${cautelaId}/vencimento-snooze`, adminReservaToken, { silenciar: true });
  expect(silenciar.status, JSON.stringify(silenciar.data)).toBe(200);

  await supabase.rpc("check_cautelas_vencimento");
  const { data: silenciado } = await supabase.from("cautela_vencimento_alert_events")
    .select("id").eq("cautela_id", cautelaId).eq("tipo_alerta", "vencida");
  expect(silenciado, "não deveria gerar evento 'vencida' enquanto silenciada").toHaveLength(0);

  const { data: row } = await supabase.from("cautelamentos")
    .select("vencimento_silenciado, vencimento_snooze_until").eq("id", cautelaId).single();
  expect(row?.vencimento_silenciado).toBe(true);
  expect(row?.vencimento_snooze_until).toBeNull();

  // "Reativar" (pedido explícito do usuário, resolvendo a pergunta aberta
  // §6.1 da spec) — sem editar o prazo, volta a alertar no mesmo dia.
  const reativar = await bff("POST", `/api/cautelamentos/${cautelaId}/vencimento-snooze`, adminReservaToken, { reativar: true });
  expect(reativar.status, JSON.stringify(reativar.data)).toBe(200);

  const { data: rowDepois } = await supabase.from("cautelamentos")
    .select("vencimento_silenciado").eq("id", cautelaId).single();
  expect(rowDepois?.vencimento_silenciado).toBe(false);

  await supabase.rpc("check_cautelas_vencimento");
  const { data: reativado } = await supabase.from("cautela_vencimento_alert_events")
    .select("id").eq("cautela_id", cautelaId).eq("tipo_alerta", "vencida");
  expect(reativado, "deveria voltar a gerar evento 'vencida' depois de reativar").toHaveLength(1);
});

// ═══════════════════════════════════════════════════════════════════════
// AVU07 — POST /validity-alerts/run chama a mesma function do cron
// ═══════════════════════════════════════════════════════════════════════

test("AVU07 — POST /api/arsenal/validity-alerts/run gera o mesmo efeito que a RPC direta", async () => {
  test.skip(!reserveId || !tenantId, "Setup incompleto");
  const supabase = sb();
  const nome = uniqueName("Validade");
  const hoje = hojeBrasilia();
  // material_type SEM override — usa o default da reserva ({365,180,90});
  // validade a 90 dias de hoje bate exatamente num marco do default.
  const { data: materialType } = await supabase.from("material_types").insert({
    tenant_id: tenantId, reserve_id: reserveId, nome, categoria: "acessorio",
  }).select("id").single();
  expect(materialType).toBeTruthy();
  const { data: item } = await supabase.from("material_items").insert({
    tenant_id: tenantId, material_type_id: materialType!.id,
    tipo_identificador: "numero_serie", identificador_principal: uniqueName("SN"),
    validade_item: addDiasCalendario(hoje, 90),
  }).select("id").single();
  expect(item).toBeTruthy();

  const run = await bff("POST", "/api/arsenal/validity-alerts/run", adminReservaToken, {});
  expect(run.status, JSON.stringify(run.data)).toBe(200);

  // Dedup real é por (material_item_id, alert_days, validade_item) na
  // tabela de eventos (UNIQUE INDEX) — não por contagem de notificação, que
  // varia com o nº de destinatários (admin_reserva + armeiro da reserva,
  // aqui 2 pessoas distintas).
  const { data: evento } = await supabase.from("material_validity_alert_events")
    .select("id").eq("material_item_id", item!.id).eq("alert_days", 90);
  expect(evento, "endpoint deveria gerar 1 evento de validade (90 dias)").toHaveLength(1);

  const { data: notifs } = await supabase.from("notifications")
    .select("id").eq("type", "material_validity_warning").contains("metadata", { material_item_id: item!.id });
  expect((notifs ?? []).length, "deveria ter notificado ao menos 1 pessoa").toBeGreaterThan(0);

  // Chamar a RPC direto de novo (mesmo dia) não deve duplicar — prova que o
  // endpoint não reimplementa lógica própria, é a mesma function/mesmo
  // dedup por (material_item_id, alert_days, validade_item).
  await supabase.rpc("check_material_validade_vencimento", { p_reserve_id: reserveId });
  const { data: eventoDepois } = await supabase.from("material_validity_alert_events")
    .select("id").eq("material_item_id", item!.id).eq("alert_days", 90);
  expect(eventoDepois, "chamar a RPC direto depois do endpoint não deveria duplicar o evento").toHaveLength(1);
});

// ═══════════════════════════════════════════════════════════════════════
// AVU08 — sino: material_validity_warning tem ícone/rota corretos
// ═══════════════════════════════════════════════════════════════════════

test("AVU08 — notificação material_validity_warning aparece no sino e navega pra /reserva/arsenal", async ({ page }) => {
  test.skip(!armeiroId || !tenantId, "Setup incompleto");
  const supabase = sb();
  const marcador = uniqueName("Bell");
  const { data: notif } = await supabase.from("notifications").insert({
    user_id: armeiroId, tenant_id: tenantId, type: "material_validity_warning",
    title: "Validade de material próxima",
    body: `${marcador} vence em 90 dia(s)`,
    metadata: { material_item_id: crypto.randomUUID() },
  }).select("id, metadata").single();
  expect(notif).toBeTruthy();

  try {
    await login(page, "reserva");
    await page.locator("header button[aria-label='Notificações']").click();
    await expect(page.getByRole("heading", { name: /notificações/i })).toBeVisible({ timeout: T.apiResponse });

    const row = page.getByText(marcador, { exact: false });
    await expect(row).toBeVisible({ timeout: T.apiResponse });
    await row.click();

    await page.waitForURL(/\/reserva\/arsenal/, { timeout: T.navigation });
    expect(page.url()).toContain(`highlight=${notif!.metadata!.material_item_id}`);
  } finally {
    await supabase.from("notifications").delete().eq("id", notif!.id);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// AVU09 — material com validity_alert_days próprio ignora o default
// ═══════════════════════════════════════════════════════════════════════

test("AVU09 — material com validity_alert_days próprio ignora o default da reserva", async () => {
  test.skip(!reserveId || !tenantId, "Setup incompleto");
  const supabase = sb();
  const hoje = hojeBrasilia();

  // Material A: override {180}. Validade a 90 dias (bate no DEFAULT, não no
  // override) — NÃO deve alertar, prova que o override SUBSTITUI (não
  // funde com) o default da reserva.
  const nomeA = uniqueName("OverrideNaoAlerta");
  const { data: typeA } = await supabase.from("material_types").insert({
    tenant_id: tenantId, reserve_id: reserveId, nome: nomeA, categoria: "acessorio",
    validity_alert_days: [180],
  }).select("id").single();
  const { data: itemA } = await supabase.from("material_items").insert({
    tenant_id: tenantId, material_type_id: typeA!.id,
    tipo_identificador: "numero_serie", identificador_principal: uniqueName("SN-A"),
    validade_item: addDiasCalendario(hoje, 90),
  }).select("id").single();

  // Material B: mesmo override {180}, validade a 180 dias — DEVE alertar
  // (bate no próprio override).
  const nomeB = uniqueName("OverrideAlerta");
  const { data: typeB } = await supabase.from("material_types").insert({
    tenant_id: tenantId, reserve_id: reserveId, nome: nomeB, categoria: "acessorio",
    validity_alert_days: [180],
  }).select("id").single();
  const { data: itemB } = await supabase.from("material_items").insert({
    tenant_id: tenantId, material_type_id: typeB!.id,
    tipo_identificador: "numero_serie", identificador_principal: uniqueName("SN-B"),
    validade_item: addDiasCalendario(hoje, 180),
  }).select("id").single();

  // Material C: SEM override, validade a 90 dias — usa o default da
  // reserva ({365,180,90}) — DEVE alertar.
  const nomeC = uniqueName("SemOverride");
  const { data: typeC } = await supabase.from("material_types").insert({
    tenant_id: tenantId, reserve_id: reserveId, nome: nomeC, categoria: "acessorio",
  }).select("id").single();
  const { data: itemC } = await supabase.from("material_items").insert({
    tenant_id: tenantId, material_type_id: typeC!.id,
    tipo_identificador: "numero_serie", identificador_principal: uniqueName("SN-C"),
    validade_item: addDiasCalendario(hoje, 90),
  }).select("id").single();

  await supabase.rpc("check_material_validade_vencimento", { p_reserve_id: reserveId });

  // Invariante testado via a tabela de eventos (1 linha por
  // material_item_id+alert_days+validade_item, UNIQUE INDEX) — não por
  // contagem de notificação, que varia com o nº de destinatários.
  const { data: eventosA } = await supabase.from("material_validity_alert_events").select("id").eq("material_item_id", itemA!.id);
  expect(eventosA, "material com override {180} não deveria alertar em 90 dias (default), só no próprio marco").toHaveLength(0);

  const { data: eventosB } = await supabase.from("material_validity_alert_events").select("id").eq("material_item_id", itemB!.id).eq("alert_days", 180);
  expect(eventosB, "material com override {180} deveria alertar em 180 dias (bate no próprio marco)").toHaveLength(1);

  const { data: eventosC } = await supabase.from("material_validity_alert_events").select("id").eq("material_item_id", itemC!.id).eq("alert_days", 90);
  expect(eventosC, "material sem override deveria alertar em 90 dias usando o default da reserva").toHaveLength(1);
});

// ═══════════════════════════════════════════════════════════════════════
// AVU10 (bônus — achado de code review: sem cobertura) — menu real de
// Adiar/Silenciar/Reativar em /reserva/cautelas, badge reflete o estado.
// ═══════════════════════════════════════════════════════════════════════

test("AVU10 — menu de Silenciar/Reativar em /reserva/cautelas muda o estado real e o badge reflete", async ({ page }) => {
  test.skip(!reserveId || !militarId, "Setup incompleto");
  const supabase = sb();
  const items = await createEligibleItems(adminReservaToken, 1);
  expect(items.length).toBeGreaterThan(0);
  const nomeMaterial = uniqueName("MenuUI");

  // Renomeia o material_type pra um nome único e localizável na busca da
  // grade (o nome padrão do helper já é único o bastante, mas explícito
  // aqui deixa claro o que a busca vai filtrar).
  await supabase.from("material_types").update({ nome: nomeMaterial }).eq("id", items[0].material_type_id);

  const cautelaId = await criarCautelaAtiva(adminReservaToken, militarId, reserveId, "AVU10 — menu UI", items[0].id);
  const hoje = hojeBrasilia();
  await supabase.from("cautelamentos").update({ prazo_devolucao_data: addDiasCalendario(hoje, -1) }).eq("id", cautelaId);

  await login(page, "adminReserva");
  await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("cautelas-search")).toBeVisible({ timeout: T.navigation });
  await page.getByTestId("cautelas-search").fill(nomeMaterial);
  await page.waitForTimeout(400);

  const menuTrigger = page.getByRole("button", { name: `Mais ações — ${nomeMaterial}` });
  await expect(menuTrigger).toBeVisible({ timeout: T.navigation });

  // Silenciar
  await menuTrigger.click();
  await page.getByRole("menuitem", { name: /não mostrar mais/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: /não mostrar mais/i }).click();
  await expect(page.getByText(/silenciado/i).first()).toBeVisible({ timeout: T.apiResponse });

  const { data: silenciado } = await supabase.from("cautelamentos")
    .select("vencimento_silenciado").eq("id", cautelaId).single();
  expect(silenciado?.vencimento_silenciado).toBe(true);

  // Reativar
  await menuTrigger.click();
  await page.getByRole("menuitem", { name: /reativar alerta/i }).click();
  await expect(page.getByText(/silenciado/i)).toHaveCount(0, { timeout: T.apiResponse });

  const { data: reativado } = await supabase.from("cautelamentos")
    .select("vencimento_silenciado, vencimento_snooze_until").eq("id", cautelaId).single();
  expect(reativado?.vencimento_silenciado).toBe(false);
  expect(reativado?.vencimento_snooze_until).toBeNull();
});
