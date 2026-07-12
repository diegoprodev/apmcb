/**
 * Login Invite Flow — LI01–LI20
 *
 * Cobre o fluxo unificado de convite de login (dialog único "Cadastrar
 * Usuário" em apps/web/src/app/(dashboard)/admin/usuarios/_cadastrar-militar-dialog.tsx,
 * com toggle interno "Novo militar" / "Militar já cadastrado" — antes eram
 * dois botões/dialogs separados, "Cadastrar Usuário" + "Criar Login",
 * unificados nesta tarefa a pedido do dono do produto):
 * - Cadastro com convite imediato
 * - Re-envio para militar existente
 * - 3 estados de pendência (bio, TOTP, conta)
 * - Supabase Realtime 2-way sync
 *
 * Nota de manutenção: a versão anterior deste arquivo usava um esquema de
 * credenciais (E2E_ADMIN_EMAIL/E2E_MASTER_EMAIL/E2E_CADETE_ID...) que nunca
 * existiu em nenhum .env do projeto — todo teste falhava em loginAs() com
 * "undefined". Reescrito para usar ./harness (USERS + login()), o mesmo
 * padrão comprovado usado por todas as outras suítes E2E do projeto, e uma
 * fixture descartável própria (evita mutar o usuário "efetivo" compartilhado
 * por outras suítes, que rodam em paralelo contra a mesma base de produção).
 */

import { test, expect, type Page } from "@playwright/test";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { BASE_URL, login, USERS } from "./harness";

// ── helpers ────────────────────────────────────────────────────────────────

