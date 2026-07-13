/**
 * APMCB — E2E Harness: Gestão de Usuários (Cadastro + Login)
 *
 * Dialog único "Cadastrar Usuário" com toggle interno "Novo militar" /
 * "Militar já cadastrado" — antes eram dois botões/dialogs separados
 * ("Cadastrar Usuário" sem login + "Criar Login" buscando um militar
 * existente), unificados a pedido do dono do produto (redundante/confuso).
 * Ver apps/web/src/app/(dashboard)/admin/usuarios/_cadastrar-militar-dialog.tsx.
 *
 * Validações:
 *   - Botão único visível na toolbar, com toggle de modo dentro do dialog
 *   - Modal abre corretamente nos dois modos
 *   - Campos obrigatórios bloqueiam submit
 *   - Modo "Novo militar": fluxo completo com confirmação visual, com e sem convite
 *   - Convite (checkbox no modo novo): método magic link/senha, campo de senha
 *   - API /api/admin/militares retorna 403 sem sessão
 *   - API /api/admin/users retorna 403 sem sessão
 *   - Edição com campos unidade/telefone
 *   - Logo APMCB no sidebar
 */

import { test, expect, request as playwrightRequest } from "@playwright/test";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { BASE_URL, BFF_URL, login, T, USERS } from "./harness";

function adminSupabase() {
  return createSupabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

// ─── Suite: Toolbar ───────────────────────────────────────────────────────────

test.describe("Admin — Toolbar de Usuários", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });
  });

  test("U01 — botão 'Cadastrar Usuário' visível", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /cadastrar usuário/i })
    ).toBeVisible();
  });

  test("U02 — toggle 'Militar já cadastrado' visível dentro do dialog único", async ({ page }) => {
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("cm-mode-existente")).toBeVisible({ timeout: T.animation * 4 });
  });
});

// ─── Suite: Cadastrar Usuário (sem login) ─────────────────────────────────────

test.describe("Admin — Cadastrar Usuário (sem credenciais)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });
  });

  test("U03 — modal Cadastrar Usuário abre com opção de convite de login em separado", async ({ page }) => {
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/cadastrar usuário/i)).toBeVisible({
      timeout: T.animation * 4,
    });
    // O aviso fixo "não cria credenciais de login" foi substituído por um
    // checkbox opcional ("Enviar convite de login agora") no mesmo modal —
    // por padrão desmarcado, ou seja, o cadastro continua sem login.
    await expect(dialog.getByText(/enviar convite de login agora/i)).toBeVisible();
  });

  test("U04 — submit bloqueado sem nome ou matrícula", async ({ page }) => {
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: /^cadastrar usuário$/i })
    ).toBeDisabled({ timeout: T.animation * 4 });
  });

  test("U05 — cadastrar usuário sem login e verificar na lista", async ({ page }) => {
    const id = uid();
    const matricula = `CM${id.toUpperCase()}`;
    const nome = `Sgt Cadastro ${id}`;

    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    await dialog.getByLabel(/nome completo/i).fill(nome);
    await dialog.getByLabel(/matrícula/i).fill(matricula);
    await dialog.getByLabel(/unidade/i).fill("2ª Cia");
    await dialog.getByLabel(/telefone/i).fill("(83) 9 7777-6666");

    // Captura resposta da API para diagnóstico em caso de falha
    const apiResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/militares") && r.request().method() === "POST",
      { timeout: T.apiResponse * 3 }
    );

    const submitBtn = dialog.getByRole("button", { name: /^cadastrar usuário$/i });
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });
    await submitBtn.click();

    const apiResp = await apiResponsePromise;
    const apiBody = await apiResp.json().catch(() => ({}));
    // Falha descritiva se a API retornar erro
    expect(
      apiResp.status(),
      `API /api/admin/militares retornou ${apiResp.status()}: ${JSON.stringify(apiBody)}`
    ).toBe(200);

    // Tela de confirmação — cadastro sem convite orienta reabrir o dialog no
    // modo "Militar já cadastrado" quando quiser provisionar o login depois.
    await expect(dialog.getByText(/cadastrado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse * 2,
    });
    await expect(dialog.getByText(/militar já cadastrado/i)).toBeVisible();

    await dialog.getByRole("button", { name: /fechar/i }).click();

    // Aparece na lista
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill(matricula);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText(matricula)).toBeVisible({ timeout: T.navigation });
  });
});

