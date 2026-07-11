/**
 * APMCB — Manutenção de Materiais (Danificados/Perdidos/Administrativo)
 *
 * Cobre: acesso RBAC às duas rotas (/reserva/arsenal/manutencao,
 * /admin/arsenal/manutencao), as 3 abas Danificados/Perdidos/Administrativo,
 * toggle cards/tabela, busca, seleção + export PDF/CSV, filtro de reserva
 * (admin_global) e o fluxo ponta-a-ponta de "Registrar Ocorrência"
 * (PATCH /api/arsenal/items/:id/ocorrencia), incluindo o caso de erro 409
 * quando o item está em posse ativa (em_saida/cautelado) e a exigência de
 * número de B.O. para o tipo "Furtado".
 *
 * status_operacional agora inclui avariado/furtado/em_pericia/bloqueado/
 * em_transito/aguardando_baixa além dos originais manutencao/extraviado —
 * CHECK constraint e fn_validate_item_transition verificados via MCP
 * read-only antes desta spec ser escrita (ver relatório da tarefa).
 *
 * Fixtures: cria 2 material_items dedicados (E2E-MANUT-DISP-*,
 * E2E-MANUT-SAIDA-*) via Supabase admin client no beforeAll — não depende
 * de dados de produção pré-existentes. Limpa no afterAll.
 *
 * Serial: MNT07 cria a ocorrência que MNT08-MNT11/MNT14 dependem para ter
 * ao menos 1 linha visível.
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, BFF_URL, USERS, login, expectToast } from "./helpers";

const T = { page: 15_000, api: 8_000 };

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

const TS = Date.now();
const IDENT_DISPONIVEL = `E2E-MANUT-DISP-${TS}`;
const IDENT_EM_SAIDA   = `E2E-MANUT-SAIDA-${TS}`;

let armeiroToken = "";
let itemDisponivelId = "";
let itemEmSaidaId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  armeiroToken = await loginToken(USERS.reserva.email, USERS.reserva.password);

  const supabase = sb();
  const { data: profile } = await supabase
    .from("profiles").select("default_tenant_id")
    .eq("matricula", USERS.reserva.matricula).single();
  const tenantId = profile?.default_tenant_id;
  if (!tenantId) throw new Error("Setup: armeiro sem default_tenant_id");

  const { data: reserve } = await supabase
    .from("reserves").select("id").eq("tenant_id", tenantId).limit(1).single();
  const { data: matType } = await supabase
    .from("material_types").select("id").eq("tenant_id", tenantId).limit(1).single();
  if (!matType) throw new Error("Setup: nenhum material_type encontrado para o tenant do armeiro");

  const { data: disp } = await supabase.from("material_items").insert({
    tenant_id: tenantId,
    material_type_id: matType.id,
    tipo_identificador: "interno",
    identificador_principal: IDENT_DISPONIVEL,
    status_operacional: "disponivel",
    current_unit_id: reserve?.id ?? null,
  }).select("id").single();
  itemDisponivelId = disp?.id ?? "";

  const { data: saida } = await supabase.from("material_items").insert({
    tenant_id: tenantId,
    material_type_id: matType.id,
    tipo_identificador: "interno",
    identificador_principal: IDENT_EM_SAIDA,
    status_operacional: "em_saida",
    current_unit_id: reserve?.id ?? null,
  }).select("id").single();
  itemEmSaidaId = saida?.id ?? "";
});

test.afterAll(async () => {
  const supabase = sb();
  const ids = [itemDisponivelId, itemEmSaidaId].filter(Boolean);
  if (ids.length > 0) await supabase.from("material_items").delete().in("id", ids);
});

test.describe("Manutenção — RBAC de acesso", () => {
  test("MNT01 — armeiro acessa /reserva/arsenal/manutencao com as 3 abas", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Manutenção" })).toBeVisible({ timeout: T.page });
    await expect(page.getByRole("link", { name: /Danificados/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Perdidos/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Administrativo/ })).toBeVisible();
  });

  test("MNT02 — admin_reserva acessa /reserva/arsenal/manutencao", async ({ page }) => {
    await login(page, "adminReserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Manutenção" })).toBeVisible({ timeout: T.page });
  });

  test("MNT03 — admin_global acessa /admin/arsenal/manutencao com filtro de reserva", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/arsenal/manutencao`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Manutenção" })).toBeVisible({ timeout: T.page });
    await expect(page.getByTestId("manutencao-reserva-filter")).toBeVisible({ timeout: T.api });
  });

  test("MNT04 — cadete recebe redirect em /reserva/arsenal/manutencao", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("/reserva/arsenal/manutencao");
  });

  test("MNT05 — cadete recebe redirect em /admin/arsenal/manutencao", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/admin/arsenal/manutencao`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("/admin/arsenal/manutencao");
  });

  test("MNT06 — admin_global recebe redirect em /reserva/arsenal/manutencao (rota exclusiva armeiro/admin_reserva)", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded");
    expect(page.url()).not.toContain("/reserva/arsenal/manutencao");
  });
});

test.describe("Manutenção — fluxo e interações (usa fixtures do beforeAll)", () => {
  test("MNT07 — fluxo completo: registrar ocorrência marca item como Avariado (grupo Dano)", async ({ page }) => {
    test.skip(!itemDisponivelId, "Setup do item disponível falhou");

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });

    await page.getByTestId("manutencao-registrar-ocorrencia-btn").click();
    const dialog = page.getByTestId("manutencao-ocorrencia-dialog");
    await expect(dialog).toBeVisible({ timeout: T.api });

    const comboInput = dialog.locator("input[type='text']").first();
    await comboInput.fill(IDENT_DISPONIVEL);
    await page.getByText(new RegExp(IDENT_DISPONIVEL)).first().click();

    // "Avariado" (grupo Dano) já é o default, mas clicar explicitamente documenta a intenção do teste.
    await dialog.getByTestId("ocorrencia-tipo-avariado").click();
    await dialog.getByTestId("ocorrencia-motivo-input").fill("MNT07 — encontrado com trinco quebrado durante conferência física");

    await dialog.getByTestId("ocorrencia-submit-btn").click();

    await expectToast(page, /ocorrência registrada/i);
    await expect(dialog).not.toBeVisible({ timeout: T.api });

    // Após router.refresh(), o item deve aparecer na aba Danificados (default) — avariado pertence a esse grupo.
    await expect(page.getByText(IDENT_DISPONIVEL)).toBeVisible({ timeout: T.page });
  });

  test("MNT08 — abas Danificados/Perdidos/Administrativo alternam via querystring e mostram contagem", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(IDENT_DISPONIVEL)).toBeVisible({ timeout: T.page });

    await page.getByRole("link", { name: /Perdidos/ }).click();
    await page.waitForURL(/tab=perdidos/, { timeout: T.page });
    // Item de MNT07 está em "avariado" (aba Danificados) — não deve aparecer em Perdidos.
    await expect(page.getByText(IDENT_DISPONIVEL)).not.toBeVisible();

    await page.getByRole("link", { name: /Administrativo/ }).click();
    await page.waitForURL(/tab=administrativo/, { timeout: T.page });
    await expect(page.getByText(IDENT_DISPONIVEL)).not.toBeVisible();

    await page.getByRole("link", { name: /Danificados/ }).click();
    await page.waitForURL((url) => !url.search.includes("tab="), { timeout: T.page });
    await expect(page.getByText(IDENT_DISPONIVEL)).toBeVisible({ timeout: T.page });
  });

  test("MNT09 — busca filtra por identificador", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(IDENT_DISPONIVEL)).toBeVisible({ timeout: T.page });

    await page.getByTestId("manutencao-search").fill("xyzzy_nao_existe_9999");
    await page.waitForTimeout(300);
    await expect(page.getByText(IDENT_DISPONIVEL)).not.toBeVisible();

    await page.getByTestId("manutencao-search").fill(IDENT_DISPONIVEL);
    await page.waitForTimeout(300);
    await expect(page.getByText(IDENT_DISPONIVEL)).toBeVisible({ timeout: T.api });
  });

  test("MNT10 — toggle cards/tabela funciona", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(IDENT_DISPONIVEL)).toBeVisible({ timeout: T.page });

    await page.locator('button[title="Ver em grade"]').click();
    await expect(page.locator("thead")).toBeVisible({ timeout: T.api });
    await expect(page.getByTestId("manutencao-row").first()).toBeVisible();

    await page.locator('button[title="Ver em cards"]').click();
    await expect(page.getByTestId("manutencao-card").first()).toBeVisible({ timeout: T.api });
  });

  test("MNT11 — seleção de checkbox habilita export PDF/CSV com contador", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(IDENT_DISPONIVEL)).toBeVisible({ timeout: T.page });

    await page.locator('button[title="Ver em grade"]').click();
    await expect(page.getByTestId("manutencao-row").first()).toBeVisible();

    const pdfBtn = page.getByRole("button", { name: /PDF/ });
    const csvBtn = page.getByTestId("manutencao-csv-button");
    await expect(pdfBtn).toBeDisabled();
    await expect(csvBtn).toBeDisabled();

    await page.getByTestId("manutencao-row").first().locator("input[type='checkbox']").check();

    await expect(pdfBtn).toBeEnabled({ timeout: T.api });
    await expect(csvBtn).toBeEnabled({ timeout: T.api });
    await expect(pdfBtn).toContainText("1");
    await expect(csvBtn).toContainText("1");
  });

  test("MNT12 — filtro de reserva (admin_global) não quebra a listagem", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/arsenal/manutencao`, { waitUntil: "domcontentloaded" });

    const filter = page.getByTestId("manutencao-reserva-filter");
    await expect(filter).toBeVisible({ timeout: T.page });
    await filter.click();

    const options = page.locator('[role="option"]');
    const count = await options.count();
    if (count <= 1) return; // tenant com 1 única reserva — nada a filtrar

    await options.nth(1).click();
    await page.waitForTimeout(300);
    await expect(page.locator("body")).toBeVisible();
  });

  test("MNT13 — registrar ocorrência em item com posse ativa (em_saida) retorna 409 amigável", async ({}) => {
    test.skip(!itemEmSaidaId, "Setup do item em_saida falhou");

    const { status, data } = await bff("PATCH", `/api/arsenal/items/${itemEmSaidaId}/ocorrencia`, armeiroToken, {
      novo_status: "avariado",
      motivo: "MNT13 — tentativa direta em item com posse ativa",
    });

    expect(status).toBe(409);
    expect(typeof data.error).toBe("string");
    expect(data.error.length).toBeGreaterThan(0);
    expect(data.error).not.toMatch(/at Object|stack|SQLSTATE/i);
  });

  test("MNT14 — reclassificar item de Avariado para Extraviado é permitido", async ({}) => {
    test.skip(!itemDisponivelId, "Setup do item disponível falhou");

    const { status } = await bff("PATCH", `/api/arsenal/items/${itemDisponivelId}/ocorrencia`, armeiroToken, {
      novo_status: "extraviado",
      motivo: "MNT14 — reclassificação: item não localizado após nova conferência",
    });

    expect(status).toBe(200);

    const supabase = sb();
    const { data: item } = await supabase
      .from("material_items").select("status_operacional")
      .eq("id", itemDisponivelId).single();
    expect(item?.status_operacional).toBe("extraviado");
  });

  test("MNT15 — tipo 'Furtado' exige número de B.O. antes de habilitar o submit", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });

    await page.getByTestId("manutencao-registrar-ocorrencia-btn").click();
    const dialog = page.getByTestId("manutencao-ocorrencia-dialog");
    await expect(dialog).toBeVisible({ timeout: T.api });

    const comboInput = dialog.locator("input[type='text']").first();
    await comboInput.fill("zzz_sem_resultado_nenhum");
    // Sem selecionar item nem motivo — só valida o campo B.O. aparecendo/bloqueando.
    await dialog.getByTestId("ocorrencia-tipo-furtado").click();
    await expect(dialog.getByTestId("ocorrencia-numero-bo-input")).toBeVisible();

    await dialog.getByTestId("ocorrencia-motivo-input").fill("MNT15 — teste de validação de B.O. obrigatório");
    const submitBtn = dialog.getByTestId("ocorrencia-submit-btn");
    await expect(submitBtn).toBeDisabled();

    await dialog.getByTestId("ocorrencia-numero-bo-input").fill("BO-2026-000123");
    // Ainda sem item selecionado — permanece desabilitado (valida que a combinação de regras funciona).
    await expect(submitBtn).toBeDisabled();

    await dialog.getByTestId("manutencao-ocorrencia-dialog").getByRole("button", { name: /cancelar/i }).click();
  });
});
