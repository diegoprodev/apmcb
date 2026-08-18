/**
 * Andrômeda — Elegibilidade e Quantidade Reservada para Cautela
 * Ver docs/enterprise/specs/cautela-eligibility-quantity-enterprise.md
 *
 * CAUELIG04 — quantidade_cautela > quantidade_total bloqueia na criação da solicitação (400)
 * CAUELIG05/06 — após aprovação, material_types.cautela_habilitada/quantidade_cautela persistidos
 *                corretamente e N material_items sintéticos criados (Cenário B — material bulk)
 * CAUELIG07 — GET /api/arsenal/items/disponiveis?for=cautela só retorna itens de materiais habilitados
 * CAUELIG08 — POST /api/cautelamentos rejeita item de material NÃO habilitado, mesmo via payload direto
 * CAUELIG09 — GET /api/arsenal/items/disponiveis (sem ?for=cautela) não regride — continua vendo todos
 * CAUELIG10/11 — PATCH /api/arsenal/:id: desabilitar bloqueado com cautela ativa / liberado sem cautelas ativas
 *
 * IMPORTANTE: esta suíte depende das migrations
 * supabase/migrations/20260818100000_cautela_eligibility_quantity.sql e
 * supabase/migrations/20260818110000_cautela_reserve_excludes_daily_stock.sql,
 * que precisam ser aplicadas manualmente no Supabase Dashboard, NESSA ORDEM
 * (este projeto não tem CLI/push automatizado pra DDL). Antes das migrations
 * aplicadas, todo teste aqui falha com "column material_types.
 * cautela_habilitada does not exist" — comportamento esperado, não um bug
 * desta suíte.
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BFF_URL, USERS, BASE_URL, login } from "./harness";

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

function uniqueMaterialName(prefix: string) {
  return `E2E Cautela ${prefix} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

let adminReservaToken = "";

test.beforeAll(async () => {
  adminReservaToken = await loginToken(USERS.adminReserva.email, USERS.adminReserva.password);
});

test.describe("CAUELIG — Elegibilidade e Quantidade Reservada para Cautela", () => {

  test("CAUELIG04 — quantidade_cautela > quantidade_total bloqueia criação da solicitação", async () => {
    const { status, data } = await bff("POST", "/api/arsenal/requests", adminReservaToken, {
      type: "material_addition",
      nome: uniqueMaterialName("QtyOverflow"),
      categoria: "acessorio",
      quantidade_total: 5,
      cautela_habilitada: true,
      quantidade_cautela: 10, // > quantidade_total
    });
    expect(status).toBe(400);
    expect(String(data.error ?? "")).toMatch(/n[ãa]o pode exceder/i);
  });

  test("CAUELIG05/06 — aprovação persiste cautela_habilitada/quantidade_cautela e cria N itens sintéticos", async () => {
    const supabase = sb();
    const nome = uniqueMaterialName("Bulk");

    const createRes = await bff("POST", "/api/arsenal/requests", adminReservaToken, {
      type: "material_addition",
      nome,
      categoria: "acessorio",
      quantidade_total: 20,
      cautela_habilitada: true,
      quantidade_cautela: 3,
    });
    expect(createRes.status).toBe(201);
    const requestId = createRes.data.request_id as string;
    expect(requestId).toBeTruthy();

    const approveRes = await bff("PATCH", `/api/arsenal/requests/${requestId}/approve`, adminReservaToken, {});
    expect(approveRes.status).toBe(200);

    const { data: material } = await supabase
      .from("material_types")
      .select("id, cautela_habilitada, quantidade_cautela, quantidade_total")
      .eq("nome", nome)
      .single();
    expect(material?.cautela_habilitada).toBe(true);
    expect(material?.quantidade_cautela).toBe(3);
    expect(material?.quantidade_total).toBe(20);

    const { count } = await supabase
      .from("material_items")
      .select("id", { count: "exact", head: true })
      .eq("material_type_id", material!.id);
    expect(count).toBe(3);
  });

  test("CAUELIG09 — material_addition sem cautela_habilitada continua sem material_items (Cenário B, comportamento pré-existente preservado)", async () => {
    const supabase = sb();
    const nome = uniqueMaterialName("SemCautela");

    const createRes = await bff("POST", "/api/arsenal/requests", adminReservaToken, {
      type: "material_addition",
      nome,
      categoria: "acessorio",
      quantidade_total: 15,
      // cautela_habilitada omitido — default false
    });
    expect(createRes.status).toBe(201);
    const requestId = createRes.data.request_id as string;

    const approveRes = await bff("PATCH", `/api/arsenal/requests/${requestId}/approve`, adminReservaToken, {});
    expect(approveRes.status).toBe(200);

    const { data: material } = await supabase
      .from("material_types")
      .select("id, cautela_habilitada")
      .eq("nome", nome)
      .single();
    expect(material?.cautela_habilitada).toBe(false);

    const { count } = await supabase
      .from("material_items")
      .select("id", { count: "exact", head: true })
      .eq("material_type_id", material!.id);
    expect(count).toBe(0);
  });

  test("CAUELIG07/08 — item de material não habilitado: some do autocomplete ?for=cautela E é rejeitado pelo backend mesmo via payload direto", async () => {
    const supabase = sb();
    const nome = uniqueMaterialName("NaoHabilitado");
    // GET /items/disponiveis filtra por `q` contra identificador_principal
    // (não contra o nome do material_type, ver arsenal.ts linha ~1231) — o
    // numero_serie vira o identificador_principal deste item (Cenário A, ver
    // makePhysicalItems), então é ele que precisa ser usado como `q` aqui.
    // Achado real: a versão anterior deste teste passava `q=nome`, o que
    // nunca deveria ter batido contra identificador_principal — só não doeu
    // antes porque a suíte inteira falhava mais cedo (coluna cautela_
    // habilitada ainda não existia). Sem filtrar por algo específico deste
    // item, o `.limit(300)` do endpoint tornaria a asserção de containment
    // flakey num banco de dev/teste com muitos itens 'disponivel' acumulados.
    const serial = `E2E-${Date.now()}`;

    // Material SEM cautela habilitada, mas COM rastreio individual (Cenário
    // A) — precisa ter material_items reais pra este teste fazer sentido
    // (senão o item nem existiria pra tentar cautelar).
    const createRes = await bff("POST", "/api/arsenal/requests", adminReservaToken, {
      type: "material_addition",
      nome,
      categoria: "acessorio",
      quantidade_total: 1,
      has_serial_numbers: true,
      items: [{ numero_serie: serial }],
    });
    expect(createRes.status).toBe(201);
    const requestId = createRes.data.request_id as string;
    const approveRes = await bff("PATCH", `/api/arsenal/requests/${requestId}/approve`, adminReservaToken, {});
    expect(approveRes.status).toBe(200);

    const { data: material } = await supabase
      .from("material_types").select("id").eq("nome", nome).single();
    const { data: item } = await supabase
      .from("material_items").select("id, current_unit_id").eq("material_type_id", material!.id).single();
    expect(item?.id).toBeTruthy();

    // CAUELIG07: autocomplete filtrado não deve trazer este item
    const listFiltered = await bff("GET", `/api/arsenal/items/disponiveis?for=cautela&q=${encodeURIComponent(serial)}`, adminReservaToken);
    expect(listFiltered.status).toBe(200);
    const idsFiltered = (listFiltered.data as Array<{ id: string }>).map((i) => i.id);
    expect(idsFiltered).not.toContain(item!.id);

    // CAUELIG09 (regressão): sem o parâmetro, o item aparece normalmente
    // (modal de Registrar Ocorrência não deve perder visibilidade dele)
    const listUnfiltered = await bff("GET", `/api/arsenal/items/disponiveis?q=${encodeURIComponent(serial)}`, adminReservaToken);
    expect(listUnfiltered.status).toBe(200);
    const idsUnfiltered = (listUnfiltered.data as Array<{ id: string }>).map((i) => i.id);
    expect(idsUnfiltered).toContain(item!.id);

    // CAUELIG08: mesmo manipulando o payload direto (bypass da UI/autocomplete),
    // o backend rejeita — fronteira de segurança real, não decoração de UI.
    // reserve_id vem do próprio item (current_unit_id), não de uma linha
    // arbitrária de `reserves` — achado real: `.limit(1)` sem filtro nessa
    // tabela pode pegar qualquer reserva do banco (inclusive de outro tenant
    // ou de dados de outra suíte), causando 404 de "militar não pertence à
    // reserva" em vez do 409 que este teste realmente quer verificar.
    const { data: militar } = await supabase.from("profiles").select("id").eq("matricula", USERS.efetivo.matricula).single();
    const cautelaRes = await bff("POST", "/api/cautelamentos", adminReservaToken, {
      item_id: item!.id,
      militar_id: militar!.id,
      reserve_id: item!.current_unit_id,
      motivo_emissao: "Teste E2E CAUELIG08 — não deveria ser aceito",
      condicao_emissao: "bom",
    });
    expect(cautelaRes.status).toBe(409);
    expect(String(cautelaRes.data.error ?? "")).toMatch(/n[ãa]o est[áa] habilitado para cautela/i);
  });

});

// ─── CAU-08: edição de elegibilidade/quantidade em material já cadastrado ──
// PATCH /api/arsenal/:id — até esta entrega, cautela_habilitada/
// quantidade_cautela só podiam ser decididos na criação do material.

test.describe("CAUELIG — Edição de elegibilidade em material já cadastrado (PATCH /api/arsenal/:id, CAU-08)", () => {

  async function createBulkMaterial(quantidadeTotal: number, cautela?: { habilitada: boolean; quantidade: number }) {
    const nome = uniqueMaterialName("EditCautela");
    const createRes = await bff("POST", "/api/arsenal/requests", adminReservaToken, {
      type: "material_addition",
      nome,
      categoria: "acessorio",
      quantidade_total: quantidadeTotal,
      ...(cautela ? { cautela_habilitada: cautela.habilitada, quantidade_cautela: cautela.quantidade } : {}),
    });
    expect(createRes.status).toBe(201);
    const approveRes = await bff("PATCH", `/api/arsenal/requests/${createRes.data.request_id}/approve`, adminReservaToken, {});
    expect(approveRes.status).toBe(200);
    const { data: material } = await sb().from("material_types").select("id").eq("nome", nome).single();
    return material!.id as string;
  }

  async function cautelarItem(materialTypeId: string) {
    const supabase = sb();
    // reserve_id vem do próprio item (current_unit_id) — não de uma linha
    // arbitrária de `reserves` via .limit(1), que pode pegar qualquer
    // reserva do banco de dev/teste e causar um 404 de "militar não pertence
    // à reserva" em vez do resultado que o teste realmente quer verificar
    // (mesmo achado do CAUELIG07/08 acima).
    const { data: item } = await supabase
      .from("material_items")
      .select("id, current_unit_id")
      .eq("material_type_id", materialTypeId)
      .eq("status_operacional", "disponivel")
      .limit(1)
      .single();
    const { data: militar } = await supabase.from("profiles").select("id").eq("matricula", USERS.efetivo.matricula).single();
    const res = await bff("POST", "/api/cautelamentos", adminReservaToken, {
      item_id: item!.id,
      militar_id: militar!.id,
      reserve_id: item!.current_unit_id,
      motivo_emissao: "Teste E2E CAU-08",
      condicao_emissao: "bom",
    });
    expect(res.status).toBe(201);
    return item!.id as string;
  }

  test("CAUELIG10 — desabilitar bloqueado (409) quando há item cautelado ativo", async () => {
    const materialId = await createBulkMaterial(10, { habilitada: true, quantidade: 2 });
    await cautelarItem(materialId);

    const patchRes = await bff("PATCH", `/api/arsenal/${materialId}`, adminReservaToken, { cautela_habilitada: false });
    expect(patchRes.status).toBe(409);
    expect(String(patchRes.data.error ?? "")).toMatch(/cust[óo]dia ativa|cautelado/i);

    const { data: material } = await sb().from("material_types").select("cautela_habilitada").eq("id", materialId).single();
    expect(material?.cautela_habilitada).toBe(true);
  });

  test("CAUELIG11 — desabilitar sem cautelas ativas: sucesso, remove itens sintéticos", async () => {
    const materialId = await createBulkMaterial(10, { habilitada: true, quantidade: 3 });

    const patchRes = await bff("PATCH", `/api/arsenal/${materialId}`, adminReservaToken, { cautela_habilitada: false });
    expect(patchRes.status).toBe(200);

    const { data: material } = await sb().from("material_types").select("cautela_habilitada, quantidade_cautela").eq("id", materialId).single();
    expect(material?.cautela_habilitada).toBe(false);
    expect(material?.quantidade_cautela).toBe(0);

    const { count } = await sb().from("material_items").select("id", { count: "exact", head: true }).eq("material_type_id", materialId);
    expect(count).toBe(0);
  });

  test("CAUELIG-EDIT-ENABLE — habilitar cautela via PATCH em material sem cautela cria N itens sintéticos", async () => {
    const materialId = await createBulkMaterial(10);

    const patchRes = await bff("PATCH", `/api/arsenal/${materialId}`, adminReservaToken, {
      cautela_habilitada: true,
      quantidade_cautela: 4,
    });
    expect(patchRes.status).toBe(200);

    const { data: material } = await sb().from("material_types").select("cautela_habilitada, quantidade_cautela").eq("id", materialId).single();
    expect(material?.cautela_habilitada).toBe(true);
    expect(material?.quantidade_cautela).toBe(4);

    const { count } = await sb().from("material_items").select("id", { count: "exact", head: true }).eq("material_type_id", materialId);
    expect(count).toBe(4);
  });

  test("CAUELIG-EDIT-QTY — aumentar e reduzir quantidade_cautela ajusta itens, bloqueando redução sem unidades disponíveis suficientes", async () => {
    const materialId = await createBulkMaterial(10, { habilitada: true, quantidade: 4 });

    const increaseRes = await bff("PATCH", `/api/arsenal/${materialId}`, adminReservaToken, {
      cautela_habilitada: true,
      quantidade_cautela: 6,
    });
    expect(increaseRes.status).toBe(200);
    const { count: countAfterIncrease } = await sb().from("material_items").select("id", { count: "exact", head: true }).eq("material_type_id", materialId);
    expect(countAfterIncrease).toBe(6);

    // Cauteloa 5 das 6 unidades — sobra só 1 'disponivel' pra remover.
    for (let i = 0; i < 5; i++) {
      await cautelarItem(materialId);
    }

    const blockedRes = await bff("PATCH", `/api/arsenal/${materialId}`, adminReservaToken, {
      cautela_habilitada: true,
      quantidade_cautela: 2, // precisaria remover 4, só 1 disponível
    });
    expect(blockedRes.status).toBe(409);
    expect(String(blockedRes.data.error ?? "")).toMatch(/n[ãa]o [ée] poss[íi]vel reduzir/i);

    const okRes = await bff("PATCH", `/api/arsenal/${materialId}`, adminReservaToken, {
      cautela_habilitada: true,
      quantidade_cautela: 5, // remove só 1 — exatamente o disponível
    });
    expect(okRes.status).toBe(200);
    const { data: material } = await sb().from("material_types").select("quantidade_cautela").eq("id", materialId).single();
    expect(material?.quantidade_cautela).toBe(5);
  });

  test("CAUELIG-EDIT-SCENARIO-A — habilitar/desabilitar em material com número de série não cria nem remove material_items", async () => {
    const nome = uniqueMaterialName("EditCautelaSerial");
    const createRes = await bff("POST", "/api/arsenal/requests", adminReservaToken, {
      type: "material_addition",
      nome,
      categoria: "acessorio",
      quantidade_total: 1,
      has_serial_numbers: true,
      items: [{ numero_serie: `E2E-EDIT-${Date.now()}` }],
    });
    expect(createRes.status).toBe(201);
    const approveRes = await bff("PATCH", `/api/arsenal/requests/${createRes.data.request_id}/approve`, adminReservaToken, {});
    expect(approveRes.status).toBe(200);
    const { data: material } = await sb().from("material_types").select("id").eq("nome", nome).single();
    const materialId = material!.id as string;

    const enableRes = await bff("PATCH", `/api/arsenal/${materialId}`, adminReservaToken, { cautela_habilitada: true });
    expect(enableRes.status).toBe(200);
    const { data: afterEnable } = await sb().from("material_types").select("cautela_habilitada, quantidade_cautela").eq("id", materialId).single();
    expect(afterEnable?.cautela_habilitada).toBe(true);
    expect(afterEnable?.quantidade_cautela).toBe(1);

    const disableRes = await bff("PATCH", `/api/arsenal/${materialId}`, adminReservaToken, { cautela_habilitada: false });
    expect(disableRes.status).toBe(200);

    const { count } = await sb().from("material_items").select("id", { count: "exact", head: true }).eq("material_type_id", materialId);
    expect(count).toBe(1); // item real nunca é criado/removido por este toggle
  });

});

// ─── UI (CAU-03): comportamento condicional do checkbox no formulário ─────────
// Só verifica renderização/estado local do form (não submete) — a
// persistência real já é coberta pelos testes de API acima (CAUELIG05/06).

test.describe("CAUELIG — UI do formulário de material (CAU-03)", () => {

  test("CAUELIG02 — marcar 'Disponibilizar para cautela' em material SEM número de série exibe campo de quantidade", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Adicionar Material" }).click();
    const checkbox = page.getByTestId("material-cautela-habilitada");
    await expect(checkbox).not.toBeChecked();
    await expect(page.getByTestId("material-cautela-quantidade")).not.toBeVisible();

    await checkbox.check();
    await expect(page.getByTestId("material-cautela-quantidade")).toBeVisible();
  });

  test("CAUELIG03 — marcar 'Disponibilizar para cautela' em material COM número de série mostra texto informativo, não o campo de quantidade", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: "Adicionar Material" }).click();
    await page.getByText("Controlar numero de serie").click();

    await page.getByTestId("material-cautela-habilitada").check();
    await expect(page.getByTestId("material-cautela-quantidade")).not.toBeVisible();
    await expect(page.getByText(/unidade\(s\) cadastrada\(s\) ficar[ãa]o dispon[íi]veis para cautela/i)).toBeVisible();
  });

});