// ─── Suite: Convite de login (dentro do dialog único, modo "Novo militar") ────

test.describe("Admin — Convite de login no cadastro unificado", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });
  });

  test("U06 — seção de convite mostra seleção de método ao marcar o checkbox", async ({ page }) => {
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/cadastrar usuário/i)).toBeVisible({ timeout: T.animation * 4 });
    await dialog.getByLabel(/enviar convite de login agora/i).check();
    await expect(dialog.getByText(/magic link/i)).toBeVisible();
    await expect(dialog.getByText(/^senha$/i)).toBeVisible();
  });

  test("U07 — campo senha oculto com Magic Link selecionado (padrão)", async ({ page }) => {
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/enviar convite de login agora/i).check();
    await expect(dialog.getByLabel(/senha temporária/i)).not.toBeVisible({
      timeout: T.animation * 4,
    });
  });

  test("U08 — campo senha visível ao selecionar método Senha", async ({ page }) => {
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/enviar convite de login agora/i).check();
    await dialog.getByRole("button", { name: /^senha$/i }).click();
    await expect(dialog.getByLabel(/senha temporária/i)).toBeVisible();
  });

  test("U09 — modo 'Militar já cadastrado': submit bloqueado sem selecionar ninguém", async ({ page }) => {
    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByTestId("cm-mode-existente").click();
    await expect(dialog.getByTestId("cm-submit-btn")).toBeDisabled({ timeout: T.animation * 4 });
  });

  test("U10 — cadastrar militar com convite (senha) em um único passo e verificar na lista", async ({ page }) => {
    const id = uid();
    const email = `e2e.login.${id}@apmcb.test`;
    const matricula = `LG${id.toUpperCase()}`;
    const nome = `Cap Login ${id}`;

    await page.getByRole("button", { name: /cadastrar usuário/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    await dialog.getByLabel(/nome completo/i).fill(nome);
    await dialog.getByLabel(/matrícula/i).fill(matricula);
    await dialog.getByLabel(/unidade/i).fill("E2E Teste");

    await dialog.getByLabel(/enviar convite de login agora/i).check();
    await dialog.getByRole("button", { name: /^senha$/i }).click();
    await dialog.getByLabel(/e-mail do usuário/i).fill(email);
    await dialog.getByLabel(/senha temporária/i).fill("TesteE2E@123");

    const submitBtn = dialog.getByTestId("cm-submit-btn");
    await expect(submitBtn).toBeEnabled({ timeout: 2000 });

    // Captura as duas chamadas — cadastro do militar (BFF) e provisionamento
    // de acesso (Next edge route) — para diagnóstico em caso de falha.
    const militaresRespPromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/militares") && r.request().method() === "POST",
      { timeout: T.apiResponse * 3 }
    );
    const usersRespPromise = page.waitForResponse(
      (r) => r.url().includes("/api/admin/users") && r.request().method() === "POST",
      { timeout: T.apiResponse * 3 }
    );
    await submitBtn.click();

    const militaresResp = await militaresRespPromise;
    const militaresBody = await militaresResp.json().catch(() => ({}));
    expect(
      militaresResp.status(),
      `API /api/admin/militares retornou ${militaresResp.status()}: ${JSON.stringify(militaresBody)}`
    ).toBe(200);

    const usersResp = await usersRespPromise;
    const usersBody = await usersResp.json().catch(() => ({}));
    expect(
      usersResp.status(),
      `API /api/admin/users retornou ${usersResp.status()}: ${JSON.stringify(usersBody)}`
    ).toBe(200);

    await expect(dialog.getByText(/cadastrado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse * 2,
    });
    await expect(dialog.getByText(/convite enviado para/i)).toBeVisible();

    await dialog.getByRole("button", { name: /fechar/i }).click();

    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    const searchInput = page.getByPlaceholder(/buscar/i);
    if (await searchInput.isVisible()) {
      await searchInput.fill(matricula);
      await page.waitForTimeout(400);
    }
    await expect(page.getByText(matricula)).toBeVisible({ timeout: T.navigation });
  });
});

// ─── Suite: Segurança / API ───────────────────────────────────────────────────

