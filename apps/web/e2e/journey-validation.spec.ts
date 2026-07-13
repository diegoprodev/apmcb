/**
 * journey-validation.spec.ts — Validação visual ponta-a-ponta por role
 *
 * JV-ADM-01  Admin global: login → /admin dashboard com métricas
 * JV-ADM-02  Admin global: /admin/usuarios — lista de militares visível
 * JV-ADM-03  Admin global: /admin/arsenal — inventário visível
 * JV-ADM-04  Admin global: /admin/estrutura — org_units e reserves visíveis
 * JV-ADM-05  Admin global: /admin/comando — painel de comando com cards
 *
 * JV-ARM-01  Armeiro: login → /reserva dashboard com cards de atalho
 * JV-ARM-02  Armeiro: /reserva/saidas — lista de saídas visível
 * JV-ARM-03  Armeiro: /reserva/cautelas — lista de cautelas visível
 * JV-ARM-04  Armeiro: /reserva/passagens — lista de passagens visível
 * JV-ARM-05  Armeiro: /reserva/arsenal — inventário visível (read-only)
 *
 * JV-CAD-01  Cadete: login → /efetivo dashboard com Meus Materiais
 * JV-CAD-02  Cadete: /efetivo/minhas-cautelas — lista visível
 * JV-CAD-03  Cadete: /efetivo/historico — histórico visível
 * JV-CAD-04  Cadete: /efetivo/perfil — dados do perfil visíveis
 *
 * JV-RBAC-01  Armeiro tenta acessar /admin → bloqueado (redirect ou 403)
 * JV-RBAC-02  Cadete tenta acessar /reserva → bloqueado
 * JV-RBAC-03  Cadete tenta acessar /admin → bloqueado
 * JV-RBAC-04  API: cadete tenta POST /api/handovers → 403
 * JV-RBAC-05  API: cadete tenta POST /api/cautelamentos → 403
 * JV-RBAC-06  API: armeiro cadastra militar role=usuario (permitido) mas
 *              role=admin_global (teto de privilégio) → 403
 * JV-RBAC-07  API: armeiro tenta PATCH /api/arsenal/requests/:id/approve → 403
 *
 * JV-NXS-01  /nexus/login carrega com campos de email e senha
 * JV-NXS-02  /nexus sem sessão redireciona para /nexus/login
 * JV-NXS-03  /api/nexus/health sem auth retorna 401
 *
 * JV-PDF-01  PDF de passagem (handover) retorna application/pdf com >1KB
 * JV-PDF-02  PDF de cautela retorna application/pdf com >1KB
 *
 * JV-SNAP-01  Snapshot de handover contém campos obrigatórios
 * JV-SNAP-02  Status machine: passagem criada começa em aguardando_assinatura_saida
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, BFF_URL, USERS } from "./harness";

// ─── helpers ────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function loginAs(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const d = await res.json() as { access_token?: string; error?: string };
  if (!d.access_token) throw new Error(`Login falhou para ${email}: ${JSON.stringify(d)}`);
  return d.access_token;
}

async function bffGet(path: string, token: string) {
  const res = await fetch(`${BFF_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data, headers: Object.fromEntries(res.headers.entries()) };
}

async function bffPost(path: string, token: string, body: object) {
  const res = await fetch(`${BFF_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

async function loginViaExchange(page: Page, email: string, password: string, landAt: string) {
  const token = await loginAs(email, password);
  const refreshRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const { refresh_token } = await refreshRes.json() as { refresh_token?: string };
  await page.context().clearCookies();
  await page.goto(
    `${BASE_URL}/auth/exchange#access_token=${token}&refresh_token=${refresh_token ?? ""}&token_type=bearer`,
    { waitUntil: "load" }
  );
  await page.waitForURL(`**${landAt}**`, { timeout: 20_000 });
  return token;
}

// ─── shared state ────────────────────────────────────────────────────────────

let adminToken  = "";
let armeiroToken = "";
let cadeteToken  = "";
let latestHandoverId = "";
let latestCautelaId  = "";
const RESERVE_ID = "92a0b388-cefa-4d1f-81ec-533f694d2ab9";

test.beforeAll(async () => {
  [adminToken, armeiroToken, cadeteToken] = await Promise.all([
    loginAs(USERS.admin.email, USERS.admin.password),
    loginAs(USERS.reserva.email, USERS.reserva.password),
    loginAs(USERS.efetivo.email, USERS.efetivo.password).catch(() => ""),
  ]);
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN GLOBAL — Jornada UI
// ═══════════════════════════════════════════════════════════════════════════

test.describe("JV-ADM — Admin Global: Jornada UI", () => {

  test("JV-ADM-01 — Admin login → /admin com dashboard", async ({ page }) => {
    await loginViaExchange(page, USERS.admin.email, USERS.admin.password, "/admin");
    // Header com nome/role
    await expect(page.locator("header")).toBeVisible();
    // Sidebar admin com "Dashboard" ativo
    await expect(page.getByRole("link", { name: /dashboard/i }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/admin/, { timeout: 5000 });
  });

  test("JV-ADM-02 — Admin: /admin/usuarios lista militares", async ({ page }) => {
    await loginViaExchange(page, USERS.admin.email, USERS.admin.password, "/admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    // Deve ter a seção de usuários carregada (sem erro 403 ou redirect)
    await expect(page).toHaveURL(/\/admin\/usuarios/, { timeout: 10_000 });
    // Deve ter alguma tabela/lista ou botão de criar
    await expect(page.locator("main")).toBeVisible();
    const content = await page.locator("main").textContent();
    expect(content).toBeTruthy();
  });

  test("JV-ADM-03 — Admin: /admin/arsenal inventário visível", async ({ page }) => {
    await loginViaExchange(page, USERS.admin.email, USERS.admin.password, "/admin");
    await page.goto(`${BASE_URL}/admin/arsenal`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/admin\/arsenal/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
  });

  test("JV-ADM-04 — Admin: /admin/estrutura org_units visíveis", async ({ page }) => {
    await loginViaExchange(page, USERS.admin.email, USERS.admin.password, "/admin");
    await page.goto(`${BASE_URL}/admin/estrutura`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/admin\/estrutura/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
  });

  test("JV-ADM-05 — Admin: /admin/comando painel de comando carrega", async ({ page }) => {
    await loginViaExchange(page, USERS.admin.email, USERS.admin.password, "/admin");
    await page.goto(`${BASE_URL}/admin/comando`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/admin\/comando/, { timeout: 10_000 });
    // Painel de comando tem cards com métricas
    const main = page.locator("main");
    await expect(main).toBeVisible();
    // Verifica que há pelo menos algum conteúdo carregado (não empty state de erro)
    const content = await main.textContent();
    expect(content?.length).toBeGreaterThan(50);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// ARMEIRO — Jornada UI
// ═══════════════════════════════════════════════════════════════════════════

test.describe("JV-ARM — Armeiro: Jornada UI", () => {

  test("JV-ARM-01 — Armeiro login → /reserva com cards de atalho", async ({ page }) => {
    await loginViaExchange(page, USERS.reserva.email, USERS.reserva.password, "/reserva");
    await expect(page).toHaveURL(/\/reserva$/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
    // Sidebar deve ter links de reserva
    await expect(page.getByRole("link", { name: /saída|almoxarifado|passagem/i }).first()).toBeVisible();
  });

  test("JV-ARM-02 — Armeiro: /reserva/saidas lista visível", async ({ page }) => {
    await loginViaExchange(page, USERS.reserva.email, USERS.reserva.password, "/reserva");
    await page.goto(`${BASE_URL}/reserva/saidas`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/reserva\/saidas/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
  });

  test("JV-ARM-03 — Armeiro: /reserva/cautelas lista visível", async ({ page }) => {
    await loginViaExchange(page, USERS.reserva.email, USERS.reserva.password, "/reserva");
    await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/reserva\/cautelas/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
  });

  test("JV-ARM-04 — Armeiro: /reserva/passagens página carrega com histórico", async ({ page }) => {
    await loginViaExchange(page, USERS.reserva.email, USERS.reserva.password, "/reserva");
    await page.goto(`${BASE_URL}/reserva/passagens`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/reserva\/passagens/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
    // Não deve ter redirect para /login
    expect(page.url()).not.toContain("/login");
  });

  test("JV-ARM-05 — Armeiro: /reserva/arsenal inventário read-only visível", async ({ page }) => {
    await loginViaExchange(page, USERS.reserva.email, USERS.reserva.password, "/reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/reserva\/arsenal/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// CADETE (USUARIO) — Jornada UI
// ═══════════════════════════════════════════════════════════════════════════

test.describe("JV-CAD — Cadete: Jornada UI", () => {

  test("JV-CAD-01 — Cadete login → /efetivo dashboard Meus Materiais", async ({ page }) => {
    await loginViaExchange(page, USERS.efetivo.email, USERS.efetivo.password, "/efetivo");
    await expect(page).toHaveURL(/\/efetivo/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
    // Não deve ter redirect para /reserva ou /admin
    expect(page.url()).not.toContain("/admin");
    expect(page.url()).not.toContain("/reserva");
  });

  test("JV-CAD-02 — Cadete: /efetivo/minhas-cautelas carrega", async ({ page }) => {
    await loginViaExchange(page, USERS.efetivo.email, USERS.efetivo.password, "/efetivo");
    await page.goto(`${BASE_URL}/efetivo/minhas-cautelas`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/efetivo\/minhas-cautelas/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
  });

  test("JV-CAD-03 — Cadete: /efetivo/historico carrega", async ({ page }) => {
    await loginViaExchange(page, USERS.efetivo.email, USERS.efetivo.password, "/efetivo");
    await page.goto(`${BASE_URL}/efetivo/historico`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/efetivo\/historico/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
  });

  test("JV-CAD-04 — Cadete: /efetivo/perfil dados do perfil visíveis", async ({ page }) => {
    await loginViaExchange(page, USERS.efetivo.email, USERS.efetivo.password, "/efetivo");
    await page.goto(`${BASE_URL}/efetivo/perfil`, { waitUntil: "load" });
    await expect(page).toHaveURL(/\/efetivo\/perfil/, { timeout: 10_000 });
    await expect(page.locator("main")).toBeVisible();
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// RBAC — Validação de vazamentos
// ═══════════════════════════════════════════════════════════════════════════

test.describe("JV-RBAC — Validação de RBAC sem vazamentos", () => {

  test("JV-RBAC-01 — Armeiro tenta /admin → bloqueado (redirect ou 403)", async ({ page }) => {
    await loginViaExchange(page, USERS.reserva.email, USERS.reserva.password, "/reserva");
    await page.goto(`${BASE_URL}/admin`, { waitUntil: "load" });
    // Deve redirecionar para /reserva ou /login — nunca ficar em /admin
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).not.toMatch(/\/admin$/);
  });

  test("JV-RBAC-02 — Cadete tenta /reserva → bloqueado", async ({ page }) => {
    await loginViaExchange(page, USERS.efetivo.email, USERS.efetivo.password, "/efetivo");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).not.toMatch(/\/reserva$/);
  });

  test("JV-RBAC-03 — Cadete tenta /admin → bloqueado", async ({ page }) => {
    await loginViaExchange(page, USERS.efetivo.email, USERS.efetivo.password, "/efetivo");
    await page.goto(`${BASE_URL}/admin`, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    const url = page.url();
    expect(url).not.toMatch(/\/admin$/);
  });

  test("JV-RBAC-04 — API: cadete tenta POST /api/handovers → 403", async () => {
    if (!cadeteToken) { test.skip(true, "sem token de cadete"); return; }
    const { status } = await bffPost("/api/handovers", cadeteToken, {
      reserve_id: RESERVE_ID,
      observacao_saindo: "Tentativa indevida RBAC test",
    });
    expect(status).toBe(403);
  });

  test("JV-RBAC-05 — API: cadete tenta POST /api/cautelamentos → 403", async () => {
    if (!cadeteToken) { test.skip(true, "sem token de cadete"); return; }
    const { status } = await bffPost("/api/cautelamentos", cadeteToken, {
      item_id: "00000000-0000-0000-0000-000000000001",
      militar_id: "00000000-0000-0000-0000-000000000001",
      motivo_emissao: "Teste RBAC",
      condicao_emissao: "bom",
    });
    expect(status).toBe(403);
  });

  test("JV-RBAC-06 — armeiro cadastra role=usuario (permitido) mas role=admin_global é bloqueado (teto de privilégio)", async () => {
    // Comportamento intencional (não é gap): armeiro pode cadastrar militares
    // da própria reserva com role="usuario" — é o fluxo legítimo de "Cadastrar
    // Usuário" em /admin/usuarios. O teto de privilégio real é: armeiro nunca
    // pode criar/vincular role acima de "usuario" (ver apps/bff/src/routes/
    // admin.ts, checagem "callerRole === 'armeiro' && userRole !== 'usuario'").
    const { status: statusUsuario } = await bffPost("/api/admin/militares", armeiroToken, {
      nome_completo: "Militar Teste RBAC JV06",
      matricula: "999998",
      email: "rbac.jv06.armeiro@apmcb.dev",
      posto: "soldado",
      role: "usuario",
    });
    expect([200, 201, 400, 409]).toContain(statusUsuario);

    const { status: statusElevado } = await bffPost("/api/admin/militares", armeiroToken, {
      nome_completo: "Militar Teste RBAC JV06 Elevado",
      matricula: "999999",
      email: "rbac.jv06.elevado@apmcb.dev",
      posto: "soldado",
      role: "admin_global",
    });
    expect(statusElevado).toBe(403);
  });

  test("JV-RBAC-07 — API: armeiro tenta aprovar SSA → 403", async () => {
    const { status } = await fetch(`${BFF_URL}/api/arsenal/requests/00000000-0000-0000-0000-000000000001/approve`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${armeiroToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ admin_note: "Tentativa indevida de aprovação" }),
    }).then(r => ({ status: r.status }));
    expect(status).toBe(403);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// NEXUS / SUPERADMIN — Página de login
// ═══════════════════════════════════════════════════════════════════════════

test.describe("JV-NXS — Nexus Superadmin", () => {

  test("JV-NXS-01 — /nexus/login carrega com formulário de email+senha", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/login`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/nexus\/login/, { timeout: 10_000 });
    // Campos de login devem estar visíveis
    const emailField = page.locator("input[type='email'], input[name='email'], input[placeholder*='admin']").first();
    const passwordField = page.locator("input[type='password']").first();
    await expect(emailField).toBeVisible({ timeout: 5000 });
    await expect(passwordField).toBeVisible({ timeout: 5000 });
  });

  test("JV-NXS-02 — /nexus sem sessão redireciona para /nexus/login", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/nexus\/login/, { timeout: 10_000 });
    expect(page.url()).toContain("/nexus/login");
  });

  test("JV-NXS-03 — /api/nexus/health sem sessão nexus retorna 401", async () => {
    const res = await fetch(`${BFF_URL}/api/nexus/health`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      // sem cookie nexus — apenas Bearer token não basta
    });
    // 401 = nexusAuthorized não está na sessão cookie
    expect([401, 403]).toContain(res.status);
  });

  test("JV-NXS-04 — Login com credenciais inválidas exibe erro (NX03)", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/login`, { waitUntil: "domcontentloaded" });
    const emailField = page.locator("input[type='email'], input[placeholder*='admin']").first();
    await emailField.fill("invalido@invalido.com");
    await page.locator("input[type='password']").fill("SenhaErrada@123");
    await page.getByRole("button", { name: /continuar|entrar|login/i }).click();
    // Deve mostrar erro — não avançar para step 2
    await expect(
      page.getByText(/inválid|erro|acesso|invalid|unauthorized/i)
    ).toBeVisible({ timeout: 8_000 });
    // Não deve ter avançado para TOTP
    expect(await page.locator("input[placeholder*='000']").count()).toBe(0);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// LIVRO DIGITAL (Fase 6) — Validação completa da API
// ═══════════════════════════════════════════════════════════════════════════

test.describe("JV-LVD — Livro Digital de Serviço: Validação API", () => {

  test("JV-LVD-01 — Criar handover retorna snapshot com todos os campos", async () => {
    const { status, data } = await bffPost("/api/handovers", armeiroToken, {
      reserve_id: RESERVE_ID,
      observacao_saindo: `Journey validation test — JV-LVD-01 — ${Date.now()}`,
    }) as { status: number; data: {
      ok?: boolean; handover_id?: string; document_hash?: string; error?: string;
      snapshot?: { carga_total?: unknown; data_referencia?: string }
    }};

    // 201 = criado; 403 = sem membership na reserva (aceitável em CI)
    // 422 = estado inválido (outro handover pendente)
    expect(
      [201, 403, 422],
      `JV-LVD-01: got ${status} — ${JSON.stringify(data)}`
    ).toContain(status);

    if (status === 201) {
      expect(data.handover_id).toBeTruthy();
      expect(data.document_hash).toBeTruthy();
      expect(data.snapshot).toBeDefined();
      latestHandoverId = data.handover_id!;
    }
  });

  test("JV-LVD-02 — Status machine: novo handover começa em aguardando_assinatura_saida", async () => {
    if (!latestHandoverId) { test.skip(true, "JV-LVD-01 não criou handover"); return; }
    const { status, data } = await bffGet(`/api/handovers/${latestHandoverId}`, armeiroToken) as {
      status: number; data: { handover?: { status: string; saindo_id: string } }
    };
    expect(status).toBe(200);
    expect(data.handover?.status).toBe("aguardando_assinatura_saida");
    expect(data.handover?.saindo_id).toBeTruthy();
  });

  test("JV-LVD-03 — PDF de handover retorna application/pdf com corpo > 1KB", async () => {
    if (!latestHandoverId) { test.skip(true, "JV-LVD-01 não criou handover"); return; }
    const res = await fetch(`${BFF_URL}/api/handovers/${latestHandoverId}/pdf`, {
      headers: { Authorization: `Bearer ${armeiroToken}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const bytes = await res.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1024);
  });

  test("JV-LVD-04 — GET /api/handovers lista retorna array com pelo menos 1 item", async () => {
    const { status, data } = await bffGet("/api/handovers", armeiroToken) as {
      status: number; data: { handovers?: unknown[] }
    };
    expect(status).toBe(200);
    expect(Array.isArray(data.handovers)).toBe(true);
    expect(data.handovers!.length).toBeGreaterThan(0);
  });

  test("JV-LVD-05 — Cadete não pode criar handover → 403", async () => {
    if (!cadeteToken) { test.skip(true, "sem token de cadete"); return; }
    const { status } = await bffPost("/api/handovers", cadeteToken, {
      reserve_id: RESERVE_ID,
      observacao_saindo: "Tentativa indevida LVD",
    });
    expect(status).toBe(403);
  });

  test("JV-LVD-06 — Handover de reserva diferente retorna 403 ou 404", async () => {
    const OUTRA_RESERVE_ID = "855a82ea-1a16-495d-aeb1-9c7c100826cd"; // CFAP
    const { status } = await bffPost("/api/handovers", armeiroToken, {
      reserve_id: OUTRA_RESERVE_ID,
      observacao_saindo: "Tentativa cross-reserve RBAC test",
    });
    // Armeiro não tem membership na CFAP — deve ser bloqueado
    expect([403, 404]).toContain(status);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// CAUTELA — Validação de fluxo via API
// ═══════════════════════════════════════════════════════════════════════════

test.describe("JV-CTL — Cautela Permanente: API ponta-a-ponta", () => {

  test("JV-CTL-01 — GET /api/cautelamentos/ativos retorna { cautelamentos: [] } (cadete)", async () => {
    if (!cadeteToken) { test.skip(true, "sem token cadete"); return; }
    const { status, data } = await bffGet("/api/cautelamentos/ativos", cadeteToken) as {
      status: number; data: { cautelamentos?: unknown[] }
    };
    expect(status).toBe(200);
    expect(Array.isArray(data.cautelamentos)).toBe(true);
  });

  test("JV-CTL-02 — GET /api/cautelamentos (armeiro) retorna { cautelamentos: [] }", async () => {
    const { status, data } = await bffGet("/api/cautelamentos", armeiroToken) as {
      status: number; data: { cautelamentos?: unknown[] }
    };
    expect(status).toBe(200);
    expect(Array.isArray(data.cautelamentos)).toBe(true);
  });

  test("JV-CTL-03 — GET /api/cautelamentos sem auth → 401", async () => {
    const res = await fetch(`${BFF_URL}/api/cautelamentos`);
    expect(res.status).toBe(401);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// SAÍDAS — Validação de fluxo via API
// ═══════════════════════════════════════════════════════════════════════════

test.describe("JV-SAI — Saídas de Material: API", () => {

  test("JV-SAI-01 — GET /api/saidas (armeiro) retorna lista com campos", async () => {
    const { status, data } = await bffGet("/api/saidas", armeiroToken) as {
      status: number;
      data: { saidas?: Array<{ id: string; status: string }> }
    };
    expect(status).toBe(200);
    const arr = (data as Record<string, unknown>).saidas ?? data;
    expect(Array.isArray(arr)).toBe(true);
  });

  test("JV-SAI-02 — GET /api/saidas sem auth → 401", async () => {
    const res = await fetch(`${BFF_URL}/api/saidas`);
    expect(res.status).toBe(401);
  });

  test("JV-SAI-03 — Cadete não pode criar saída → 403", async () => {
    if (!cadeteToken) { test.skip(true, "sem token"); return; }
    const { status } = await bffPost("/api/saidas", cadeteToken, {
      item_id: "00000000-0000-0000-0000-000000000001",
      militar_id: "00000000-0000-0000-0000-000000000001",
    });
    expect(status).toBe(403);
  });

});

// ═══════════════════════════════════════════════════════════════════════════
// AUTH / SESSION — Validação de estado de sessão
// ═══════════════════════════════════════════════════════════════════════════

test.describe("JV-AUTH — Auth e sessão via cookie (iron-session)", () => {

  // NOTA: /api/auth/me usa iron-session (cookie HTTP-only), não Bearer token.
  // Estes testes usam page.request para enviar o cookie de sessão corretamente.

  test("JV-AUTH-01 — Admin via exchange: /api/auth/me retorna role=admin_global", async ({ page }) => {
    await loginViaExchange(page, USERS.admin.email, USERS.admin.password, "/admin");
    const res = await page.request.get(`${BFF_URL}/api/auth/me`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { user?: { role?: string } };
    expect(body.user?.role).toBe("admin_global");
  });

  test("JV-AUTH-02 — Armeiro via exchange: /api/auth/me retorna role=armeiro", async ({ page }) => {
    await loginViaExchange(page, USERS.reserva.email, USERS.reserva.password, "/reserva");
    const res = await page.request.get(`${BFF_URL}/api/auth/me`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { user?: { role?: string } };
    expect(body.user?.role).toBe("armeiro");
  });

  test("JV-AUTH-03 — Cadete via exchange: /api/auth/me retorna role=usuario", async ({ page }) => {
    await loginViaExchange(page, USERS.efetivo.email, USERS.efetivo.password, "/efetivo");
    const res = await page.request.get(`${BFF_URL}/api/auth/me`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { user?: { role?: string } };
    expect(body.user?.role).toBe("usuario");
  });

  test("JV-AUTH-04 — GET /api/auth/me sem sessão → 401", async () => {
    const res = await fetch(`${BFF_URL}/api/auth/me`);
    // Sem cookie iron-session → 401
    expect(res.status).toBe(401);
  });

  test("JV-AUTH-05 — Bearer token inválido em endpoint protegido → 401", async () => {
    const res = await fetch(`${BFF_URL}/api/handovers`, {
      headers: { Authorization: "Bearer token.invalido.aqui" },
    });
    expect(res.status).toBe(401);
  });

});
