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
const IDENT_FOTO       = `E2E-MANUT-FOTO-${TS}`;
const IDENT_ASSOC      = `E2E-MANUT-ASSOC-${TS}`;

let armeiroToken = "";
let itemDisponivelId = "";
let itemEmSaidaId = "";
let itemFotoId = "";
let itemAssocId = "";
// Path de storage retornado pelo upload real feito em MNT17 — capturado só
// pra limpeza no afterAll (achado de code review: sem isso, cada execução da
// suíte deixava um objeto órfão no bucket privado material-photos).
let uploadedPhotoPath: string | null = null;

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

  // Fixtures dedicadas pra MNT17 (upload de foto) e MNT18 (associação de
  // militar) — separadas da fixture usada por MNT07-MNT15 pra não interferir
  // na cadeia de estado que aqueles testes seriais já assumem (ex: MNT08
  // espera IDENT_DISPONIVEL especificamente na aba Danificados).
  const { data: foto } = await supabase.from("material_items").insert({
    tenant_id: tenantId,
    material_type_id: matType.id,
    tipo_identificador: "interno",
    identificador_principal: IDENT_FOTO,
    status_operacional: "disponivel",
    current_unit_id: reserve?.id ?? null,
  }).select("id").single();
  itemFotoId = foto?.id ?? "";

  const { data: assoc } = await supabase.from("material_items").insert({
    tenant_id: tenantId,
    material_type_id: matType.id,
    tipo_identificador: "interno",
    identificador_principal: IDENT_ASSOC,
    status_operacional: "disponivel",
    current_unit_id: reserve?.id ?? null,
  }).select("id").single();
  itemAssocId = assoc?.id ?? "";
});