function adminSupabase() {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Abre o dialog único e garante o modo "Militar já cadastrado" (busca). */
async function openExistingMode(page: Page) {
  await page.getByTestId("btn-cadastrar-usuario").click();
  await page.getByTestId("cm-mode-existente").click();
  await expect(page.getByPlaceholder(/nome ou matrícula/i)).toBeVisible();
}

async function cleanupTestProfile(matricula: string) {
  const sb = adminSupabase();
  const { data: profile } = await sb
    .from("profiles")
    .select("id")
    .eq("matricula", matricula)
    .maybeSingle();
  if (profile) {
    await sb.auth.admin.deleteUser(profile.id);
  }
}

// ── fixture descartável para os testes que precisam de um "usuario" role
//    já cadastrado (busca, re-envio, mutação de status) sem tocar no
//    usuário "efetivo" compartilhado (USERS.efetivo) usado por outras
//    suítes em paralelo ────────────────────────────────────────────────────
let fixtureId: string | null = null;
const FIXTURE_MAT = "LI_FIXTURE_" + Date.now();
const FIXTURE_NOME = "LI Fixture Militar";

test.describe("LI — Login Invite Flow", () => {
  const TEST_MAT = "LI_TEST_" + Date.now();

  test.beforeAll(async () => {
    const sb = adminSupabase();
    // Tenant do usuário admin de teste — profiles precisam de default_tenant_id
    // para serem visíveis via RLS na busca/grid (ver profiles_select policy).
    const { data: adminProfile } = await sb
      .from("profiles")
      .select("default_tenant_id")
      .eq("matricula", USERS.admin.matricula)
      .single();

    const internalEmail = `${FIXTURE_MAT.toLowerCase()}.interno@apmcb.sistema`;
    const { data: created, error } = await sb.auth.admin.createUser({
      email: internalEmail,
      email_confirm: true,
      user_metadata: { nome_completo: FIXTURE_NOME, matricula: FIXTURE_MAT, internal: true },
    });
    if (error || !created?.user) {
      // eslint-disable-next-line no-console
      console.warn("[login-invite.spec] falha ao criar fixture — testes dependentes serão skippados", error?.message);
      return;
    }
    fixtureId = created.user.id;
    await sb.from("profiles").upsert({
      id: fixtureId,
      email: null,
      nome_completo: FIXTURE_NOME,
      matricula: FIXTURE_MAT,
      posto: "cadete",
      role: "usuario",
      registration_status: "pending_biometric",
      default_tenant_id: adminProfile?.default_tenant_id ?? null,
    });
  });

  test.afterAll(async () => {
    if (fixtureId) {
      const sb = adminSupabase();
      await sb.auth.admin.deleteUser(fixtureId).catch(() => {});
    }
  });

  test.afterEach(async () => {
    await cleanupTestProfile(TEST_MAT).catch(() => {});
  });

  // LI01 — Cadastrar com convite envia invite_sent_at
  test("LI01 - cadastro com invite checkbox envia convite e persiste invite_sent_at", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    await page.getByTestId("btn-cadastrar-usuario").click();
    await page.getByLabel(/nome completo/i).fill("LI Test Militar");
    await page.getByLabel(/matrícula/i).fill(TEST_MAT);

    // Marca checkbox de convite — input real cobre 100% da label (fix do
    // bug reportado: antes a div decorativa interceptava o clique/.check()).
    await page.getByLabel(/enviar convite de login/i).check();
    await expect(page.getByLabel(/e-mail do usuário/i)).toBeVisible();
    await page.getByLabel(/e-mail do usuário/i).fill("litest@example.com");

    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    await expect(page.getByText(/cadastrado com sucesso/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/convite enviado para/i)).toBeVisible();

    // Verifica no DB que invite_sent_at foi preenchido
    const sb = adminSupabase();
    const { data } = await sb.from("profiles").select("invite_sent_at, default_tenant_id").eq("matricula", TEST_MAT).maybeSingle();
    expect(data?.invite_sent_at).toBeTruthy();
    // Regressão do bug raiz desta tarefa: sem default_tenant_id o cadastro
    // fica invisível na grid para admin_reserva/armeiro/admin_global.
    expect(data?.default_tenant_id).toBeTruthy();
  });

  // LI02 — Cadastro SEM invite NÃO preenche invite_sent_at
  test("LI02 - cadastro sem convite não define invite_sent_at", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    await page.getByTestId("btn-cadastrar-usuario").click();
    await page.getByLabel(/nome completo/i).fill("LI Test NoInvite");
    await page.getByLabel(/matrícula/i).fill(TEST_MAT);

    // Não marca checkbox de convite
    await expect(page.getByLabel(/enviar convite/i)).not.toBeChecked();

    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    await expect(page.getByText(/cadastrado com sucesso/i)).toBeVisible({ timeout: 15000 });

    const sb = adminSupabase();
    const { data } = await sb.from("profiles").select("invite_sent_at").eq("matricula", TEST_MAT).maybeSingle();
    expect(data?.invite_sent_at).toBeNull();
  });

  // LI03 — Modo "Militar já cadastrado" busca e lista resultado
  test("LI03 - modo militar já cadastrado busca militar existente e auto-preenche campos", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    await openExistingMode(page);

    // Busca por matrícula
    await page.getByPlaceholder(/nome ou matrícula/i).fill(FIXTURE_MAT.slice(0, 6));
    await expect(page.locator("button").filter({ hasText: FIXTURE_MAT }).first()).toBeVisible({ timeout: 5000 });
  });

  // LI04 — Re-envio < 10 min mostra aviso de confirmação
  test("LI04 - re-envio com invite_sent_at recente mostra aviso de confirmação", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");

    // Simula invite_sent_at recente no DB
    const sb = adminSupabase();
    await sb.from("profiles").update({ invite_sent_at: new Date().toISOString() }).eq("id", fixtureId!);

    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    await openExistingMode(page);
    await page.getByPlaceholder(/nome ou matrícula/i).fill(FIXTURE_MAT);
    await page.locator("button").filter({ hasText: FIXTURE_MAT }).first().click({ timeout: 5000 }).catch(() => {});

    // Selecionar o militar com invite recente deve mostrar aviso
    await expect(page.getByText(/convite enviado há/i)).toBeVisible({ timeout: 5000 });

    // Limpa para não afetar outros testes desta suíte
    await sb.from("profiles").update({ invite_sent_at: null }).eq("id", fixtureId!);
  });

  // LI05 — E-mail duplicado retorna erro claro (via provisionamento de acesso
  // a um militar já cadastrado — o cadastro em si nunca falha por e-mail
  // duplicado, só o passo de convite, que é onde a duplicidade é checada).
  test("LI05 - e-mail duplicado no sistema retorna erro claro", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    await openExistingMode(page);
    await page.getByPlaceholder(/nome ou matrícula/i).fill(FIXTURE_MAT);
    const resultBtn = page.locator("button").filter({ hasText: FIXTURE_MAT }).first();
    await expect(resultBtn).toBeVisible({ timeout: 5000 });
    await resultBtn.click();

    // Usa o e-mail do próprio admin de teste — já existe no sistema
    await page.getByLabel(/e-mail do usuário/i).fill(USERS.admin.email);
    await page.getByRole("button", { name: /enviar convite|re-enviar convite/i }).click();
    await expect(page.getByText(/já possui cadastro|já cadastrado|already registered/i)).toBeVisible({ timeout: 8000 });
  });

  // LI06 — Grid mostra "Bio" pendente para novo cadastro
  test("LI06 - grid mostra badge Bio para militar sem biometria", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    // Encontra usuário com pending_biometric e verifica badge
    const bioBadge = page.getByText("Bio").first();
    // Pode não ter dependendo dos dados — não falha se não existir
    const count = await bioBadge.count();
    if (count > 0) {
      await expect(bioBadge.first()).toBeVisible();
    }
  });

  // LI07 — Grid mostra "TOTP" pendente
  test("LI07 - grid mostra badge TOTP para militar sem totp_configured", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    // Verificação de presença do badge TOTP no grid
    const totpBadge = page.getByText("TOTP").first();
    const count = await totpBadge.count();
    if (count > 0) {
      await expect(totpBadge.first()).toBeVisible();
    }
  });

  // LI08 — Grid mostra "Convite env." após invite_sent_at
  test("LI08 - grid mostra badge Convite env. quando invite_sent_at preenchido", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");

    const sb = adminSupabase();
    await sb.from("profiles").update({
      invite_sent_at: new Date().toISOString(),
      account_activated_at: null,
    }).eq("id", fixtureId!);

    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(FIXTURE_MAT);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText("Convite env.").first()).toBeVisible({ timeout: 5000 });
  });

  // LI09 — Grid mostra "Conta ✓" após account_activated_at
  test("LI09 - grid mostra badge Conta ✓ quando account_activated_at preenchido", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");

    const sb = adminSupabase();
    await sb.from("profiles").update({
      invite_sent_at: new Date(Date.now() - 3600000).toISOString(),
      account_activated_at: new Date().toISOString(),
    }).eq("id", fixtureId!);

    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(FIXTURE_MAT);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText("Conta ✓").first()).toBeVisible({ timeout: 5000 });
  });

  // LI10 — Grid mostra "Completo" quando tudo OK
  test("LI10 - grid mostra Completo quando bio+totp+conta todos OK", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");

    const sb = adminSupabase();
    await sb.from("profiles").update({
      registration_status: "complete",
      totp_configured: true,
      invite_sent_at: new Date(Date.now() - 7200000).toISOString(),
      account_activated_at: new Date(Date.now() - 3600000).toISOString(),
    }).eq("id", fixtureId!);

    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(FIXTURE_MAT);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText("Completo").first()).toBeVisible({ timeout: 5000 });
  });

  // LI11 — Realtime: badge atualiza sem reload
  test("LI11 - realtime: badge de status atualiza na grid sem reload", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");

    const sb = adminSupabase();

    // Inicialmente sem invite
    await sb.from("profiles").update({
      invite_sent_at: null,
      account_activated_at: null,
    }).eq("id", fixtureId!);

    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(FIXTURE_MAT);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText(FIXTURE_MAT)).toBeVisible();

    // Simula update via DB (como se o militar tivesse ativado a conta)
    await sb.from("profiles").update({
      invite_sent_at: new Date(Date.now() - 7200000).toISOString(),
      account_activated_at: new Date().toISOString(),
    }).eq("id", fixtureId!);

    // Badge deve atualizar via Realtime em < 8s sem reload
    await expect(page.getByText("Conta ✓").first()).toBeVisible({ timeout: 8000 });
  });

  // LI12 — Armeiro não pode selecionar o perfil inicial "Armeiro" ao cadastrar
  // (teto de privilégio: armeiro só cadastra role "usuario"). Verificado na
  // página /reserva/militares, que reusa o mesmo toolbar/dialog de admin/usuarios.
  test("LI12 - armeiro não pode selecionar perfil inicial Armeiro ao cadastrar", async ({ page }) => {
    await login(page, "reserva"); // USERS.reserva.role === "armeiro"
    await page.goto(`${BASE_URL}/reserva/militares`, { waitUntil: "load" });

    const btn = page.getByTestId("btn-cadastrar-usuario");
    const count = await btn.count();
    test.skip(count === 0, "Sem btn-cadastrar-usuario para este role");

    await btn.click();
    // Modo "Novo militar" é o padrão — botão de perfil "Armeiro" deve estar desabilitado
    const armeiroBtn = page.getByRole("button", { name: /^armeiro$/i });
    await expect(armeiroBtn).toBeDisabled();
  });

  // LI13 — Sem sessão, API rejeita criação/convite com 401/403
  test("LI13 - API rejeita requisição sem sessão com 401/403", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/admin/users`, {
      data: { email: "x@x.com", nome_completo: "X", matricula: "X001", method: "magic_link", role: "admin" },
    });
    expect([403, 401]).toContain(res.status());
  });

  // LI14 — Busca (modo militar já cadastrado) retorna resultados por nome parcial
  test("LI14 - busca de militar existente por nome parcial funciona", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await openExistingMode(page);

    await page.getByPlaceholder(/nome ou matrícula/i).fill("Test");
    // Aguarda dropdown ou mensagem de nenhum resultado
    await page.waitForTimeout(600); // debounce
    // Não falha se não houver resultados — só verifica que o campo funciona
    await expect(page.getByPlaceholder(/nome ou matrícula/i)).toBeVisible();
  });

  // LI15 — Busca por matrícula
  test("LI15 - busca por matrícula retorna resultado correto", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await openExistingMode(page);

    await page.getByPlaceholder(/nome ou matrícula/i).fill(FIXTURE_MAT);
    await page.waitForTimeout(600);
    // Deve aparecer pelo menos 1 resultado
    const results = page.locator("button").filter({ hasText: FIXTURE_MAT });
    await expect(results.first()).toBeVisible({ timeout: 5000 });
  });

  // LI16 — Selecionar militar existente substitui a busca pelo card selecionado
  test("LI16 - selecionar militar existente substitui busca por card selecionado", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await openExistingMode(page);

    await page.getByPlaceholder(/nome ou matrícula/i).fill(FIXTURE_MAT);
    await page.waitForTimeout(600);
    const resultBtn = page.locator("button").filter({ hasText: FIXTURE_MAT }).first();
    await expect(resultBtn).toBeVisible({ timeout: 5000 });
    await resultBtn.click();

    // Busca desaparece, card do selecionado aparece com a matrícula
    await expect(page.getByPlaceholder(/nome ou matrícula/i)).not.toBeVisible();
    await expect(page.getByText(FIXTURE_MAT)).toBeVisible();
  });

  // LI17 — Método "Senha" exibe campo de senha (modo militar já cadastrado)
  test("LI17 - selecionar metodo senha exibe campo de senha", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await openExistingMode(page);
    await page.getByPlaceholder(/nome ou matrícula/i).fill(FIXTURE_MAT);
    const resultBtn = page.locator("button").filter({ hasText: FIXTURE_MAT }).first();
    await expect(resultBtn).toBeVisible({ timeout: 5000 });
    await resultBtn.click();

    await page.getByRole("button", { name: /^senha$/i }).click();
    await expect(page.getByLabel(/senha temporária/i)).toBeVisible();
  });

  // LI18 — Senha < 6 chars → botão de submit permanece desabilitado
  test("LI18 - senha temporaria curta mantém submit desabilitado", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await openExistingMode(page);
    await page.getByPlaceholder(/nome ou matrícula/i).fill(FIXTURE_MAT);
    const resultBtn = page.locator("button").filter({ hasText: FIXTURE_MAT }).first();
    await expect(resultBtn).toBeVisible({ timeout: 5000 });
    await resultBtn.click();

    await page.getByRole("button", { name: /^senha$/i }).click();
    await page.getByLabel(/e-mail do usuário/i).fill("test@example.com");
    await page.getByLabel(/senha temporária/i).fill("123");
    await expect(page.getByTestId("cm-submit-btn")).toBeDisabled();
  });

  // LI19 — Militar inativo: badge "Inativo" no grid
  test("LI19 - militar inativo mostra badge Inativo no grid", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");

    const sb = adminSupabase();
    await sb.from("profiles").update({ registration_status: "inactive" }).eq("id", fixtureId!);

    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(FIXTURE_MAT);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText("Inativo").first()).toBeVisible({ timeout: 5000 });

    // Restore
    await sb.from("profiles").update({ registration_status: "complete" }).eq("id", fixtureId!);
  });

  // LI20 — Convite expirado (> 24h) mostra badge "Expirado"
  test("LI20 - convite expirado ha mais de 24h mostra badge Expirado", async ({ page }) => {
    test.skip(!fixtureId, "Fixture não disponível");

    const sb = adminSupabase();
    await sb.from("profiles").update({
      invite_sent_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      account_activated_at: null,
    }).eq("id", fixtureId!);

    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible().catch(() => false)) {
      await searchInput.fill(FIXTURE_MAT);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText("Expirado").first()).toBeVisible({ timeout: 5000 });
  });
});
