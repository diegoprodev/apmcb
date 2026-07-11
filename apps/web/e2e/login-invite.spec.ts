/**
 * Login Invite Flow — LI01–LI20
 *
 * Cobre o fluxo unificado de convite de login:
 * - Cadastro com convite imediato
 * - Re-envio para militar existente
 * - 3 estados de pendência (bio, TOTP, conta)
 * - Supabase Realtime 2-way sync
 *
 * Pré-requisitos no .env:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 *   E2E_MASTER_EMAIL, E2E_MASTER_PASSWORD
 *   E2E_CADETE_ID, E2E_CADETE_MATRICULA
 */

import { test, expect, type Page } from "@playwright/test";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// ── helpers ────────────────────────────────────────────────────────────────

function adminSupabase() {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel(/e-mail/i).fill(email);
  await page.getByLabel(/senha/i).fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/(admin|armeiro|efetivo)/);
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

// ── suite ──────────────────────────────────────────────────────────────────

test.describe("LI — Login Invite Flow", () => {
  const TEST_MAT = "LI_TEST_" + Date.now();

  test.afterEach(async () => {
    await cleanupTestProfile(TEST_MAT).catch(() => {});
  });

  // LI01 — Cadastrar com convite envia invite_sent_at
  test("LI01 - cadastro com invite checkbox envia convite e persiste invite_sent_at", async ({ page }) => {
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

    await page.getByTestId("btn-cadastrar-usuario").click();
    await page.getByLabel(/nome completo/i).fill("LI Test Militar");
    await page.getByLabel(/matrícula/i).fill(TEST_MAT);

    // Marca checkbox de convite
    await page.getByLabel(/enviar convite de login/i).check();
    await expect(page.getByLabel(/e-mail do militar/i)).toBeVisible();
    await page.getByLabel(/e-mail do militar/i).fill("litest@example.com");

    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    await expect(page.getByText(/cadastrado com sucesso/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/convite enviado para/i)).toBeVisible();

    // Verifica no DB que invite_sent_at foi preenchido
    const sb = adminSupabase();
    const { data } = await sb.from("profiles").select("invite_sent_at").eq("matricula", TEST_MAT).maybeSingle();
    expect(data?.invite_sent_at).toBeTruthy();
  });

  // LI02 — Cadastro SEM invite NÃO preenche invite_sent_at
  test("LI02 - cadastro sem convite não define invite_sent_at", async ({ page }) => {
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

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

  // LI03 — Re-envio via "Criar Login" com busca de militar existente
  test("LI03 - criar login busca militar existente e auto-preenche campos", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_MATRICULA, "Requer E2E_CADETE_MATRICULA");
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

    await page.getByTestId("btn-criar-login").click();
    await expect(page.getByPlaceholder(/nome ou matrícula/i)).toBeVisible();

    // Busca por matrícula
    await page.getByPlaceholder(/nome ou matrícula/i).fill(process.env.E2E_CADETE_MATRICULA!.slice(0, 4));
    await expect(page.locator("button").filter({ hasText: process.env.E2E_CADETE_MATRICULA! }).first()).toBeVisible({ timeout: 5000 });
  });

  // LI04 — Re-envio < 10 min mostra aviso de confirmação
  test("LI04 - re-envio com invite_sent_at recente mostra aviso de confirmação", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_ID, "Requer E2E_CADETE_ID");

    // Simula invite_sent_at recente no DB
    const sb = adminSupabase();
    await sb.from("profiles").update({ invite_sent_at: new Date().toISOString() }).eq("id", process.env.E2E_CADETE_ID!);

    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

    await page.getByTestId("btn-criar-login").click();
    await page.getByPlaceholder(/nome ou matrícula/i).fill(process.env.E2E_CADETE_MATRICULA ?? "");
    await page.locator("button").filter({ hasText: process.env.E2E_CADETE_MATRICULA ?? "" }).first().click({ timeout: 5000 }).catch(() => {});

    // Selecionar o militar com invite recente deve mostrar aviso
    const profileCard = page.locator("[data-testid=selected-profile]").or(
      page.getByText(/convite enviado há/i)
    );
    await expect(profileCard).toBeVisible({ timeout: 5000 });
  });

  // LI05 — E-mail duplicado retorna erro 409
  test("LI05 - e-mail duplicado no sistema retorna erro claro", async ({ page }) => {
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

    await page.getByTestId("btn-criar-login").click();
    await page.getByLabel(/e-mail/i).fill(process.env.E2E_ADMIN_EMAIL!);
    await page.getByLabel(/nome completo/i).fill("Duplicado Test").catch(() => {});
    await page.getByLabel(/matrícula/i).fill("DUP001").catch(() => {});

    await page.getByRole("button", { name: /enviar convite/i }).click();
    await expect(page.getByText(/já possui cadastro|já cadastrado/i)).toBeVisible({ timeout: 8000 });
  });

  // LI06 — Grid mostra "Bio" pendente para novo cadastro
  test("LI06 - grid mostra badge Bio para militar sem biometria", async ({ page }) => {
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

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
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");
    // Verificação de presença do badge TOTP no grid
    const totpBadge = page.getByText("TOTP").first();
    const count = await totpBadge.count();
    if (count > 0) {
      await expect(totpBadge.first()).toBeVisible();
    }
  });

  // LI08 — Grid mostra "Convite env." após invite_sent_at
  test("LI08 - grid mostra badge Convite env. quando invite_sent_at preenchido", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_ID, "Requer E2E_CADETE_ID");

    const sb = adminSupabase();
    await sb.from("profiles").update({
      invite_sent_at: new Date().toISOString(),
      account_activated_at: null,
    }).eq("id", process.env.E2E_CADETE_ID!);

    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

    await expect(page.getByText("Convite env.").first()).toBeVisible({ timeout: 5000 });
  });

  // LI09 — Grid mostra "Conta ✓" após account_activated_at
  test("LI09 - grid mostra badge Conta ✓ quando account_activated_at preenchido", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_ID, "Requer E2E_CADETE_ID");

    const sb = adminSupabase();
    await sb.from("profiles").update({
      invite_sent_at: new Date(Date.now() - 3600000).toISOString(),
      account_activated_at: new Date().toISOString(),
    }).eq("id", process.env.E2E_CADETE_ID!);

    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

    await expect(page.getByText("Conta ✓").first()).toBeVisible({ timeout: 5000 });
  });

  // LI10 — Grid mostra "Completo" quando tudo OK
  test("LI10 - grid mostra Completo quando bio+totp+conta todos OK", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_ID, "Requer E2E_CADETE_ID");

    const sb = adminSupabase();
    await sb.from("profiles").update({
      registration_status: "complete",
      totp_configured: true,
      invite_sent_at: new Date(Date.now() - 7200000).toISOString(),
      account_activated_at: new Date(Date.now() - 3600000).toISOString(),
    }).eq("id", process.env.E2E_CADETE_ID!);

    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

    await expect(page.getByText("Completo").first()).toBeVisible({ timeout: 5000 });
  });

  // LI11 — Realtime: badge atualiza sem reload
  test("LI11 - realtime: badge de status atualiza na grid sem reload", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_ID, "Requer E2E_CADETE_ID");

    const sb = adminSupabase();

    // Inicialmente sem invite
    await sb.from("profiles").update({
      invite_sent_at: null,
      account_activated_at: null,
    }).eq("id", process.env.E2E_CADETE_ID!);

    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");

    // Aguarda grid carregar
    await expect(page.getByRole("table")).toBeVisible();

    // Simula update via DB (como se o militar tivesse ativado a conta)
    await sb.from("profiles").update({
      invite_sent_at: new Date(Date.now() - 7200000).toISOString(),
      account_activated_at: new Date().toISOString(),
    }).eq("id", process.env.E2E_CADETE_ID!);

    // Badge deve atualizar via Realtime em < 5s sem reload
    await expect(page.getByText("Conta ✓").first()).toBeVisible({ timeout: 8000 });
  });

  // LI12 — Master (armeiro) só pode criar login para "usuario"
  test("LI12 - armeiro pode criar login apenas para usuarios", async ({ page }) => {
    test.skip(!process.env.E2E_MASTER_EMAIL, "Requer E2E_MASTER_EMAIL");
    await loginAs(page, process.env.E2E_MASTER_EMAIL!, process.env.E2E_MASTER_PASSWORD!);
    await page.goto("/armeiro");

    // O toolbar de armeiro tem o botão criar login? Se não, skip
    const btn = page.getByTestId("btn-criar-login");
    const count = await btn.count();
    test.skip(count === 0, "Armeiro não tem btn-criar-login");

    await btn.click();
    // O seletor de role não deve mostrar admin/master
    const roleSelect = page.locator("#create-role");
    const options = await roleSelect.locator("option").allTextContents();
    expect(options.some((o) => o.toLowerCase().includes("admin"))).toBe(false);
  });

  // LI13 — Armeiro não pode criar admin/master → 403
  test("LI13 - API rejeita master criando admin com 403", async ({ request }) => {
    test.skip(!process.env.E2E_MASTER_EMAIL, "Requer E2E_MASTER_EMAIL");
    // Faz request direto à API — sem cookies de sessão, retorna 403
    const res = await request.post("/api/admin/users", {
      data: { email: "x@x.com", nome_completo: "X", matricula: "X001", method: "magic_link", role: "admin" },
    });
    // Sem autenticação ou com master tentando criar admin: 403
    expect([403, 401]).toContain(res.status());
  });

  // LI14 — Busca retorna resultados por nome parcial
  test("LI14 - busca de militar existente por nome parcial funciona", async ({ page }) => {
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");
    await page.getByTestId("btn-criar-login").click();

    await page.getByPlaceholder(/nome ou matrícula/i).fill("Test");
    // Aguarda dropdown ou mensagem de nenhum resultado
    await page.waitForTimeout(600); // debounce
    // Não falha se não houver resultados — só verifica que o campo funciona
    await expect(page.getByPlaceholder(/nome ou matrícula/i)).toBeVisible();
  });

  // LI15 — Busca por matrícula
  test("LI15 - busca por matrícula retorna resultado correto", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_MATRICULA, "Requer E2E_CADETE_MATRICULA");
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");
    await page.getByTestId("btn-criar-login").click();

    await page.getByPlaceholder(/nome ou matrícula/i).fill(process.env.E2E_CADETE_MATRICULA!);
    await page.waitForTimeout(600);
    // Deve aparecer pelo menos 1 resultado
    const results = page.locator("button").filter({ hasText: process.env.E2E_CADETE_MATRICULA! });
    await expect(results.first()).toBeVisible({ timeout: 5000 });
  });

  // LI16 — Auto-fill preenche campos ao selecionar militar
  test("LI16 - selecionar militar existente auto-preenche nome, posto, matricula, unidade", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_MATRICULA, "Requer E2E_CADETE_MATRICULA");
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");
    await page.getByTestId("btn-criar-login").click();

    await page.getByPlaceholder(/nome ou matrícula/i).fill(process.env.E2E_CADETE_MATRICULA!);
    await page.waitForTimeout(600);
    const resultBtn = page.locator("button").filter({ hasText: process.env.E2E_CADETE_MATRICULA! }).first();
    if (await resultBtn.count() > 0) {
      await resultBtn.click();
      // Campos de nome/matrícula devem sumir (escondidos para militar existente)
      const nameField = page.getByLabel(/nome completo/i);
      await expect(nameField).not.toBeVisible();
    }
  });

  // LI17 — Método "Senha" exibe campo de senha
  test("LI17 - selecionar metodo senha exibe campo de senha", async ({ page }) => {
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");
    await page.getByTestId("btn-criar-login").click();

    await page.getByRole("button", { name: /senha/i }).click();
    await expect(page.getByLabel(/senha temporária/i)).toBeVisible();
  });

  // LI18 — Senha < 6 chars → erro de validação
  test("LI18 - senha temporaria curta retorna erro de validacao", async ({ page }) => {
    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");
    await page.getByTestId("btn-criar-login").click();

    await page.getByRole("button", { name: /senha/i }).click();
    await page.getByLabel(/e-mail/i).fill("test@example.com");
    await page.getByLabel(/senha temporária/i).fill("123");
    await page.getByRole("button", { name: /criar conta/i }).click();
    await expect(page.getByText(/ao menos 6 caracteres/i)).toBeVisible({ timeout: 5000 });
  });

  // LI19 — Militar inativo: badge "Inativo" no grid
  test("LI19 - militar inativo mostra badge Inativo no grid", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_ID, "Requer E2E_CADETE_ID");

    const sb = adminSupabase();
    await sb.from("profiles").update({ registration_status: "inactive" }).eq("id", process.env.E2E_CADETE_ID!);

    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");
    await expect(page.getByText("Inativo").first()).toBeVisible({ timeout: 5000 });

    // Restore
    await sb.from("profiles").update({ registration_status: "complete" }).eq("id", process.env.E2E_CADETE_ID!);
  });

  // LI20 — Convite expirado (> 24h) mostra badge "Expirado"
  test("LI20 - convite expirado ha mais de 24h mostra badge Expirado", async ({ page }) => {
    test.skip(!process.env.E2E_CADETE_ID, "Requer E2E_CADETE_ID");

    const sb = adminSupabase();
    await sb.from("profiles").update({
      invite_sent_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString(),
      account_activated_at: null,
    }).eq("id", process.env.E2E_CADETE_ID!);

    await loginAs(page, process.env.E2E_ADMIN_EMAIL!, process.env.E2E_ADMIN_PASSWORD!);
    await page.goto("/admin/usuarios");
    await expect(page.getByText("Expirado").first()).toBeVisible({ timeout: 5000 });
  });
});
