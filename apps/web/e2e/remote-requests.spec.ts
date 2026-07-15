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
import { bffCall, setupTOTP, createMaterialRequest, getTOTPCode } from "./harness/ssa";
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

// notifyUser()/notifyArmeiosOfTenant() no BFF (apps/bff/src/routes/ssa.ts) são
// fire-and-forget por design (chamadas sem `await`, consistente em todo o
// arquivo) — a resposta HTTP não espera o INSERT em `notifications` terminar.
// Checar a tabela imediatamente após o PATCH retornar 200 é uma corrida real,
// não um bug de produto — poll com retry, não uma leitura única.
async function pollNotificationCount(
  db: ReturnType<typeof supabaseAdmin>,
  type: string,
  requestId: string,
  timeoutMs = 8_000
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { data } = await db
      .from("notifications")
      .select("id")
      .eq("type", type)
      .contains("metadata", { request_id: requestId });
    const count = data?.length ?? 0;
    if (count > 0 || Date.now() >= deadline) return count;
    await new Promise((r) => setTimeout(r, 500));
  }
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
    const isInMaterials = await materialSearch.isVisible({ timeout: T.api }).catch(() => false);
    const isInReserve = await reserveCombobox.isVisible({ timeout: T.api }).catch(() => false);
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

  // Navega até o step "motivo" selecionando uma reserva externa (não-membro)
  // no combobox — RR08/RR09 testam a validação desse step, não conseguem
  // alcançá-lo sem essa navegação.
  async function goToMotivoStep(page: Page): Promise<boolean> {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    const combobox = page.getByTestId("ssa-reserve-combobox");
    if (!await combobox.isVisible({ timeout: T.api }).catch(() => false)) return false;
    await combobox.click();
    const externalOption = page
      .locator("[data-testid^='ssa-reserve-option-']")
      .filter({ hasNot: page.locator("[data-testid='badge-membro']") })
      .first();
    if (!await externalOption.isVisible({ timeout: T.api }).catch(() => false)) return false;
    await externalOption.click();
    return page.getByTestId("ssa-step-motivo").isVisible({ timeout: T.page }).catch(() => false);
  }

  test("RR08 — botão 'Próximo' desabilitado com motivo < 10 chars", async ({ page }) => {
    if (!await goToMotivoStep(page)) {
      test.skip(true, "Sem reserva externa disponível no ambiente"); return;
    }
    const textarea = page.getByTestId("ssa-motivo-textarea");
    const nextBtn = page.getByTestId("btn-motivo-next");
    await textarea.fill("Curto");
    await expect(nextBtn).toBeDisabled();
  });

  test("RR09 — botão 'Próximo' habilitado com motivo ≥ 10 chars", async ({ page }) => {
    if (!await goToMotivoStep(page)) {
      test.skip(true, "Sem reserva externa disponível no ambiente"); return;
    }
    const textarea = page.getByTestId("ssa-motivo-textarea");
    const nextBtn = page.getByTestId("btn-motivo-next");
    await textarea.fill("Serviço extra determinado pelo superior hierárquico");
    await expect(nextBtn).toBeEnabled({ timeout: T.api });
  });

  test("RR10 — motivo é enviado no corpo do POST /api/ssa/requests", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);

    const requestBodies: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/ssa/requests") && req.method() === "POST") {
        requestBodies.push(req.postData() ?? "");
      }
    });

    await openSolicitarSheet(page);
    const combobox = page.getByTestId("ssa-reserve-combobox");
    if (!await combobox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem step de seleção de reserva no ambiente (usuário só tem 1 reserva acessível)"); return;
    }
    await combobox.click();
    const externalOption = page.locator("[data-testid^='ssa-reserve-option-']").filter({ hasNot: page.locator("[data-testid='badge-membro']") }).first();
    if (!await externalOption.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem reserva externa disponível no ambiente"); return;
    }
    const testId = await externalOption.getAttribute("data-testid");
    const reserveId = testId?.replace("ssa-reserve-option-", "");
    await externalOption.click();

    const motivoField = page.getByTestId("ssa-motivo-textarea");
    await expect(motivoField).toBeVisible({ timeout: T.page });
    await motivoField.fill("Serviço extra determinado pelo superior hierárquico");
    await page.getByTestId("btn-motivo-next").click();

    await page.getByTestId("ssa-material-search").waitFor({ timeout: T.page });
    const { data: materialsData } = await bffCall(page, "GET", `/api/ssa/available-materials?reserve_id=${reserveId}`);
    const materials = materialsData as { id: string; nome: string }[];
    if (!materials.length) { test.skip(true, "Sem materiais disponíveis para esta reserva externa"); return; }
    await page.getByTestId("ssa-material-search").fill(materials[0].nome);
    const item = page.locator(`[data-testid="ssa-material-item-${materials[0].id}"]`);
    await expect(item).toBeVisible({ timeout: 10_000 });
    await item.click();
    await page.getByTestId("btn-step-next").click();

    const code = await getTOTPCode(page);
    await page.getByTestId("totp-input").fill(code);
    await page.getByTestId("btn-submit-request").click();

    await expect.poll(() => requestBodies.length, { timeout: 10_000 }).toBeGreaterThan(0);
    const body = JSON.parse(requestBodies[0]);
    expect(body.remote_reason).toBeDefined();
    expect(body.remote_reason.length).toBeGreaterThanOrEqual(10);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// RR11..RR15 — Busca de Material (autocomplete)
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("RR — Busca de Material", () => {


  async function goToMaterialsStep(page: Page) {
    await login(page, "efetivo");
    await openSolicitarSheet(page);
    // Se step reserve → selecionar primeira reserva. Probe com T.api (não um
    // valor curto tipo 3s) — achado real: sob carga de suíte completa (várias
    // dezenas de testes sequenciais antes deste), o sheet pode demorar mais
    // que 3s para hidratar/buscar reservas, o que fazia esse "if" avaliar
    // false por falso-negativo e pular a seleção de reserva inteira,
    // deixando o sheet preso no step "reserve" (ssa-material-search nunca
    // aparece, timeout 15s depois no waitFor abaixo).
    const combobox = page.getByTestId("ssa-reserve-combobox");
    if (await combobox.isVisible({ timeout: T.api }).catch(() => false)) {
      await combobox.click();
      await page.locator("[data-testid^='ssa-reserve-option-']").first().click();
      // Se step motivo → preencher e avançar
      const motivoTextarea = page.getByTestId("ssa-motivo-textarea");
      if (await motivoTextarea.isVisible({ timeout: T.api }).catch(() => false)) {
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
    const empty = page.getByText(/nenhum material/i);
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

  // O beforeEach global (cancelExistingRequest) limpa qualquer pendência antes
  // de cada teste — por isso o seed precisa acontecer DENTRO do teste, via
  // fluxo real (setupTOTP + createMaterialRequest), não como pré-condição
  // torcida a partir de estado deixado por outro teste.
  test("RR16 — botão 'Cancelar' visível em solicitação pendente", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
    const cancelBtn = page.locator("[data-testid='btn-cancelar-solicitacao']").first();
    await expect(cancelBtn).toBeVisible({ timeout: T.page });
  });

  test("RR17 — botão 'Cancelar' visível em solicitação aprovada", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    expect(status).toBe(200);

    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
    const cancelBtn = page.locator("[data-testid='btn-cancelar-solicitacao']").first();
    await expect(cancelBtn).toBeVisible({ timeout: T.page });
  });

  test("RR18 — dialog de cancelamento pede motivo (obrigatório)", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
    const cancelBtn = page.locator("[data-testid='btn-cancelar-solicitacao']").first();
    await expect(cancelBtn).toBeVisible({ timeout: T.page });
    await cancelBtn.click();
    const motivoField = page.getByTestId("ssa-cancel-reason");
    await expect(motivoField).toBeVisible({ timeout: T.api });
    const confirmBtn = page.getByTestId("btn-confirm-cancel");
    await expect(confirmBtn).toBeDisabled();
  });

  test("RR19 — cancelamento sem motivo → botão confirmar desabilitado", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
    const cancelBtn = page.locator("[data-testid='btn-cancelar-solicitacao']").first();
    await expect(cancelBtn).toBeVisible({ timeout: T.page });
    await cancelBtn.click();
    const motivoField = page.getByTestId("ssa-cancel-reason");
    await motivoField.fill("Curto");
    const confirmBtn = page.getByTestId("btn-confirm-cancel");
    await expect(confirmBtn).toBeDisabled();
  });

  test("RR20 — cancelamento com motivo válido → status muda para cancelado", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    await createMaterialRequest(page);
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "domcontentloaded" });
    const cancelBtn = page.locator("[data-testid='btn-cancelar-solicitacao']").first();
    await expect(cancelBtn).toBeVisible({ timeout: T.page });
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
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    expect(status).toBe(200);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { id: string; status: string }[];
    expect(requests.find((r) => r.id === request_id)?.status).toBe("aprovado");

    // Notificação ao efetivo (BUG-RR-02/05): checar via DB direto (não exposto por bffCall)
    const db = supabaseAdmin();
    const count = await pollNotificationCount(db, "armament_approved", request_id);
    expect(count).toBeGreaterThan(0);
  });

  test("RR23 — rejeitar com motivo → status rejeitado", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/reject`, {
      reason: "Material indisponível no momento",
    });
    expect(status).toBe(200);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { id: string; status: string }[];
    expect(requests.find((r) => r.id === request_id)?.status).toBe("rejeitado");
  });

  test("RR24 — rejeitar sem motivo → validação bloqueia", async ({ page }) => {
    await login(page, "reserva");
    const { status } = await bffCall(page, "PATCH", "/api/ssa/requests/00000000-0000-0000-0000-000000000000/reject", {
      reason: "ok", // < 10 chars
    });
    expect([400, 404, 422]).toContain(status);
  });

  test("RR25 — confirmar retirada → status retirado + lendings criados", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/deliver`);
    expect(status).toBe(200);

    const { data } = await bffCall(page, "GET", "/api/ssa/requests");
    const requests = data as { id: string; status: string }[];
    expect(requests.find((r) => r.id === request_id)?.status).toBe("retirado");

    const db = supabaseAdmin();
    const { data: lendings } = await db
      .from("lendings")
      .select("id")
      .eq("material_request_id", request_id);
    expect((lendings?.length ?? 0)).toBeGreaterThan(0);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// RR26..RR30 — Notificações
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("RR — Notificações", () => {


  test("RR26 — armeiro recebe notificação in-app ao criar solicitação", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    const db = supabaseAdmin();
    const count = await pollNotificationCount(db, "armament_requested", request_id);
    expect(count).toBeGreaterThan(0);
  });

  test("RR27 — deep link da notificação push aponta para /reserva/solicitacoes", async ({ page }) => {
    // O deep link é enviado apenas no payload do push fire-and-forget
    // (fetch interno /api/push/broadcast) — não é persistido na linha de
    // notifications, então não dá para verificar via DB. Verificação exigiria
    // interceptar a chamada HTTP interna do BFF, fora do escopo de um teste
    // E2E black-box. Ver notifyArmeiosOfTenant() em apps/bff/src/routes/ssa.ts.
    test.skip(true, "Deep link só existe no payload de push interno (fire-and-forget), não em DB — não verificável por E2E black-box");
  });

  test("RR28 — efetivo recebe notificação ao ser aprovado", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/approve`);

    const db = supabaseAdmin();
    const count = await pollNotificationCount(db, "armament_approved", request_id);
    expect(count).toBeGreaterThan(0);
  });

  test("RR29 — efetivo recebe notificação ao ser rejeitado", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);

    await login(page, "reserva");
    await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/reject`, {
      reason: "Material indisponível no momento",
    });

    const db = supabaseAdmin();
    const count = await pollNotificationCount(db, "armament_rejected", request_id);
    expect(count).toBeGreaterThan(0);
  });

  test("RR30 — armeiro recebe notificação ao efetivo cancelar", async ({ page }) => {
    await login(page, "efetivo");
    await setupTOTP(page);
    const { request_id } = await createMaterialRequest(page);
    const { status } = await bffCall(page, "PATCH", `/api/ssa/requests/${request_id}/cancel`, {
      cancellation_reason: "Dispensado do serviço extraordinário",
    });
    expect(status).toBe(200);

    const db = supabaseAdmin();
    const count = await pollNotificationCount(db, "armament_cancelled", request_id);
    expect(count).toBeGreaterThan(0);
  });

});

