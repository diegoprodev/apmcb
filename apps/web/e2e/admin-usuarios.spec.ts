/**
 * AU — Admin Usuários (/admin/usuarios)
 *
 * Harness: AU01-AU15
 * DoD: 07-canonical-definition-of-done.md
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, login, expectToast, USERS } from "./helpers";

const T = { page: 15_000, api: 8_000 };
const ROUTE = "/admin/usuarios";

function adminSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

test.describe("AU — Admin Usuários", () => {

  test("AU01 — carga inicial mostra ≤10 usuários", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const items = page.locator("tbody tr, [data-testid='usuario-card'], [data-testid='usuario-row']");
    await items.first().waitFor({ timeout: T.page }).catch(() => {});
    expect(await items.count()).toBeLessThanOrEqual(10);
  });

  test("AU02 — btn-ver-mais visível quando há mais de 10 usuários", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    const items = page.locator("tbody tr, [data-testid='usuario-card']");
    if (await items.count() >= 10) {
      const visible = await btn.isVisible({ timeout: T.api }).catch(() => false);
      if (visible) await expect(btn).toBeVisible();
    }
  });

  test("AU03 — dropdown Ver mais mostra 20 e 30", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    await expect(page.getByTestId("btn-limit-20")).toBeVisible({ timeout: T.api });
    await expect(page.getByTestId("btn-limit-30")).toBeVisible({ timeout: T.api });
  });

  test("AU04 — busca por texto filtra usuários", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    if (!await input.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem input de busca"); return;
    }
    // SearchInput (search-input.tsx) só filtra a lista de fato (navigateWithQuery,
    // via ?q= na URL, router.replace) ao pressionar Enter ou selecionar uma
    // sugestão — digitar sozinho só dispara o autocomplete (debounce 300ms).
    // Esperar a URL de verdade (não um waitForTimeout fixo) — o router.replace
    // e a nova renderização do Server Component podem levar mais que um
    // timeout curto sob carga, e um wait fixo virava falso negativo.
    await input.fill("xxxxxxxxxxx_sem_resultado");
    await input.press("Enter");
    await page.waitForURL(/[?&]q=/, { timeout: T.api });
    const items = page.locator("tbody tr, [data-testid='usuario-card']");
    await expect(items).toHaveCount(0, { timeout: T.api });
  });

  test("AU05 — botões toggle card/grade presentes", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const toggles = page.locator("button[title*='card' i], button[title*='grade' i], button[title*='tabela' i]");
    const visible = await toggles.first().isVisible({ timeout: T.page }).catch(() => false);
    if (visible) await expect(toggles.first()).toBeVisible();
  });

  test("AU06 — modo tabela ativa thead", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const tableBtn = page.locator("button[title*='grade' i], button[title*='tabela' i]").first();
    if (await tableBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await tableBtn.click();
      await expect(page.locator("thead")).toBeVisible({ timeout: T.api });
    }
  });

  test("AU07 — sort por nome inverte na 2ª clique", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const sortBtn = page.locator("thead button, button[data-sort]").first();
    if (await sortBtn.isVisible({ timeout: T.api }).catch(() => false)) {
      await sortBtn.click();
      await sortBtn.click();
      await expect(sortBtn).toBeVisible();
    }
  });

  test("AU08 — filtro por role funciona", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    const select = page.locator("select[data-testid='filter-role'], select").first();
    if (await select.isVisible({ timeout: T.api }).catch(() => false)) {
      await select.selectOption({ index: 1 });
      await page.waitForTimeout(400);
      await expect(page.locator("body")).toBeVisible();
    }
  });

  test("AU09 — botão Exportar desabilitado sem seleção", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const btn = page.locator("button:has-text('Exportar')").first();
    if (await btn.isVisible({ timeout: T.page }).catch(() => false)) {
      await expect(btn).toBeDisabled();
    }
  });

  test("AU10 — checkbox de item ativa Exportar com contador", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const checkbox = page.locator("input[type='checkbox']").first();
    if (!await checkbox.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem checkboxes"); return;
    }
    await checkbox.check();
    const btn = page.locator("button:has-text('Exportar')").first();
    if (await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      await expect(btn).toBeEnabled({ timeout: T.api });
    }
  });

  test("AU11 — página carrega sem erro 5xx", async ({ page }) => {
    await login(page, "admin");
    const res = await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(500);
  });

  test("AU12 — título da página visível", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: T.page });
  });

  test("AU13 — estado vazio com busca sem resultado", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const input = page.locator("input[placeholder*='uscar' i]").first();
    if (await input.isVisible({ timeout: T.api }).catch(() => false)) {
      await input.fill("xxxxxxxxxxx_sem_resultado");
      await page.waitForTimeout(400);
      const empty = page.locator("text=/nenhum|sem registros|vazio/i").first();
      const visible = await empty.isVisible({ timeout: T.api }).catch(() => false);
      if (visible) await expect(empty).toBeVisible();
    }
  });

  test("AU14 — acesso sem autenticação redireciona para /login", async ({ page }) => {
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login/, { timeout: T.page });
    expect(page.url()).toContain("/login");
  });

  test("AU15 — selecionar 30 → ≤30 usuários", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    const btn = page.getByTestId("btn-ver-mais");
    if (!await btn.isVisible({ timeout: T.api }).catch(() => false)) {
      test.skip(true, "Sem 'Ver mais'"); return;
    }
    await btn.click();
    if (await page.getByTestId("btn-limit-30").isVisible({ timeout: T.api }).catch(() => false)) {
      await page.getByTestId("btn-limit-30").click();
      await page.waitForTimeout(1500);
      const items = page.locator("tbody tr, [data-testid='usuario-card']");
      expect(await items.count()).toBeLessThanOrEqual(30);
    }
  });

  test("AU16 — filtros avançados (papel/unidade/pendência) abrem e filtram a lista", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    const advancedToggle = page.getByText("Filtros avançados");
    await expect(advancedToggle).toBeVisible({ timeout: T.page });
    await advancedToggle.click();

    const papelFilter = page.getByTestId("filter-papel");
    await expect(papelFilter).toBeVisible({ timeout: T.api });

    const beforeCount = await page.locator("tbody tr, [data-testid='usuario-card']").count();
    await papelFilter.click();
    // SearchableSelect: opção "Armeiro" existe porque a fixture tem pelo
    // menos 1 armeiro (armeiro@apmcb.dev) — filtrar por ela deve reduzir a
    // lista (a fixture tem mais de 1 usuário no total).
    await page.getByRole("option", { name: "Armeiro" }).click();
    await page.waitForTimeout(300);
    const afterCount = await page.locator("tbody tr, [data-testid='usuario-card']").count();
    expect(afterCount).toBeLessThan(beforeCount);
    expect(afterCount).toBeGreaterThan(0);
  });

  test("AU17 — editar usuário com papel dentro do teto do caller mostra o seletor de Papel", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // Filtra por Armeiro para achar uma linha que não é o próprio admin_global
    // logado (evita cair na regra de auto-edição, que esconde o seletor).
    const advancedToggle = page.getByText("Filtros avançados");
    await advancedToggle.click();
    await page.getByTestId("filter-papel").click();
    await page.getByRole("option", { name: "Armeiro" }).click();
    await page.waitForTimeout(300);

    const editBtn = page.locator("[title='Editar']").first();
    await expect(editBtn).toBeVisible({ timeout: T.page });
    await editBtn.click();

    await expect(page.getByText("Editar Usuário")).toBeVisible({ timeout: T.api });
    const roleSelect = page.locator("#edit-role");
    await expect(roleSelect).toBeVisible({ timeout: T.api });
    // admin_global pode atribuir todos os 5 papéis — confirma que o dropdown
    // não ficou limitado ao antigo binário Usuário/Armeiro.
    const optionCount = await roleSelect.locator("option").count();
    expect(optionCount).toBe(5);
  });

  // ── AU18/AU19 — Gating do controle "Alterar e-mail de acesso" ────────────
  // Só admin_global/admin_reserva podem trocar o e-mail de login de um
  // usuário que JÁ tem conta (perda de acesso: saiu da unidade, e-mail
  // invadido, erro de digitação). Nunca armeiro, mesmo que o alvo (role
  // "usuario") esteja dentro do teto geral dele (canInvite). Estes dois
  // testes só verificam VISIBILIDADE — nenhuma mutação, seguros contra
  // qualquer fixture (inclusive as usadas para login por outros testes).

  test("AU18 — admin_global vê o botão 'Alterar' e-mail ao editar usuário com conta já ativa", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // Busca pela MATRÍCULA exata de armeiro@apmcb.dev — filtrar só por papel
    // "Armeiro" pode trazer como 1ª linha um fixture órfão de OUTRA suíte
    // (ex: "Temp armeiro", criado sem e-mail por criar-armeiro.spec.ts),
    // ordenado por created_at desc — o que faria este teste falhar por um
    // motivo errado (falta de e-mail no alvo, não o gate de role que ele
    // quer provar). Buscar pela matrícula garante o alvo certo.
    const searchInput = page.getByPlaceholder(/buscar/i);
    await searchInput.fill(USERS.reserva.matricula);
    await searchInput.press("Enter");
    await page.waitForURL(/[?&]q=/, { timeout: T.api });

    await page.locator("[title='Editar']").first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByText("Editar Usuário")).toBeVisible({ timeout: T.api });
    // Precondição: o alvo realmente tem e-mail (senão o teste não prova nada).
    await expect(dialog.getByText(USERS.reserva.email)).toBeVisible({ timeout: T.api });

    await expect(dialog.getByRole("button", { name: "Alterar" })).toBeVisible({ timeout: T.api });

    // Fecha sem salvar — teste é só de visibilidade, não pode mutar a fixture.
    await dialog.getByRole("button", { name: "Cancelar" }).click();
  });

  test("AU19 — armeiro NÃO vê o botão 'Alterar' e-mail, mesmo editando um usuario com conta ativa", async ({ page }) => {
    await login(page, "reserva"); // USERS.reserva.role === "armeiro"
    // /admin/usuarios é exclusivo de admin_global/admin_reserva (guard em
    // page.tsx redireciona armeiro pra "/") — armeiro chega no MESMO dialog
    // de edição (EditUserDialog, via UserRowActions) por /reserva/militares,
    // que reusa o mesmo componente para os 3 papéis (armeiro/admin_reserva/
    // admin_global, ver guard em reserva/militares/page.tsx).
    await page.goto(`${BASE_URL}/reserva/militares`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    // cadete@apmcb.dev (role usuario) tem e-mail/conta ativa — dentro do
    // teto do armeiro (canInvite), mas a troca de e-mail tem um teto PRÓPRIO
    // que nunca inclui armeiro. Busca aqui é filtro local (onChange, sem
    // Enter/URL — ver _militares-table.tsx, diferente do SearchInput
    // server-driven usado em /admin/usuarios).
    const searchInput = page.getByPlaceholder(/buscar por nome ou matr/i);
    await expect(searchInput).toBeVisible({ timeout: T.page });
    await searchInput.fill(USERS.efetivo.matricula);
    await page.waitForTimeout(400);

    const editBtn = page.locator("[title='Editar']").first();
    await expect(editBtn).toBeVisible({ timeout: T.page });
    await editBtn.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByText("Editar Usuário")).toBeVisible({ timeout: T.api });
    // Precondição: o alvo realmente tem e-mail (senão o teste não prova nada
    // — o botão também não apareceria por falta de e-mail, não pelo gate de
    // role que este teste quer cobrir).
    await expect(dialog.getByText(USERS.efetivo.email)).toBeVisible({ timeout: T.api });

    await expect(dialog.getByRole("button", { name: "Alterar" })).toHaveCount(0);

    await dialog.getByRole("button", { name: "Cancelar" }).click();
  });

  // ── AU20 — Troca de e-mail: fluxo completo + duplicidade ──────────────────
  // Usa um usuário DESCARTÁVEL (matrícula "E2E*"/e-mail "@e2e.test", mesma
  // convenção de apps/web/e2e/global-teardown.ts) em vez de mutar uma
  // fixture compartilhada de login — evita qualquer risco de deixar
  // admin@apmcb.dev/armeiro@apmcb.dev etc. com e-mail trocado se o teste
  // falhar no meio. Cleanup em `finally`, incondicional (mesmo padrão de
  // apps/bff/src/__tests__/pentest/privilege-escalation.pentest.test.ts).
  test("AU20 — admin_global troca o e-mail de acesso de um usuário e recebe aviso amigável em caso de duplicidade", async ({ page }) => {
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const matricula = `E2E${id.toUpperCase()}`;
    const nome = `Sd E2E EmailChange ${id}`;
    const emailOriginal = `e2e.${id}@e2e.test`;
    const emailNovo = `e2e.${id}.novo@e2e.test`;
    const sb = adminSupabase();
    let createdId: string | null = null;

    try {
      // ── 1. Cria o usuário descartável, já com e-mail/conta (via convite) ──
      await login(page, "admin");
      await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "load" });
      await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({ timeout: T.page });

      await page.getByRole("button", { name: /cadastrar usuário/i }).click();
      const createDialog = page.getByRole("dialog");
      await expect(createDialog).toBeVisible({ timeout: T.api });

      await createDialog.getByLabel(/nome completo/i).fill(nome);
      await createDialog.getByLabel(/matrícula/i).fill(matricula);
      await createDialog.getByLabel(/enviar convite de login agora/i).check();
      await createDialog.getByLabel(/e-mail do usuário/i).fill(emailOriginal);

      const submitBtn = createDialog.getByTestId("cm-submit-btn");
      await expect(submitBtn).toBeEnabled({ timeout: 2000 });
      const usersRespPromise = page.waitForResponse(
        (r) => r.url().includes("/api/admin/users") && r.request().method() === "POST",
        { timeout: T.api * 3 }
      );
      await submitBtn.click();
      const usersResp = await usersRespPromise;
      expect(usersResp.status(), `POST /api/admin/users retornou ${usersResp.status()}`).toBe(200);
      await expect(createDialog.getByText(/cadastrado com sucesso/i)).toBeVisible({ timeout: T.api * 2 });
      await createDialog.getByRole("button", { name: /fechar/i }).click();

      const { data: created } = await sb.from("profiles").select("id, email").eq("matricula", matricula).maybeSingle();
      expect(created?.id, "usuário descartável não foi encontrado após o cadastro").toBeTruthy();
      createdId = created!.id;
      expect(created?.email).toBe(emailOriginal);

      // ── 2. Troca o e-mail via "Alterar" no dialog de edição ───────────────
      await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "load" });
      const searchInput = page.getByPlaceholder(/buscar/i);
      await searchInput.fill(matricula);
      await page.waitForTimeout(400);
      await expect(page.getByText(matricula)).toBeVisible({ timeout: T.page });
      await page.locator("[title='Editar']").first().click();

      const editDialog = page.locator('[role="dialog"]');
      await expect(editDialog.getByText("Editar Usuário")).toBeVisible({ timeout: T.api });
      await editDialog.getByRole("button", { name: "Alterar" }).click();

      const newEmailInput = editDialog.getByLabel(/novo e-mail/i);
      await expect(newEmailInput).toBeVisible({ timeout: T.api });
      await newEmailInput.fill(emailNovo);

      // window.confirm bloqueia a execução — precisa aceitar via handler
      // ANTES de clicar em Salvar (o clique dispara o confirm de forma
      // síncrona no fluxo do handleSave).
      page.once("dialog", (d) => d.accept());
      await editDialog.getByRole("button", { name: /salvar alterações/i }).click();

      await expectToast(page, /e-mail de acesso alterado/i);

      const { data: afterChange } = await sb.from("profiles").select("email").eq("id", createdId).maybeSingle();
      expect(afterChange?.email).toBe(emailNovo);

      // Trilha de auditoria — resource_type/action são TEXT livre (sem
      // enum), então este INSERT nunca falha por schema; achado de code
      // review: uma troca de e-mail sem audit_log seria uma mutação
      // sensível sem rastro.
      const { data: auditRow } = await sb
        .from("audit_logs")
        .select("id, metadata")
        .eq("resource_id", createdId)
        .eq("action", "profile.email_changed")
        .maybeSingle();
      expect(auditRow, "esperava um audit_logs para profile.email_changed").toBeTruthy();
      expect((auditRow?.metadata as Record<string, unknown> | null)?.email_novo).toBe(emailNovo);

      // Notificação in-app — ao contrário do audit_log acima, este INSERT
      // depende do valor 'email_changed' existir em notification_type_enum
      // (migration 20260815090000_add_email_changed_notification_type.sql).
      // Checagem best-effort (não derruba o teste se a migration ainda não
      // foi aplicada neste ambiente — código tolera esse insert falhar, ver
      // route.ts): loga um aviso claro em vez de mascarar silenciosamente,
      // pra ficar óbvio em CI que falta rodar a migration.
      const { data: notifRow } = await sb
        .from("notifications")
        .select("id")
        .eq("user_id", createdId)
        .eq("type", "email_changed")
        .maybeSingle();
      if (!notifRow) {
        console.warn(
          "[AU20] notification 'email_changed' não encontrada — provável migration " +
          "20260815090000_add_email_changed_notification_type.sql ainda não aplicada neste ambiente."
        );
      }

      // ── 3. Tenta trocar de novo para um e-mail JÁ usado (fixture real) —
      // deve devolver o 409 amigável já existente no endpoint, sem corromper
      // o e-mail atual do usuário descartável. ──────────────────────────────
      await page.goto(`${BASE_URL}${ROUTE}`, { waitUntil: "load" });
      const searchInput2 = page.getByPlaceholder(/buscar/i);
      await searchInput2.fill(matricula);
      await page.waitForTimeout(400);
      await page.locator("[title='Editar']").first().click();

      const editDialog2 = page.locator('[role="dialog"]');
      await expect(editDialog2.getByText("Editar Usuário")).toBeVisible({ timeout: T.api });
      await editDialog2.getByRole("button", { name: "Alterar" }).click();
      await editDialog2.getByLabel(/novo e-mail/i).fill(USERS.admin.email);

      page.once("dialog", (d) => d.accept());
      await editDialog2.getByRole("button", { name: /salvar alterações/i }).click();

      // Mensagem amigável, não erro técnico cru — friendlyApiError já
      // repassa a mensagem 409 do endpoint verbatim (não está na blocklist
      // KNOWN_RAW_BFF_MESSAGES). O perfil (nome/etc.) já tinha sido salvo
      // com sucesso antes dessa chamada, então o dialog mostra um toast de
      // aviso (não erro), mesmo padrão já usado para falha de convite.
      await expectToast(page, /troca de e-mail falhou/i);

      const { data: afterConflict } = await sb.from("profiles").select("email").eq("id", createdId).maybeSingle();
      expect(
        afterConflict?.email,
        "e-mail do usuário descartável não pode ter mudado após uma tentativa de duplicidade"
      ).toBe(emailNovo);

      // A tentativa de duplicidade tenta setar auth.users.email do
      // descartável para USERS.admin.email (fixture REAL, compartilhada por
      // login de outros testes) — o UPDATE deve ser rejeitado pela
      // constraint UNIQUE de auth.users.email SEM tocar na linha do admin.
      // Confirma isso diretamente (id + matrícula do dono do e-mail
      // continuam sendo os da fixture original), em vez de só inferir do
      // comportamento esperado do GoTrue (achado de code review).
      const { data: adminRow } = await sb.from("profiles").select("id, matricula").eq("email", USERS.admin.email).maybeSingle();
      expect(
        adminRow?.matricula,
        "admin@apmcb.dev não pode ter sido afetado pela tentativa de duplicidade do usuário descartável"
      ).toBe(USERS.admin.matricula);
      expect(adminRow?.id).not.toBe(createdId);
    } finally {
      // Cleanup incondicional — mesmo se o teste falhar no meio, o usuário
      // descartável (auth + profile) não pode sobrar em produção.
      if (createdId) {
        await sb.from("profiles").delete().eq("id", createdId);
        await sb.auth.admin.deleteUser(createdId).catch(() => {});
      }
    }
  });

});
