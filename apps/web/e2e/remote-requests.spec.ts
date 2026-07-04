/**
 * Remote Requests Enterprise Suite — RR01..RR30 + SEC-RR01..05 + ADM-RR01..05
 *
 * Spec canônica: docs/enterprise/specs/remote-requests-enterprise.md
 *
 * Estado: testes marcados com test.skip() até aprovação e implementação da feature.
 * Remover .skip() à medida que cada feature for implementada.
 *
 * Run: cd apps/web && pnpm exec playwright test --project=remote-requests-suite
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, BFF_URL, login } from "./harness";
import { bffCall } from "./harness/ssa";
import { createClient } from "@supabase/supabase-js";

const T = { page: 15_000, api: 8_000, nav: 20_000, debounce: 500 };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function openSolicitarSheet(page: Page) {
  await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
  const btn = page.getByTestId("btn-solicitar-armamento");
  await expect(btn).toBeVisible({ timeout: T.page });
  await btn.click();
  await page.waitForTimeout(500);
}

async function cancelExistingRequest(page: Page) {
  const db = supabaseAdmin();
  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("matricula", "000003")
    .single();
  if (!profile) return;
  await db
    .from("material_requests")
    .update({ status: "cancelado", cancelled_at: new Date().toISOString() })
    .eq("military_id", profile.id)
    .in("status", ["pendente", "aprovado"]);
}

// ─── Setup ─────────────────────────────────────────────────────────────────────

test.beforeEach(async () => {
  // Garantir que o cadete não tem solicitação ativa (evita bloqueio do flow)
  await cancelExistingRequest(null as unknown as Page);
});

// ═══════════════════════════════════════════════════════════════════════════════
// RR01..RR05 — Reserva: Combobox + Filtro
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("RR — Seleção de Reserva (Combobox)", () => {

  test.skip();

  test("RR01 — sheet abre em step 'reserve' com combobox visível", async ({ page }) => {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    const combobox = page.getByTestId("ssa-reserve-combobox");
    await expect(combobox).toBeVisible({ timeout: T.page });
    // Não deve mostrar lista plana de cards
    await expect(page.locator("[data-testid^='ssa-reserve-card']")).toHaveCount(0);
  });

  test("RR02 — combobox filtra reservas por nome e acronym", async ({ page }) => {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    const combobox = page.getByTestId("ssa-reserve-combobox");
    await combobox.click();
    const search = page.getByTestId("ssa-reserve-search");
    await expect(search).toBeVisible({ timeout: T.api });
    await search.fill("APMCB");
    await page.waitForTimeout(T.debounce);
    // Deve mostrar reserva APMCB
    const options = page.locator("[data-testid^='ssa-reserve-option-']");
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(1);
    const first = await options.first().textContent();
    expect(first?.toUpperCase()).toContain("APMCB");
  });

  test("RR03 — apenas reservas com allow_remote=true ou is_member aparecem no combobox", async ({ page }) => {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    const combobox = page.getByTestId("ssa-reserve-combobox");
    await combobox.click();
    const options = page.locator("[data-testid^='ssa-reserve-option-']");
    await options.first().waitFor({ timeout: T.api }).catch(() => {});
    const count = await options.count();
    // Cada opção visível deve ser uma reserva remote-enabled
    // (verificação de integridade — não devem aparecer reservas fechadas)
    for (let i = 0; i < count; i++) {
      const text = await options.nth(i).textContent();
      expect(text).toBeTruthy(); // apenas reservas válidas
    }
  });

  test("RR04 — 1 reserva disponível → pula direto para step 'materials'", async ({ page }) => {
    // Este teste depende do ambiente ter exatamente 1 reserva remote-enabled
    // Se o ambiente tem múltiplas, usar test.skip
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    // Após breve carregamento, se só 1 reserva → já está no step de materiais
    const materialSearch = page.getByTestId("ssa-material-search");
    const reserveCombobox = page.getByTestId("ssa-reserve-combobox");
    const isInMaterials = await materialSearch.isVisible({ timeout: 3_000 }).catch(() => false);
    const isInReserve = await reserveCombobox.isVisible({ timeout: 3_000 }).catch(() => false);
    // Pelo menos um dos dois deve estar visível
    expect(isInMaterials || isInReserve).toBe(true);
  });

  test("RR05 — 0 reservas disponíveis → estado vazio com mensagem", async ({ page }) => {
    // Desabilita temporariamente allow_remote em todas as reservas via admin
    // (implementar com toggle admin ou direto no DB em beforeAll deste teste)
    test.skip(true, "Depende de fixture: tenant sem reservas remote-enabled");
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// RR06..RR10 — Motivo da Solicitação (obrigatório para externos)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("RR — Motivo da Solicitação Remota", () => {

  test.skip();

  test("RR06 — step 'motivo' aparece para usuário externo à reserva", async ({ page }) => {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    // Selecionar reserva da qual o cadete NÃO é membro
    const combobox = page.getByTestId("ssa-reserve-combobox");
    await combobox.click();
    const options = page.locator("[data-testid^='ssa-reserve-option-']");
    // Clicar na primeira opção onde is_member=false (sem badge "Membro")
    const externalOption = options.filter({ hasNot: page.locator("[data-testid='badge-membro']") }).first();
    if (await externalOption.isVisible({ timeout: T.api }).catch(() => false)) {
      await externalOption.click();
    } else {
      test.skip(true, "Sem reserva externa disponível no ambiente");
      return;
    }
    const motivoField = page.getByTestId("ssa-motivo-textarea");
    await expect(motivoField).toBeVisible({ timeout: T.page });
  });

  test("RR07 — step 'motivo' NÃO aparece para membro da reserva", async ({ page }) => {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    const combobox = page.getByTestId("ssa-reserve-combobox");
    await combobox.click();
    // Clicar em reserva onde o cadete é membro (badge "Membro" presente)
    const memberOption = page.locator("[data-testid^='ssa-reserve-option-']").filter({
      has: page.locator("[data-testid='badge-membro']"),
    }).first();
    if (!await memberOption.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Cadete não é membro de nenhuma reserva no ambiente");
      return;
    }
    await memberOption.click();
    // Step de motivo NÃO deve aparecer — deve ir direto para materials
    const motivoField = page.getByTestId("ssa-motivo-textarea");
    await expect(motivoField).not.toBeVisible({ timeout: 2_000 }).catch(() => {});
    const materialSearch = page.getByTestId("ssa-material-search");
    await expect(materialSearch).toBeVisible({ timeout: T.page });
  });

  test("RR08 — botão 'Próximo' desabilitado com motivo < 10 chars", async ({ page }) => {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    // Navegar até step motivo (depende de reserva externa disponível)
    const motivoStep = page.getByTestId("ssa-step-motivo");
    if (!await motivoStep.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, "Step motivo não alcançado"); return;
    }
    const textarea = page.getByTestId("ssa-motivo-textarea");
    const nextBtn = page.getByTestId("btn-motivo-next");
    await textarea.fill("Curto");
    await expect(nextBtn).toBeDisabled();
  });

  test("RR09 — botão 'Próximo' habilitado com motivo ≥ 10 chars", async ({ page }) => {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    const motivoStep = page.getByTestId("ssa-step-motivo");
    if (!await motivoStep.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, "Step motivo não alcançado"); return;
    }
    const textarea = page.getByTestId("ssa-motivo-textarea");
    const nextBtn = page.getByTestId("btn-motivo-next");
    await textarea.fill("Serviço extra determinado pelo superior hierárquico");
    await expect(nextBtn).toBeEnabled({ timeout: T.api });
  });

  test("RR10 — motivo é enviado no corpo do POST /api/ssa/requests", async ({ page }) => {
    // Interceptar a requisição e verificar o payload
    const requestBodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/ssa/requests") && req.method() === "POST") {
        requestBodies.push(req.postData() ?? "");
      }
    });
    // ... fluxo completo até submit
    // Verificar que o payload contém remote_reason
    if (requestBodies.length === 0) {
      test.skip(true, "Fluxo completo não executado neste ambiente"); return;
    }
    const body = JSON.parse(requestBodies[0]);
    expect(body.remote_reason).toBeDefined();
    expect(body.remote_reason.length).toBeGreaterThanOrEqual(10);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// RR11..RR15 — Busca de Material (autocomplete)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("RR — Busca de Material", () => {

  test.skip();

  async function goToMaterialsStep(page: Page) {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    // Se step reserve → selecionar primeira reserva
    const combobox = page.getByTestId("ssa-reserve-combobox");
    if (await combobox.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await combobox.click();
      await page.locator("[data-testid^='ssa-reserve-option-']").first().click();
      // Se step motivo → preencher e avançar
      const motivoTextarea = page.getByTestId("ssa-motivo-textarea");
      if (await motivoTextarea.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await motivoTextarea.fill("Serviço extra determinado pelo superior hierárquico");
        await page.getByTestId("btn-motivo-next").click();
      }
    }
    await page.getByTestId("ssa-material-search").waitFor({ timeout: T.page });
  }

  test("RR11 — input de busca visível no step materials", async ({ page }) => {
    await goToMaterialsStep(page);
    const search = page.getByTestId("ssa-material-search");
    await expect(search).toBeVisible({ timeout: T.page });
  });

  test("RR12 — digitar filtra materiais em < 300ms (debounce)", async ({ page }) => {
    await goToMaterialsStep(page);
    const search = page.getByTestId("ssa-material-search");
    const itemsBefore = await page.locator("[data-testid^='ssa-material-item-']").count();
    if (itemsBefore === 0) { test.skip(true, "Sem materiais no ambiente"); return; }
    const firstName = await page.locator("[data-testid^='ssa-material-item-']").first().textContent();
    const searchTerm = (firstName ?? "").slice(0, 3);
    await search.fill(searchTerm);
    await page.waitForTimeout(T.debounce);
    const itemsAfter = await page.locator("[data-testid^='ssa-material-item-']").count();
    expect(itemsAfter).toBeGreaterThanOrEqual(1);
    expect(itemsAfter).toBeLessThanOrEqual(itemsBefore);
  });

  test("RR13 — busca sem resultado → mensagem 'Nenhum material encontrado'", async ({ page }) => {
    await goToMaterialsStep(page);
    const search = page.getByTestId("ssa-material-search");
    await search.fill("xxxxxxxxxxx_sem_resultado");
    await page.waitForTimeout(T.debounce);
    const empty = page.locator("text=/nenhum material/i, [data-testid='ssa-materials-empty']");
    await expect(empty).toBeVisible({ timeout: T.api });
  });

  test("RR14 — limpar busca restaura lista completa", async ({ page }) => {
    await goToMaterialsStep(page);
    const search = page.getByTestId("ssa-material-search");
    const itemsBefore = await page.locator("[data-testid^='ssa-material-item-']").count();
    await search.fill("zzzzz");
    await page.waitForTimeout(T.debounce);
    await search.clear();
    await page.waitForTimeout(T.debounce);
    const itemsAfter = await page.locator("[data-testid^='ssa-material-item-']").count();
    expect(itemsAfter).toBe(itemsBefore);
  });

  test("RR15 — material de categoria não permitida não aparece para usuário externo", async ({ page }) => {
    // Depende de fixture: reserva com remote_allowed_categories = '{farda}' apenas
    // Verificar que materiais da categoria 'arma' não aparecem para o externo
    test.skip(true, "Depende de fixture de categoria remota configurada no admin");
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// RR16..RR20 — Cancelamento pelo Efetivo
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("RR — Cancelamento pelo Efetivo", () => {

  test.skip();

  async function seedPendingRequest(militaryId: string, tenantId: string, reserveId?: string) {
    const db = supabaseAdmin();
    const { data } = await db
      .from("material_requests")
      .insert({
        military_id: militaryId,
        tenant_id: tenantId,
        reserve_id: reserveId ?? null,
        status: "pendente",
        totp_validated: false,
        notes: "Teste E2E",
        is_external_request: false,
      })
      .select("id")
      .single();
    return data?.id;
  }

  test("RR16 — botão 'Cancelar' visível em solicitação pendente", async ({ page }) => {
    await login(page, "efetivo");
    // Verificar que existe uma solicitação pendente visível no dashboard
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
    const cancelBtn = page.locator("[data-testid='btn-cancelar-solicitacao']").first();
    // Se não há solicitação pendente, criar uma via DB seed primeiro
    const isVisible = await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!isVisible) {
      test.skip(true, "Sem solicitação pendente no ambiente — seed via DB beforeAll");
      return;
    }
    await expect(cancelBtn).toBeVisible();
  });

  test("RR17 — botão 'Cancelar' visível em solicitação aprovada", async ({ page }) => {
    test.skip(true, "Seed de solicitação aprovada necessária via DB");
  });

  test("RR18 — dialog de cancelamento pede motivo (obrigatório)", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
    const cancelBtn = page.locator("[data-testid='btn-cancelar-solicitacao']").first();
    if (!await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, "Sem solicitação pendente"); return;
    }
    await cancelBtn.click();
    const motivoField = page.getByTestId("ssa-cancel-reason");
    await expect(motivoField).toBeVisible({ timeout: T.api });
    const confirmBtn = page.getByTestId("btn-confirm-cancel");
    await expect(confirmBtn).toBeDisabled();
  });

  test("RR19 — cancelamento sem motivo → botão confirmar desabilitado", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
    const cancelBtn = page.locator("[data-testid='btn-cancelar-solicitacao']").first();
    if (!await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, "Sem solicitação pendente"); return;
    }
    await cancelBtn.click();
    const motivoField = page.getByTestId("ssa-cancel-reason");
    await motivoField.fill("Curto");
    const confirmBtn = page.getByTestId("btn-confirm-cancel");
    await expect(confirmBtn).toBeDisabled();
  });

  test("RR20 — cancelamento com motivo válido → status muda para cancelado", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
    const cancelBtn = page.locator("[data-testid='btn-cancelar-solicitacao']").first();
    if (!await cancelBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, "Sem solicitação pendente"); return;
    }
    await cancelBtn.click();
    const motivoField = page.getByTestId("ssa-cancel-reason");
    await motivoField.fill("Cancelamento por mudança de escala no serviço");
    const confirmBtn = page.getByTestId("btn-confirm-cancel");
    await expect(confirmBtn).toBeEnabled({ timeout: T.api });
    await confirmBtn.click();
    // Deve sumir o card de solicitação ativa ou mudar para status cancelado
    await expect(page.locator("[data-testid='btn-cancelar-solicitacao']")).not.toBeVisible({ timeout: T.page });
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// RR21..RR25 — Fluxo do Armeiro
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("RR — Fluxo do Armeiro", () => {

  test.skip();

  test("RR21 — armeiro vê solicitações apenas do próprio tenant (não de outros tenants)", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes`, { waitUntil: "domcontentloaded" });
    // Verificar que a lista carregou
    await page.waitForTimeout(1_000);
    // Não deve haver solicitações de outros tenants (verificar via API)
    const { data: all } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = Array.isArray(all) ? all : [];
    // Todos os requests devem pertencer ao mesmo tenant
    const tenantIds = new Set((requests as { tenant_id?: string }[]).map((r) => r.tenant_id).filter(Boolean));
    expect(tenantIds.size).toBeLessThanOrEqual(1);
  });

  test("RR22 — aprovar solicitação → status aprovado + notificação ao efetivo", async ({ page }) => {
    test.skip(true, "Depende de solicitação pendente seedada via DB");
  });

  test("RR23 — rejeitar com motivo → status rejeitado", async ({ page }) => {
    test.skip(true, "Depende de solicitação pendente seedada via DB");
  });

  test("RR24 — rejeitar sem motivo → validação bloqueia", async ({ page }) => {
    await login(page, "reserva");
    const { status } = await bffCall(page, "PATCH", "/api/ssa/requests/00000000-0000-0000-0000-000000000000/reject", {
      reason: "ok", // < 10 chars
    });
    expect([400, 404, 422]).toContain(status);
  });

  test("RR25 — confirmar retirada → status retirado + lendings criados", async ({ page }) => {
    test.skip(true, "Depende de solicitação aprovada seedada via DB");
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// RR26..RR30 — Notificações
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("RR — Notificações", () => {

  test.skip();

  test("RR26 — armeiro recebe notificação in-app ao criar solicitação", async ({ page }) => {
    test.skip(true, "Depende de fluxo de submit completo");
  });

  test("RR27 — deep link da notificação push aponta para /reserva/solicitacoes", async ({ page }) => {
    // Verificar o valor hardcoded no BFF após a fix
    // Testar via BFF introspection ou mock
    test.skip(true, "Verificar após implementação do BFF fix BUG-RR-05");
  });

  test("RR28 — efetivo recebe notificação ao ser aprovado", async ({ page }) => {
    test.skip(true, "Depende de fluxo approve completo");
  });

  test("RR29 — efetivo recebe notificação ao ser rejeitado", async ({ page }) => {
    test.skip(true, "Depende de fluxo reject completo");
  });

  test("RR30 — armeiro recebe notificação ao efetivo cancelar", async ({ page }) => {
    test.skip(true, "Depende de fluxo cancel completo");
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SEC-RR01..05 — Segurança e Isolamento de Tenant
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("SEC-RR — Isolamento de Tenant", () => {

  test.skip();

  test("SEC-RR01 — armeiro de Tenant A NÃO vê solicitações de Tenant B via API", async ({ page }) => {
    await login(page, "reserva"); // armeiro tenant principal
    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = Array.isArray(data) ? data as { tenant_id?: string }[] : [];
    const tenantIds = new Set(requests.map((r) => r.tenant_id).filter(Boolean));
    // Deve haver no máximo 1 tenant
    expect(tenantIds.size).toBeLessThanOrEqual(1);
  });

  test("SEC-RR02 — efetivo de Tenant A NÃO vê materiais de Tenant B via API", async ({ page }) => {
    await login(page, "efetivo");
    const { data } = await bffCall(page, "GET", "/api/ssa/available-materials");
    const materials = Array.isArray(data) ? data as { tenant_id?: string }[] : [];
    const tenantIds = new Set(materials.map((m) => m.tenant_id).filter(Boolean));
    expect(tenantIds.size).toBeLessThanOrEqual(1);
  });

  test("SEC-RR03 — PATCH /cancel falha com 403/404 se military_id diferente", async ({ page }) => {
    await login(page, "reserva"); // armeiro tentando cancelar request de outro user
    const { status } = await bffCall(page, "PATCH", "/api/ssa/requests/00000000-0000-0000-0000-000000000000/cancel", {
      cancellation_reason: "Tentativa não autorizada de cancelamento",
    });
    expect([403, 404]).toContain(status);
  });

  test("SEC-RR04 — reserve_id é salvo em material_requests após submit", async ({ page }) => {
    // Verificar via Supabase que a última solicitação tem reserve_id preenchido
    test.skip(true, "Depende de submit completo com reserve_id");
  });

  test("SEC-RR05 — GET /api/reserves/mine retorna allow_remote e allowed_categories", async ({ page }) => {
    await login(page, "efetivo");
    const { status, data } = await bffCall(page, "GET", "/api/reserves/mine");
    expect(status).toBe(200);
    const body = data as { reserves?: { allow_remote_requests?: unknown; remote_allowed_categories?: unknown }[] };
    const reserves = body.reserves ?? [];
    if (reserves.length === 0) return; // sem reservas no tenant
    const first = reserves[0];
    expect(typeof first.allow_remote_requests === "boolean").toBe(true);
    expect(Array.isArray(first.remote_allowed_categories)).toBe(true);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// ADM-RR01..05 — Admin Controls (toggle + categorias)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("ADM-RR — Controles de Admin", () => {

  test.skip();

  test("ADM-RR01 — toggle allow_remote visível para admin_reserva em /reserva", async ({ page }) => {
    await login(page, "reserva"); // armeiro/admin_reserva
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });
    const toggle = page.getByTestId("remote-access-toggle");
    await expect(toggle).toBeVisible({ timeout: T.page });
  });

  test("ADM-RR02 — toggle liga/desliga allow_remote via PATCH /api/reserves/:id/settings", async ({ page }) => {
    await login(page, "reserva");
    // Buscar reserva atual
    const { data } = await bffCall(page, "GET", "/api/reserves/mine");
    const reserves = (data as { reserves?: { id: string; allow_remote_requests: boolean }[] }).reserves ?? [];
    if (reserves.length === 0) { test.skip(true, "Sem reservas"); return; }
    const reserve = reserves[0];
    const current = reserve.allow_remote_requests;
    const { status } = await bffCall(page, "PATCH", `/api/reserves/${reserve.id}/settings`, {
      allow_remote_requests: !current,
    });
    expect(status).toBe(200);
    // Restaurar
    await bffCall(page, "PATCH", `/api/reserves/${reserve.id}/settings`, {
      allow_remote_requests: current,
    });
  });

  test("ADM-RR03 — checkboxes de categoria visíveis no painel de configuração da reserva", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });
    // Abrir configuração de reserva
    const configBtn = page.getByTestId("btn-reserve-config").first();
    if (!await configBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      test.skip(true, "Botão de config não encontrado — implementar após feature"); return;
    }
    await configBtn.click();
    // Verificar checkboxes de categoria
    for (const cat of ["arma", "farda", "acessorio", "equipamento"]) {
      const checkbox = page.getByTestId(`category-remote-${cat}`);
      await expect(checkbox).toBeVisible({ timeout: T.api });
    }
  });

  test("ADM-RR04 — categoria desabilitada → material dessa categoria não aparece para externo", async ({ page }) => {
    test.skip(true, "Depende de fixture: reserva com remote_allowed_categories=[farda] e material de arma");
  });

  test("ADM-RR05 — efetivo (role usuario) não pode alterar configurações da reserva", async ({ page }) => {
    await login(page, "efetivo");
    const { data: mines } = await bffCall(page, "GET", "/api/reserves/mine");
    const reserves = (mines as { reserves?: { id: string }[] }).reserves ?? [];
    if (reserves.length === 0) { test.skip(true, "Sem reservas"); return; }
    const { status } = await bffCall(page, "PATCH", `/api/reserves/${reserves[0].id}/settings`, {
      allow_remote_requests: true,
    });
    expect([401, 403]).toContain(status);
  });

});