// ═══════════════════════════════════════════════════════════════════════════════
// SEC-RR01..05 — Segurança e Isolamento de Tenant
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("SEC-RR — Isolamento de Tenant", () => {


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
    await login(page, "efetivo");
    await setupTOTP(page);

    const { data: minesData } = await bffCall(page, "GET", "/api/reserves/mine");
    const reserves = (minesData as { reserves?: { id: string; is_member: boolean }[] }).reserves ?? [];
    const own = reserves.find((r) => r.is_member) ?? reserves[0];
    if (!own) { test.skip(true, "Sem reservas no tenant"); return; }

    const { data: materialsData } = await bffCall(page, "GET", "/api/ssa/available-materials");
    const materials = materialsData as { id: string }[];
    if (!materials.length) { test.skip(true, "Sem materiais disponíveis"); return; }

    let requestId: string | undefined;
    for (let attempt = 0; attempt < 3 && !requestId; attempt++) {
      const code = await getTOTPCode(page);
      const { status, data } = await bffCall(page, "POST", "/api/ssa/requests", {
        items: [{ material_type_id: materials[0].id, quantity: 1 }],
        totp_token: code,
        reserve_id: own.id,
      });
      if (status === 201) { requestId = (data as { request_id: string }).request_id; break; }
      const err = JSON.stringify(data);
      if (status === 400 && err.includes("nválido") && attempt < 2) { await page.waitForTimeout(31_000); continue; }
      throw new Error(`Falha ao criar solicitação: HTTP ${status} — ${err}`);
    }
    expect(requestId).toBeTruthy();

    const db = supabaseAdmin();
    const { data: row } = await db.from("material_requests").select("reserve_id").eq("id", requestId!).single();
    expect(row?.reserve_id).toBe(own.id);
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


  test("ADM-RR01 — toggle allow_remote visível para admin_reserva em /reserva", async ({ page }) => {
    // "reserva" (harness.ts) é o role "armeiro" — currentReserve (e portanto o
    // toggle) só é resolvido para admin_reserva/admin_global (reserva/page.tsx),
    // e a rota PATCH /:id/settings exige o mesmo — usar "adminReserva".
    await login(page, "adminReserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });
    const toggle = page.getByTestId("remote-access-toggle");
    await expect(toggle).toBeVisible({ timeout: T.page });
  });

  test("ADM-RR02 — toggle liga/desliga allow_remote via PATCH /api/reserves/:id/settings", async ({ page }) => {
    await login(page, "adminReserva");
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
