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
 *
 * IMPORTANTE: esta suíte depende da migration
 * supabase/migrations/20260818100000_cautela_eligibility_quantity.sql, que
 * precisa ser aplicada manualmente no Supabase Dashboard (este projeto não
 * tem CLI/push automatizado pra DDL). Antes da migration aplicada, todo
 * teste aqui falha com "column material_types.cautela_habilitada does not
 * exist" — comportamento esperado, não um bug desta suíte.
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

    // Material SEM cautela habilitada, mas COM rastreio individual (Cenário
    // A) — precisa ter material_items reais pra este teste fazer sentido
    // (senão o item nem existiria pra tentar cautelar).
    const createRes = await bff("POST", "/api/arsenal/requests", adminReservaToken, {
      type: "material_addition",
      nome,
      categoria: "acessorio",
      quantidade_total: 1,
      has_serial_numbers: true,
      items: [{ numero_serie: `E2E-${Date.now()}` }],
    });
    expect(createRes.status).toBe(201);
    const requestId = createRes.data.request_id as string;
    const approveRes = await bff("PATCH", `/api/arsenal/requests/${requestId}/approve`, adminReservaToken, {});
    expect(approveRes.status).toBe(200);

    const { data: material } = await supabase
      .from("material_types").select("id").eq("nome", nome).single();
    const { data: item } = await supabase
      .from("material_items").select("id").eq("material_type_id", material!.id).single();
    expect(item?.id).toBeTruthy();

    // CAUELIG07: autocomplete filtrado não deve trazer este item
    const listFiltered = await bff("GET", `/api/arsenal/items/disponiveis?for=cautela&q=${encodeURIComponent(nome.slice(0, 20))}`, adminReservaToken);
    expect(listFiltered.status).toBe(200);
    const idsFiltered = (listFiltered.data as Array<{ id: string }>).map((i) => i.id);
    expect(idsFiltered).not.toContain(item!.id);

    // CAUELIG09 (regressão): sem o parâmetro, o item aparece normalmente
    // (modal de Registrar Ocorrência não deve perder visibilidade dele)
    const listUnfiltered = await bff("GET", `/api/arsenal/items/disponiveis?q=${encodeURIComponent(nome.slice(0, 20))}`, adminReservaToken);
    expect(listUnfiltered.status).toBe(200);
    const idsUnfiltered = (listUnfiltered.data as Array<{ id: string }>).map((i) => i.id);
    expect(idsUnfiltered).toContain(item!.id);

    // CAUELIG08: mesmo manipulando o payload direto (bypass da UI/autocomplete),
    // o backend rejeita — fronteira de segurança real, não decoração de UI.
    const { data: reserve } = await supabase.from("reserves").select("id").limit(1).single();
    const { data: militar } = await supabase.from("profiles").select("id").eq("matricula", USERS.efetivo.matricula).single();
    const cautelaRes = await bff("POST", "/api/cautelamentos", adminReservaToken, {
      item_id: item!.id,
      militar_id: militar!.id,
      reserve_id: reserve!.id,
      motivo_emissao: "Teste E2E CAUELIG08 — não deveria ser aceito",
      condicao_emissao: "bom",
    });
    expect(cautelaRes.status).toBe(409);
    expect(String(cautelaRes.data.error ?? "")).toMatch(/n[ãa]o est[áa] habilitado para cautela/i);
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