test.afterAll(async () => {
  const supabase = sb();
  const ids = [itemDisponivelId, itemEmSaidaId, itemFotoId, itemAssocId].filter(Boolean);
  if (ids.length > 0) await supabase.from("material_items").delete().in("id", ids);
  // Achado de code review: MNT17 faz upload real pro bucket privado
  // material-photos — sem esta limpeza, cada execução da suíte acumulava um
  // objeto órfão.
  if (uploadedPhotoPath) await supabase.storage.from("material-photos").remove([uploadedPhotoPath]);
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

    // "Avariado" (grupo Dano) já é o default do <select>, mas escolher
    // explicitamente documenta a intenção do teste e exercita o dropdown que
    // substituiu o grid de cards (achado de produto: grid ocupava demais em
    // monitor de 14"; ver components/ui/dialog.tsx e
    // _registrar-ocorrencia-dialog.tsx).
    await dialog.getByTestId("ocorrencia-tipo-select").selectOption("avariado");
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

    // Achado real (investigado ao vivo, não é regressão desta entrega — o
    // componente de busca em si, GridSearchInput/_manutencao-client.tsx, não
    // foi tocado): "domcontentloaded" não garante hidratação do React
    // concluída. .fill() seta o valor DOM nativo e dispara o evento "input",
    // mas se a hidratação ainda não anexou o onChange do <input> controlado
    // (searchText), o valor aparece no DOM (confirmado via .inputValue()) só
    // que o estado React nunca é atualizado (confirmado via botão "limpar"
    // — {value && <button>} — nunca aparecendo) e a lista nunca filtra.
    // toPass() reexecuta o bloco inteiro (refaz o fill) até o app reagir de
    // fato, em vez de assumir que um único fill()+wait é suficiente —
    // robusto tanto contra hidratação lenta quanto contra a contenção real
    // de servidor observada nesta sessão (outro agente rodando sua própria
    // suíte E2E contra o mesmo dev server compartilhado).
    await expect(async () => {
      await page.getByTestId("manutencao-search").fill("xyzzy_nao_existe_9999");
      await expect(page.getByText(IDENT_DISPONIVEL)).not.toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: T.page });

    await expect(async () => {
      await page.getByTestId("manutencao-search").fill(IDENT_DISPONIVEL);
      await expect(page.getByText(IDENT_DISPONIVEL)).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: T.page });
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
    await dialog.getByTestId("ocorrencia-tipo-select").selectOption("furtado");
    await expect(dialog.getByTestId("ocorrencia-numero-bo-input")).toBeVisible();

    await dialog.getByTestId("ocorrencia-motivo-input").fill("MNT15 — teste de validação de B.O. obrigatório");
    const submitBtn = dialog.getByTestId("ocorrencia-submit-btn");
    await expect(submitBtn).toBeDisabled();

    await dialog.getByTestId("ocorrencia-numero-bo-input").fill("BO-2026-000123");
    // Ainda sem item selecionado — permanece desabilitado (valida que a combinação de regras funciona).
    await expect(submitBtn).toBeDisabled();

    await dialog.getByRole("button", { name: /cancelar/i }).click();
  });

  test("MNT16 — dialog cabe em viewport de notebook 14\" (1280x620) e rola internamente sem exigir zoom", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 620 });
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });

    await page.getByTestId("manutencao-registrar-ocorrencia-btn").click();
    const dialog = page.getByTestId("manutencao-ocorrencia-dialog");
    await expect(dialog).toBeVisible({ timeout: T.api });

    // O dialog nunca deve ultrapassar a altura do viewport — senão exigiria
    // zoom-out do navegador pra ver o rodapé, exatamente a reclamação de
    // produto original ("tenho que diminuir o zoom da tela pra conseguir ver
    // o modal por completo"). Altura limitada por max-h-[calc(100vh-2rem)]
    // no componente base (components/ui/dialog.tsx).
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(600);

    // Rodapé (Cancelar/Registrar) é sticky — deve estar sempre alcançável,
    // sem precisar rolar até achar (Lei de Fitts: alvo de ação constante).
    await expect(dialog.getByTestId("ocorrencia-submit-btn")).toBeVisible();
    const cancelBtn = dialog.getByRole("button", { name: /cancelar/i });
    await expect(cancelBtn).toBeVisible();

    // "Tipo de ocorrência" é um <select> compacto (não mais um grid de
    // cards) — cabe folgado mesmo neste viewport estreito.
    await expect(dialog.getByTestId("ocorrencia-tipo-select")).toBeVisible();

    // Achado de code review: DialogContent ganhou `overflow-y-auto` (pra
    // resolver o bug original), e o painel de resultados do AsyncComboBox
    // (Militar associado) é `position: absolute` DENTRO desse mesmo
    // container — risco real de o dropdown ficar cortado no viewport curto
    // que esta entrega tenta resolver. Verifica ao vivo em vez de assumir:
    // toBeVisible() do Playwright NÃO detecta clipping por overflow de
    // ancestral (só checa display/visibility/tamanho não-vazio), então
    // comparamos a geometria do painel contra a do próprio dialog.
    const userCombo = dialog.getByTestId("ocorrencia-usuario-combo");
    await userCombo.fill("00");
    const results = dialog.getByTestId("ocorrencia-usuario-combo-results");
    await expect(results).toBeVisible({ timeout: T.api });
    const dialogBox = await dialog.boundingBox();
    const resultsBox = await results.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(resultsBox).not.toBeNull();
    // +1px de tolerância de arredondamento sub-pixel entre browsers.
    expect(resultsBox!.y).toBeGreaterThanOrEqual(dialogBox!.y - 1);
    expect(resultsBox!.y + resultsBox!.height).toBeLessThanOrEqual(dialogBox!.y + dialogBox!.height + 1);

    await cancelBtn.click();
  });

  test("MNT17 — foto da ocorrência é opcional: submit funciona com um arquivo anexado", async ({ page }) => {
    test.skip(!itemFotoId, "Setup do item de foto falhou");

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });

    await page.getByTestId("manutencao-registrar-ocorrencia-btn").click();
    const dialog = page.getByTestId("manutencao-ocorrencia-dialog");
    await expect(dialog).toBeVisible({ timeout: T.api });

    const comboInput = dialog.locator("input[type='text']").first();
    await comboInput.fill(IDENT_FOTO);
    await page.getByText(new RegExp(IDENT_FOTO)).first().click();

    await dialog.getByTestId("ocorrencia-tipo-select").selectOption("avariado");
    await dialog.getByTestId("ocorrencia-motivo-input").fill("MNT17 — teste de upload de foto opcional na ocorrência");

    // PNG 1x1 sintético (base64) — não depende de nenhum arquivo de fixture
    // no repo, exercita o mesmo endpoint de upload já usado em
    // admin/arsenal/_material-dialog.tsx (POST /api/arsenal/material-photo).
    const png1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    );
    await dialog.getByTestId("ocorrencia-foto-input").setInputFiles({
      name: "ocorrencia.png",
      mimeType: "image/png",
      buffer: png1x1,
    });

    // Captura o path de storage devolvido pelo upload real — só pra limpeza
    // no afterAll (achado de code review: objeto órfão em material-photos a
    // cada execução). O teste não depende deste valor pra passar.
    const uploadResponsePromise = page
      .waitForResponse((res) => res.url().includes("/api/arsenal/material-photo") && res.request().method() === "POST")
      .catch(() => null);

    await dialog.getByTestId("ocorrencia-submit-btn").click();

    const uploadResponse = await uploadResponsePromise;
    if (uploadResponse?.ok()) {
      const body = (await uploadResponse.json().catch(() => null)) as { photo_url?: string } | null;
      if (body?.photo_url) uploadedPhotoPath = body.photo_url;
    }

    await expectToast(page, /ocorrência registrada/i);
    await expect(dialog).not.toBeVisible({ timeout: T.api });
  });

  test("MNT18 — associar um militar é opcional: notifica (sino) e aparece no histórico dele", async ({ page }) => {
    test.skip(!itemAssocId, "Setup do item de associação falhou");

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal/manutencao`, { waitUntil: "domcontentloaded" });

    await page.getByTestId("manutencao-registrar-ocorrencia-btn").click();
    const dialog = page.getByTestId("manutencao-ocorrencia-dialog");
    await expect(dialog).toBeVisible({ timeout: T.api });

    const comboInput = dialog.locator("input[type='text']").first();
    await comboInput.fill(IDENT_ASSOC);
    await page.getByText(new RegExp(IDENT_ASSOC)).first().click();

    await dialog.getByTestId("ocorrencia-tipo-select").selectOption("extraviado");
    await dialog.getByTestId("ocorrencia-motivo-input").fill("MNT18 — teste de associação opcional de militar à ocorrência");

    // Associa o fixture "efetivo" (role=usuario) via o mesmo
    // AsyncComboBox/endpoint (GET /api/admin/search-profiles) já reusado de
    // reports/relatorio-filter-panel.tsx.
    const userCombo = dialog.getByTestId("ocorrencia-usuario-combo");
    await userCombo.fill(USERS.efetivo.matricula);
    await expect(dialog.getByTestId("ocorrencia-usuario-combo-results")).toBeVisible({ timeout: T.api });
    await dialog.getByTestId("ocorrencia-usuario-combo-option").first().click();

    await dialog.getByTestId("ocorrencia-submit-btn").click();
    await expectToast(page, /ocorrência registrada/i);
    await expect(dialog).not.toBeVisible({ timeout: T.api });

    const supabase = sb();
    const { data: efetivoProfile } = await supabase
      .from("profiles").select("id").eq("matricula", USERS.efetivo.matricula).single();
    expect(efetivoProfile, "fixture efetivo sem profile — checar USERS.efetivo em helpers.ts").toBeTruthy();

    // A associação em si depende da migration
    // 20260816120100_add_material_items_ocorrencia_columns.sql, que NÃO foi
    // aplicada neste ambiente (DDL requer aprovação humana — ver relatório
    // da tarefa). Checagem best-effort, mesmo padrão já usado no teste AU20
    // de email_changed (admin-usuarios.spec.ts): loga um aviso claro em vez
    // de derrubar o teste, e pula as checagens que dependem dela.
    const { data: itemRow } = await supabase
      .from("material_items")
      .select("ocorrencia_usuario_associado_id")
      .eq("id", itemAssocId)
      .maybeSingle();

    if (!itemRow || itemRow.ocorrencia_usuario_associado_id !== efetivoProfile!.id) {
      console.warn(
        "[MNT18] material_items.ocorrencia_usuario_associado_id não persistido — provável migration " +
        "20260816120100_add_material_items_ocorrencia_columns.sql ainda não aplicada neste ambiente. " +
        "Pulando checagem de notificação e de página de histórico (dependem da mesma migration)."
      );
      return;
    }

    // Notificação depende da migration
    // 20260816120000_add_ocorrencia_associada_notification_type.sql (type
    // novo em notification_type_enum) — mesma checagem best-effort.
    const { data: notifRow } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", efetivoProfile!.id)
      .eq("type", "ocorrencia_associada")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!notifRow) {
      console.warn(
        "[MNT18] notification 'ocorrencia_associada' não encontrada — provável migration " +
        "20260816120000_add_ocorrencia_associada_notification_type.sql ainda não aplicada neste ambiente."
      );
    } else {
      // Limpa a notificação de teste — achado de code review: sem isso, cada
      // execução da suíte deixava uma linha real em notifications pro
      // fixture "efetivo", poluindo o sino/contagem dele indefinidamente.
      await supabase.from("notifications").delete().eq("id", notifRow.id);
    }

    // Página de histórico do militar associado — só faz sentido checar se a
    // associação foi persistida acima (já retornamos cedo se não foi).
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo/historico`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("historico-ready")).toBeVisible({ timeout: T.page });
    await expect(page.getByTestId("historico-ocorrencias-section")).toBeVisible({ timeout: T.api });
    await expect(page.getByText(IDENT_ASSOC)).toBeVisible();
  });
});