test.describe("Segurança — endpoints admin protegidos", () => {
  test("U11 — /api/admin/militares (BFF) retorna 401/403 sem sessão", async () => {
    // O dialog chama o BFF diretamente (${BFF_URL}/api/admin/militares), não
    // uma rota relativa Next.js — não existe (nem nunca existiu no fluxo
    // real) uma rota Next intermediária para essa ação; testar contra o BFF
    // é o que de fato protege o caminho usado em produção.
    const ctx = await playwrightRequest.newContext();
    const res = await ctx.post(`${BFF_URL}/api/admin/militares`, {
      data: { nome_completo: "Hacker", matricula: "HACK001" },
    });
    expect([401, 403]).toContain(res.status());
    await ctx.dispose();
  });

  test("U12 — /api/admin/users retorna 403 sem sessão", async () => {
    const ctx = await playwrightRequest.newContext();
    const res = await ctx.post(`${BASE_URL}/api/admin/users`, {
      data: { email: "hacker@evil.com", nome_completo: "X", matricula: "X", method: "magic_link" },
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });

  // U16 — Regressão do achado CRÍTICO em code review: o branch "re-invite"
  // de /api/admin/users (existing_user_id) trocava o e-mail de login de
  // QUALQUER profile sem checar tenant ou teto de privilégio — um armeiro
  // (teto: só provisiona acesso para role "usuario") conseguia sequestrar o
  // login de um admin_global do mesmo tenant só sabendo o UUID do profile.
  test("U16 — armeiro não pode provisionar/sequestrar acesso de um profile com role acima do teto", async ({ page }) => {
    await login(page, "reserva"); // USERS.reserva.role === "armeiro"

    // Alvo: o próprio profile admin_global de teste (role acima do teto do
    // armeiro, que só pode provisionar acesso para role "usuario"). Não
    // precisamos de um alvo diferente do armeiro logado para provar o
    // gate — qualquer profile com role != "usuario" deve ser rejeitado.
    const sb = adminSupabase();
    const { data: target } = await sb
      .from("profiles")
      .select("id")
      .eq("matricula", USERS.admin.matricula)
      .maybeSingle();
    test.skip(!target?.id, "Não foi possível resolver o profile admin de teste");

    const res = await page.request.post(`${BASE_URL}/api/admin/users`, {
      data: {
        email: `e2e.idor.${Date.now()}@apmcb.test`,
        method: "magic_link",
        existing_user_id: target!.id,
      },
    });
    // 403 (teto de privilégio) — nunca 200. Sem o fix, isto trocava o
    // e-mail de login do admin_global e mandava magic link pro atacante.
    expect(res.status()).toBe(403);

    // Confirma que o e-mail do admin NÃO foi alterado (o bug de verdade
    // seria isso silenciosamente ter mudado mesmo com um 403 tardio).
    const { data: after } = await sb.from("profiles").select("email").eq("id", target!.id).maybeSingle();
    expect(after?.email).toBe(USERS.admin.email);
  });
});

// ─── Suite: Edição de campos estendidos ──────────────────────────────────────

test.describe("Admin — Edição de Usuário: campos estendidos", () => {
  test("U13 — campos unidade e telefone presentes no modal de edição", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });

    await page.getByRole("button", { name: /editar/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel(/unidade/i)).toBeVisible({ timeout: T.animation * 4 });
    await expect(dialog.getByLabel(/telefone/i)).toBeVisible();
  });

  test("U14 — salvar unidade e telefone via modal de edição", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: /usuários/i })).toBeVisible({
      timeout: T.navigation,
    });

    await page.getByRole("button", { name: /editar/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.animation * 4 });

    await dialog.getByLabel(/unidade/i).clear();
    await dialog.getByLabel(/unidade/i).fill("Sede APMCB");
    await dialog.getByLabel(/telefone/i).clear();
    await dialog.getByLabel(/telefone/i).fill("(83) 9 8888-7777");
    await dialog.getByRole("button", { name: /salvar/i }).click();

    await expect(page.getByText(/atualizado com sucesso/i)).toBeVisible({
      timeout: T.apiResponse,
    });
  });
});

// ─── Suite: Sidebar logo ─────────────────────────────────────────────────────

test.describe("UI — Sidebar com logo", () => {
  test("U15 — logo APMCB visível no sidebar expandido", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin`, { waitUntil: "load" });
    await expect(
      page.locator('aside img[alt="APMCB"]')
    ).toBeVisible({ timeout: T.navigation });
  });
});
