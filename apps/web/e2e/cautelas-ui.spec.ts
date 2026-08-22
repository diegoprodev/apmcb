/**
 * Cautelas — UX: busca avançada + alternância grade/lista
 * Ver docs: achado do usuário (2026-08-21) — /reserva/cautelas não tinha
 * busca nem alternância de visualização, ao contrário de outras páginas
 * (ex: /reserva/arsenal). Mesmo padrão (GridSearchInput + useGridState +
 * toggle grade/lista) replicado aqui.
 *
 * CAUUI01 — busca, toggle de view e navegação estão visíveis
 * CAUUI02 — busca filtra a lista (nenhum resultado pra termo inexistente)
 * CAUUI03 — alternar pra lista mantém a mesma contagem de linhas e a
 *           tabela rola horizontalmente sem cortar a coluna de ações
 * CAUUI05 — modal "Nova Cautela" com múltiplos materiais: adiciona uma
 *           segunda linha, exclusão cruzada de item já escolhido, submete
 *           em lote e o badge "Lote de 2" aparece na grade (achado de code
 *           review: a feature de cautela em lote não tinha NENHUM teste
 *           E2E de UI — só testes de API direta contra o BFF).
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, BFF_URL, USERS, login } from "./harness";

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

function uniqueMaterialName(prefix: string) {
  return `E2E CautelaBatchUI ${prefix} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

/** Cria N material_types sintéticos, cada um com 1 item elegível pra
 * cautela — via o fluxo real de aprovação (nunca muta linhas
 * pré-existentes reais, mesmo cuidado de cautelamentos-batch.spec.ts). */
async function seedEligibleItems(adminToken: string, count: number): Promise<string[]> {
  const supabase = sb();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const nome = uniqueMaterialName(`Item${i}`);
    const createRes = await bff("POST", "/api/arsenal/requests", adminToken, {
      type: "material_addition", nome, categoria: "acessorio",
      quantidade_total: 1, cautela_habilitada: true, quantidade_cautela: 1,
    });
    if (createRes.status !== 201) throw new Error(`seedEligibleItems: falha ao criar (${createRes.status}): ${JSON.stringify(createRes.data)}`);
    const approveRes = await bff("PATCH", `/api/arsenal/requests/${createRes.data.request_id}/approve`, adminToken, {});
    if (approveRes.status !== 200) throw new Error(`seedEligibleItems: falha ao aprovar (${approveRes.status}): ${JSON.stringify(approveRes.data)}`);
    const { data: material } = await supabase.from("material_types").select("id").eq("nome", nome).single();
    const { data: item } = await supabase.from("material_items").select("id")
      .eq("material_type_id", material!.id).eq("status_operacional", "disponivel").single();
    ids.push(item!.id);
  }
  return ids;
}

