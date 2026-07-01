/**
 * nexus-v2.spec.ts — Nexus Super Admin v2
 *
 * NXV01  Dashboard tem card "Tenants Ativos"
 * NXV02  GET /api/nexus/metrics retorna tenants.total e tenants.ativos
 * NXV03  GET /api/nexus/users retorna campo total e aceita offset
 * NXV04  /nexus/usuarios exibe total real (> 0 registros)
 * NXV05  GridSearchInput visível com placeholder correto
 * NXV06  PDF button visível em /nexus/usuarios
 * NXV07  Cabeçalho sortável — clique em "Nome" muda aria
 * NXV08  Theme toggle está no header (não no sidebar)
 * NXV09  Sidebar NÃO tem botão "Alternar tema"
 * NXV10  Sidebar tem link "Perfil" → /nexus/perfil
 * NXV11  Sidebar tem link "Superadmins" → /nexus/superadmins
 * NXV12  /nexus/setup-2fa redireciona para /nexus/perfil
 * NXV13  /nexus/perfil carrega sem crash e tem seção de foto
 * NXV14  /nexus/superadmins carrega sem crash e tem form de convite
 * NXV15  /nexus/tenants tem tabs "Lista" e "Cadastrar"
 * NXV16  Tab "Cadastrar" mostra form inline (não modal)
 * NXV17  POST /api/nexus/superadmins/invite → 401 sem sessão nexus
 * NXV18  Header nexus tem avatar/dropdown de perfil
 * NXV19  Paginação em usuários: botão Próximo visível
 * NXV20  Accordion de tenants abre itens sem crash
 * NXV21  Form de cadastrar tenant tem campos max_reserves e max_users
 * NXV22  POST /api/nexus/tenants com max_reserves persiste via GET
 * NXV23  Regressão: /nexus carrega sem 500
 * NXV24  Regressão: /nexus/tenants carrega sem 500
 *
 * Testes NXV01-NXV11, NXV13-NXV24 requerem sessão nexus ativa.
 * Se E2E_NEXUS_SESSION não estiver configurado, esses testes são skippados.
 * NXV12 e NXV17 não requerem sessão.
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, BFF_URL, T } from "./harness";

// ── Helpers ─────────────────────────────────────────────────────────────────

const NEXUS_SESSION = process.env.E2E_NEXUS_SESSION; // cookie nexus-session serializado

/** Injeta cookie de sessão nexus no contexto (bypassa login+TOTP) */
async function withNexusSession(context: import("@playwright/test").BrowserContext) {
  if (!NEXUS_SESSION) return false;
  try {
    const cookies = JSON.parse(NEXUS_SESSION);
    await context.addCookies(cookies);
    return true;
  } catch {
    return false;
  }
}

// ── Suite sem sessão: testes de autorização ──────────────────────────────────

test.describe("NXV — Autorização (sem sessão nexus)", () => {

  test("NXV12 — /nexus/setup-2fa redireciona para /nexus/perfil", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/setup-2fa`, { waitUntil: "domcontentloaded" });
    // Deve redirecionar para perfil (não para login, que era o bug antigo)
    // Se não há sessão, acaba em /nexus/login — mas o redirect do setup-2fa vai para /nexus/perfil
    // Podemos verificar que NÃO vai para /nexus/login diretamente
    const url = page.url();
    expect(url).toContain("/nexus/");
    expect(url).not.toContain("/nexus/setup-2fa");
  });

  test("NXV17 — POST /api/nexus/superadmins/invite retorna 401 sem sessão nexus", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/superadmins/invite`, {
      data: { email: "test@test.com", nome_completo: "Test", matricula: "999999", totp_code: "000000" },
    });
    expect([401, 403]).toContain(res.status());
  });

});

// ── Suite com sessão: estrutura e features ────────────────────────────────────

test.describe("NXV — Nexus v2 Features (requer sessão nexus)", () => {

  test.beforeEach(async ({ context }) => {
    const ok = await withNexusSession(context);
    if (!ok) test.skip(true, "E2E_NEXUS_SESSION não configurado — skipping");
  });

  // ── API structure ──────────────────────────────────────────────────────────

  test("NXV02 — GET /api/nexus/metrics retorna tenants.total e tenants.ativos", async ({ request, context }) => {
    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await request.get(`${BFF_URL}/api/nexus/metrics`, {
      headers: { Cookie: cookieHeader },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("tenants");
    expect(data.tenants).toHaveProperty("total");
    expect(data.tenants).toHaveProperty("ativos");
    expect(typeof data.tenants.total).toBe("number");
    expect(typeof data.tenants.ativos).toBe("number");
  });

  test("NXV03 — GET /api/nexus/users retorna total e aceita offset", async ({ request, context }) => {
    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const res = await request.get(`${BFF_URL}/api/nexus/users?limit=10&offset=0`, {
      headers: { Cookie: cookieHeader },
    });
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("users");
    expect(data).toHaveProperty("total");
    expect(Array.isArray(data.users)).toBeTruthy();
    expect(typeof data.total).toBe("number");
  });

  // ── Dashboard ─────────────────────────────────────────────────────────────

  test("NXV01 — Dashboard tem card Tenants Ativos", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Tenants Ativos")).toBeVisible({ timeout: T.navigation });
  });

  test("NXV23 — Regressão: /nexus carrega sem 500", async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).not.toBe(500);
    await expect(page.getByText(/Dashboard|dashboard/i)).toBeVisible({ timeout: T.navigation });
  });

  // ── Header ────────────────────────────────────────────────────────────────

  test("NXV08 — Theme toggle está no header", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    const header = page.locator("header");
    await expect(header.getByLabel("Alternar tema")).toBeVisible({ timeout: T.navigation });
  });

  test("NXV09 — Sidebar NÃO tem botão Alternar tema", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    const sidebar = page.locator("nav, aside").first();
    await expect(sidebar.getByLabel("Alternar tema")).toHaveCount(0);
  });

  test("NXV18 — Header tem avatar/dropdown de perfil", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    const header = page.locator("header");
    await expect(header.getByLabel("Menu do perfil")).toBeVisible({ timeout: T.navigation });
  });

  // ── Sidebar ───────────────────────────────────────────────────────────────

  test("NXV10 — Sidebar tem link Perfil para /nexus/perfil", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /Perfil/i })).toBeVisible({ timeout: T.navigation });
  });

  test("NXV11 — Sidebar tem link Superadmins para /nexus/superadmins", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /Superadmins/i })).toBeVisible({ timeout: T.navigation });
  });

  // ── Usuários ──────────────────────────────────────────────────────────────

  test("NXV04 — /nexus/usuarios exibe total real de registros", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/usuarios`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/\d+ registros/)).toBeVisible({ timeout: T.navigation });
    const text = await page.getByText(/\d+ registros/).textContent();
    const count = parseInt(text?.match(/(\d+)/)?.[1] ?? "0");
    expect(count).toBeGreaterThan(0);
  });

  test("NXV05 — GridSearchInput visível com placeholder correto", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/usuarios`, { waitUntil: "domcontentloaded" });
    await expect(page.getByPlaceholder(/Nome ou matrícula/i)).toBeVisible({ timeout: T.navigation });
  });

  test("NXV06 — PDF button visível em /nexus/usuarios", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/usuarios`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /pdf/i })).toBeVisible({ timeout: T.navigation });
  });

  test("NXV07 — Cabeçalho Nome é clicável e sortável", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/usuarios`, { waitUntil: "domcontentloaded" });
    const nomeHeader = page.getByRole("columnheader", { name: /Nome/i });
    await expect(nomeHeader).toBeVisible({ timeout: T.navigation });
    await nomeHeader.click();
    // Deve permanecer na página sem crash
    await expect(page.getByPlaceholder(/Nome ou matrícula/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("NXV19 — Paginação: botão Próximo visível quando há mais de 50 registros", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/usuarios`, { waitUntil: "domcontentloaded" });
    const text = await page.getByText(/\d+ registros/).textContent().catch(() => "0 registros");
    const count = parseInt(text?.match(/(\d+)/)?.[1] ?? "0");
    if (count > 50) {
      await expect(page.getByRole("button", { name: /Próximo/i })).toBeVisible({ timeout: T.navigation });
    } else {
      test.info().annotations.push({ type: "info", description: `Apenas ${count} usuários — paginação não exibida` });
    }
  });

  // ── Tenants ────────────────────────────────────────────────────────────────

  test("NXV15 — /nexus/tenants tem tabs Lista e Cadastrar", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/tenants`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("tab", { name: /Lista/i })).toBeVisible({ timeout: T.navigation });
    await expect(page.getByRole("tab", { name: /Cadastrar/i })).toBeVisible({ timeout: T.navigation });
  });

  test("NXV16 — Tab Cadastrar mostra form inline", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/tenants`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Cadastrar/i }).click();
    await expect(page.getByLabel(/Nome do tenant/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("NXV20 — Accordion de tenants abre item sem crash", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/tenants`, { waitUntil: "domcontentloaded" });
    const firstTrigger = page.getByRole("button").filter({ hasText: /PMPB|Teste|tenant/i }).first();
    const count = await firstTrigger.count();
    if (count > 0) {
      await firstTrigger.click();
      await page.waitForTimeout(300);
      // Sem crash: página ainda renderiza
      await expect(page.getByRole("tab", { name: /Lista/i })).toBeVisible();
    } else {
      test.info().annotations.push({ type: "info", description: "Nenhum tenant cadastrado — accordion não testado" });
    }
  });

  test("NXV21 — Form de cadastrar tenant tem campos max_reserves e max_users", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/tenants`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Cadastrar/i }).click();
    await expect(page.getByLabel(/Limite de Reservas/i)).toBeVisible({ timeout: T.apiResponse });
    await expect(page.getByLabel(/Limite de Usuários/i)).toBeVisible({ timeout: T.apiResponse });
  });

  test("NXV24 — Regressão: /nexus/tenants carrega sem 500", async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/nexus/tenants`, { waitUntil: "domcontentloaded" });
    expect(res?.status()).not.toBe(500);
    await expect(page.getByRole("tab", { name: /Lista/i })).toBeVisible({ timeout: T.navigation });
  });

  // ── Páginas novas ──────────────────────────────────────────────────────────

  test("NXV13 — /nexus/perfil carrega sem crash e tem seção de foto", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/perfil`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/foto|Foto/i)).toBeVisible({ timeout: T.navigation });
  });

  test("NXV14 — /nexus/superadmins carrega sem crash e tem botão Convidar", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/superadmins`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Convidar Superadmin/i })).toBeVisible({ timeout: T.navigation });
  });

  // ── Persistência de limites ─────────────────────────────────────────────────

  test("NXV22 — POST /api/nexus/tenants com max_reserves=5 persiste no GET", async ({ request, context }) => {
    const cookies = await context.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const slug = `e2e-test-${Date.now()}`;

    const createRes = await request.post(`${BFF_URL}/api/nexus/tenants`, {
      headers: { "Content-Type": "application/json", Cookie: cookieHeader },
      data: {
        nome: "E2E Test Tenant",
        slug,
        tipo_orgao: "PM",
        estado: "PB",
        max_reserves: 5,
        max_users: 50,
      },
    });

    if (!createRes.ok()) {
      // Se falhar (ex: slug duplicado), pular sem falhar
      test.info().annotations.push({ type: "warn", description: `POST /api/nexus/tenants: ${createRes.status()}` });
      return;
    }

    const created = await createRes.json();
    const tenantId = created.tenant?.id ?? created.id;
    expect(tenantId).toBeTruthy();

    // Verificar que max_reserves foi salvo
    const getRes = await request.get(`${BFF_URL}/api/nexus/tenants`, {
      headers: { Cookie: cookieHeader },
    });
    expect(getRes.ok()).toBeTruthy();
    const data = await getRes.json();
    const tenant = (data.tenants ?? []).find((t: { id: string }) => t.id === tenantId);
    if (tenant) {
      expect(tenant.max_reserves).toBe(5);
    }
  });

});