test.describe("Cautelas — busca e alternância grade/lista", () => {

  test("CAUUI01 — busca e toggle de visualização visíveis", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("cautelas-search")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("cautelas-view-grade")).toBeVisible();
    await expect(page.getByTestId("cautelas-view-lista")).toBeVisible();
  });

  test("CAUUI02 — busca filtra a lista", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("cautelas-loading")).toHaveCount(0, { timeout: 15000 });
    const search = page.getByTestId("cautelas-search");
    await expect(search).toBeVisible();

    await search.fill("zzz-termo-que-nao-deve-bater-em-nada-xyz");
    await page.waitForTimeout(300);
    await expect(page.getByTestId("cautela-row")).toHaveCount(0);

    await search.fill("");
  });

  test("CAUUI03 — alternar pra lista preserva os itens e a tabela rola horizontalmente", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("cautelas-loading")).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByTestId("cautela-row").first()).toBeVisible({ timeout: 10000 });
    const rowsBefore = await page.getByTestId("cautela-row").count();
    test.skip(rowsBefore === 0, "Sem cautelas ativas no fixture pra este teste");

    await page.getByTestId("cautelas-view-lista").click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("cautela-row")).toHaveCount(rowsBefore);

    // Conteúdo largo demais pra caber na tela deve rolar dentro do próprio
    // container, não vazar/cortar sem meio de acesso — mesmo princípio já
    // usado em outras tabelas do app (ex: efetivo/historico).
    const scrollBox = page.locator(".overflow-x-auto").first();
    const isScrollable = await scrollBox.evaluate((el) => el.scrollWidth > el.clientWidth);
    if (isScrollable) {
      await scrollBox.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await page.waitForTimeout(200);
      await expect(page.getByRole("button", { name: "Devolver" }).first()).toBeVisible();
    }

    await page.getByTestId("cautelas-view-grade").click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("cautela-row")).toHaveCount(rowsBefore);
  });

  // Achado de code review: a coluna "Material" usava o mesmo campo do blob
  // de busca (material+identificador+militar+matrícula+motivo concatenados)
  // pra ordenar — "parecia" certo só porque o nome do material é sempre o
  // primeiro token. Corrigido pra ordenar só pelo nome do material
  // (_materialNome, campo dedicado) — este teste prova isso na prática.
  test("CAUUI04 — ordenar pela coluna Material ordena pelo nome do material, não pelo texto concatenado", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas?tab=todas`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Todas" }).click();

    await expect(page.getByTestId("cautelas-loading")).toHaveCount(0, { timeout: 15000 });
    await page.getByTestId("cautelas-view-lista").click();
    await page.waitForTimeout(300);

    const rowCount = await page.getByTestId("cautela-row").count();
    test.skip(rowCount < 2, "Precisa de pelo menos 2 cautelas pra provar ordenação");

    await page.getByRole("columnheader", { name: /Material/i }).click();
    await page.waitForTimeout(300);

    // data-testid dedicado (não span.font-medium genérico): o badge "Lote de
    // N" (cautela com múltiplos materiais) também é um <span> com
    // font-medium na mesma célula — um seletor de classe compartilhada
    // pegaria o texto do badge junto com o nome do material.
    const materialNames = await page.locator('[data-testid="cautela-row"] [data-testid="cautela-material-nome"]').allTextContents();
    const sorted = [...materialNames].sort((a, b) => a.localeCompare(b, "pt-BR"));
    expect(materialNames).toEqual(sorted);
  });

  test("CAUUI05 — modal Nova Cautela com múltiplos materiais: 2 linhas, exclusão cruzada, submit em lote", async ({ page }) => {
    const armeiroToken = await loginToken(USERS.reserva.email, USERS.reserva.password);
    const adminReservaToken = await loginToken(USERS.adminReserva.email, USERS.adminReserva.password);

    const { status: activeStatus, data: activeData } = await bff("GET", "/api/shifts/active", armeiroToken);
    if (activeStatus === 200 && !activeData.shift) {
      const codeRes = await bff("GET", "/api/totp/code", armeiroToken);
      const { data: membershipData } = await sb().from("profiles").select("id").eq("matricula", USERS.reserva.matricula).single();
      const { data: membership } = membershipData?.id
        ? await sb().from("reserve_memberships").select("reserve_id").eq("user_id", membershipData.id).limit(1).single()
        : { data: null };
      await bff("POST", "/api/shifts/open", armeiroToken, {
        reserve_id: membership?.reserve_id, auth_mode: "totp", totp_token: codeRes.data.code,
      });
    }

    const [nomeA, nomeB] = await (async () => {
      const ids = await seedEligibleItems(adminReservaToken, 2);
      const supabase = sb();
      const rows = await Promise.all(ids.map((id) =>
        supabase.from("material_items").select("material_type:material_types(nome)").eq("id", id).single()
      ));
      return rows.map((r) => {
        const mt = r.data?.material_type as unknown as { nome: string } | { nome: string }[] | null;
        return Array.isArray(mt) ? mt[0]?.nome : mt?.nome;
      });
    })();
    if (!nomeA || !nomeB) { test.skip(true, "Falha ao semear itens sintéticos"); return; }

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "domcontentloaded" });

    const novaCautelaBtn = page.getByRole("button", { name: /nova cautela/i });
    await expect(novaCautelaBtn).toBeVisible({ timeout: 15000 });
    await novaCautelaBtn.click();

    const dialog = page.getByRole("dialog").filter({ hasText: /nova cautela permanente/i });
    if (!(await dialog.isVisible().catch(() => false))) await novaCautelaBtn.click();
    await expect(dialog).toBeVisible({ timeout: 10000 });

    // Linha 1: seleciona o primeiro item sintético. Só existe 1 input de
    // busca de item na tela neste ponto (linha única) — assim que um item é
    // selecionado, o ComboBox troca o input pelo "pill" da seleção, então
    // não precisa de índice/nth pra desambiguar.
    const itemInputLine1 = dialog.getByPlaceholder(/buscar item/i);
    await itemInputLine1.click();
    await itemInputLine1.fill(nomeA!);
    await dialog.getByTestId("cautela-item-0-option").first().click();

    // Adiciona a segunda linha.
    await dialog.getByRole("button", { name: /adicionar material/i }).click();

    // Exclusão cruzada: buscando pelo NOME EXATO do item já escolhido na
    // linha 1, ele não deve aparecer entre as opções da linha 2 (linha 1 já
    // está no estado "selecionado", sem input — só a linha 2 tem input de
    // busca visível agora). Nome exato (não um prefixo comum) evita
    // depender de quantos itens sintéticos de execuções anteriores deste
    // mesmo teste ainda existem no banco — o ComboBox só mostra os 8
    // primeiros resultados, um prefixo genérico poderia estourar esse teto.
    const itemInputLine2 = dialog.getByPlaceholder(/buscar item/i);
    await itemInputLine2.click();
    await itemInputLine2.fill(nomeA!);
    await expect(dialog.getByTestId("cautela-item-1-option")).toHaveCount(0);

    await itemInputLine2.fill(nomeB!);
    await dialog.getByTestId("cautela-item-1-option").first().click();

    // Militar responsável.
    const militarInput = dialog.getByPlaceholder(/buscar por posto/i);
    await militarInput.click();
    await militarInput.fill(USERS.efetivo.matricula);
    await dialog.getByTestId("cautela-militar-option").first().click();

    await dialog.getByPlaceholder(/pistola de uso pessoal/i).fill("Teste CAUUI05 — lote via UI");

    const submitBtn = dialog.getByRole("button", { name: /emitir 2 e assinar/i });
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    await submitBtn.click();

    // Sucesso: modal fecha e o SignDialog abre em modo lote.
    const signDialog = page.getByRole("dialog").filter({ hasText: /assinatura — armeiro/i });
    await expect(signDialog).toBeVisible({ timeout: 10000 });
    await expect(signDialog).toContainText(/lote de 2/i);
    await page.getByRole("button", { name: /cancelar/i }).click();

    // O badge "Lote de 2" aparece na grade pras 2 cautelas recém-criadas.
    await expect(page.getByText(/lote de 2/i).first()).toBeVisible({ timeout: 10000 });
  });

});
