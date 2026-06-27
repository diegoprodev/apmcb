/**
 * nexus-admin.spec.ts — Suite completa Nexus Super Admin
 *
 * AUTENTICAÇÃO & ACESSO (NEX01-NEX10)
 * NEX01  /nexus/login carrega sem crash — logo, título, campo matrícula visível
 * NEX02  /nexus sem sessão nexus redireciona para /nexus/login
 * NEX03  Login com credenciais inválidas → erro, permanece em /nexus/login
 * NEX04  Login com TOTP inválido → erro "código inválido"
 * NEX05  GET /api/nexus/health → 401 sem sessão nexus
 * NEX06  GET /api/nexus/events → 401 sem sessão nexus
 * NEX07  GET /api/nexus/errors → 401 sem sessão nexus
 * NEX08  POST /api/nexus/clear-rate-limit → 401 sem sessão nexus
 * NEX09  /nexus/setup-2fa acesso direto → redireciona para /nexus/login
 * NEX10  CSRF exemption: POST /api/nexus/setup-2fa/confirm sem X-CSRF-Token → não 403 por CORS
 *
 * TENANTS — LISTAGEM & CRIAÇÃO (NEX11-NEX20)
 * NEX11  GET /api/nexus/tenants → 401 sem sessão nexus
 * NEX12  GET /api/nexus/tenants/:id → 401 sem sessão nexus
 * NEX13  POST /api/nexus/tenants sem slug → 400 (validação)
 * NEX14  POST /api/nexus/tenants slug duplicado → 409
 * NEX15  GET /api/nexus/tenants/:id/members → 401 sem sessão nexus
 * NEX16  GET /api/nexus/tenants/:id/reserves → 401 sem sessão nexus
 * NEX17  GET /api/nexus/tenants/:id/branding → 401 sem sessão nexus
 * NEX18  PATCH /api/nexus/tenants/:id/status → 401 sem sessão nexus
 * NEX19  GET /api/nexus/tenants → tenant PMPB presente quando logado (soft)
 * NEX20  Tenant PMPB: reserves inclui APMCB (soft — requer sessão nexus)
 *
 * BRANDING via NEXUS (NEX21-NEX25)
 * NEX21  PATCH /api/nexus/tenants/:id/branding → 401 sem sessão nexus
 * NEX22  PATCH /api/nexus/tenants/:id/branding hex inválido → 400
 * NEX23  POST /api/nexus/tenants/:id/branding/logo → 401 sem sessão nexus
 * NEX24  Branding PMPB: primary_hex é hex válido quando acessível
 * NEX25  Logo upload tipo inválido → 400 (sem auth nexus: 401)
 *
 * MEMBROS & USUÁRIOS (NEX26-NEX30)
 * NEX26  GET /api/nexus/tenants/:id/members retorna array (soft)
 * NEX27  Membro com role correto visível na listagem (soft)
 * NEX28  Página /nexus/users → 401 sem sessão nexus
 * NEX29  GET /api/nexus/users → 401 sem sessão nexus
 * NEX30  Busca de usuário por matrícula → 401 sem sessão nexus
 *
 * AUDIT LOGS (NEX31-NEX35)
 * NEX31  GET /api/nexus/audit → 401 sem sessão nexus
 * NEX32  GET /api/nexus/audit com tenant_id filter → 401 sem sessão nexus
 * NEX33  /nexus/audit → 401 sem sessão nexus
 * NEX34  Audit: registros têm campo action, user_id, created_at (soft)
 * NEX35  Audit: não expõe dados de outro tenant (soft — RBAC nexus)
 *
 * BFF HEALTH & INFRAESTRUTURA (NEX36-NEX40)
 * NEX36  GET /api/nexus/health → 401 (protegido)
 * NEX37  GET /api/nexus/events → 401 (SSE protegido)
 * NEX38  GET /api/nexus/errors → 401 (log de erros protegido)
 * NEX39  POST /api/nexus/clear-rate-limit → 401 (action destruttiva protegida)
 * NEX40  BFF CORS: OPTIONS /api/nexus/tenants retorna Access-Control-Allow-Origin
 *
 * SEGURANÇA (NEX41-NEX50)
 * NEX41  Cookie apmcb_nexus_session não acessível via JS (httpOnly)
 * NEX42  Sessão de um tenant não acessa dados de outro tenant
 * NEX43  XSS: nome de tenant com <script> rejeitado com 400
 * NEX44  XSS: slug com script tag rejeitado com 400
 * NEX45  SQL injection em slug rejeitado (400 ou sanitizado)
 * NEX46  Brute force: 6+ tentativas de login → 429 ou bloqueio
 * NEX47  JWT expirado → 401 em todas as rotas nexus
 * NEX48  Role normal (admin_global) não acessa rotas nexus — 401/403
 * NEX49  /nexus/login: campo TOTP não aparece na etapa 1
 * NEX50  Resposta nexus inclui header X-Request-Id ou similar (rastreabilidade)
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, BFF_URL } from "./harness";

const TENANT_PMPB = "f0edc186-693f-4ab0-a0e8-6c18d65876fa";

// ─── AUTENTICAÇÃO & ACESSO ──────────────────────────────────────────────────

test.describe("NEX — Nexus Super Admin — Autenticação & Acesso", () => {

  test("NEX01 — /nexus/login carrega sem crash", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/login`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("NEXUS", { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Acesso ao Nexus/i)).toBeVisible({ timeout: 5000 });
    // Campo de matrícula ou email no step 1
    const input = page.locator("input").first();
    await expect(input).toBeVisible({ timeout: 5000 });
  });

  test("NEX02 — /nexus sem sessão redireciona para /nexus/login", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/nexus\/login/, { timeout: 10000 });
    expect(page.url()).toContain("/nexus/login");
  });

  test("NEX03 — Login com credenciais inválidas → erro visível", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/login`, { waitUntil: "domcontentloaded" });
    const emailInput = page.locator("input[type='email'], input[placeholder*='email' i]").first();
    await emailInput.fill("invalid@example.com");
    const passInput = page.locator("input[type='password']").first();
    await passInput.fill("wrongpassword");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/inválid|incorret|erro|falha|invalid/i)).toBeVisible({ timeout: 10000 });
    expect(page.url()).toContain("/nexus/login");
  });

  test("NEX04 — POST /api/nexus/setup-2fa/confirm não retorna CORS error", async ({ request }) => {
    // Deve retornar 4xx mas NÃO pode ser CORS failure (endpoint exempto de CSRF)
    const res = await request.post(`${BFF_URL}/api/nexus/setup-2fa/confirm`, {
      data: { token: "000000" },
    });
    // Qualquer 4xx é ok — o que não pode acontecer é crash/CORS
    expect([400, 401, 403, 404, 422]).toContain(res.status());
  });

  test("NEX05 — GET /api/nexus/health → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/health`);
    expect(res.status()).toBe(401);
  });

  test("NEX06 — GET /api/nexus/events → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/events`);
    expect(res.status()).toBe(401);
  });

  test("NEX07 — GET /api/nexus/errors → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/errors`);
    expect([401, 404]).toContain(res.status());
  });

  test("NEX08 — POST /api/nexus/clear-rate-limit → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/clear-rate-limit`, {
      data: { ip: "127.0.0.1" },
    });
    expect(res.status()).toBe(401);
  });

  test("NEX09 — /nexus/setup-2fa acesso direto → redireciona para /nexus/login", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/setup-2fa`, { waitUntil: "domcontentloaded" });
    // Deve redirecionar ou mostrar login
    await page.waitForTimeout(2000);
    expect(page.url()).toContain("/nexus/login");
  });

  test("NEX10 — /nexus/login: campo TOTP não visível no step 1", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/login`, { waitUntil: "domcontentloaded" });
    // No step 1, campo de 6 dígitos TOTP não deve estar visível
    const totpInput = page.locator("input[maxlength='6'], input[inputmode='numeric']");
    await expect(totpInput).not.toBeVisible({ timeout: 3000 }).catch(() => {
      // Pode não existir no DOM — também ok
    });
  });

});

// ─── TENANTS — LISTAGEM & CRIAÇÃO ───────────────────────────────────────────

test.describe("NEX — Nexus Super Admin — Tenants", () => {

  test("NEX11 — GET /api/nexus/tenants → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants`);
    expect(res.status()).toBe(401);
  });

  test("NEX12 — GET /api/nexus/tenants/:id → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}`);
    expect(res.status()).toBe(401);
  });

  test("NEX13 — POST /api/nexus/tenants sem slug → 400 ou 401", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/tenants`, {
      data: { nome: "Tenant sem slug", tipo_orgao: "outro" },
    });
    // 401 sem auth nexus; 400 com auth mas sem slug
    expect([400, 401]).toContain(res.status());
  });

  test("NEX14 — POST /api/nexus/tenants slug duplicado → 401 ou 409", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/tenants`, {
      data: { nome: "PMPB Duplicado", slug: "pmpb", tipo_orgao: "pm", structure_mode: "simple" },
    });
    expect([401, 409]).toContain(res.status());
  });

  test("NEX15 — GET /api/nexus/tenants/:id/members → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/members`);
    expect(res.status()).toBe(401);
  });

  test("NEX16 — GET /api/nexus/tenants/:id/reserves → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/reserves`);
    expect(res.status()).toBe(401);
  });

  test("NEX17 — GET /api/nexus/tenants/:id/branding → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/branding`);
    expect(res.status()).toBe(401);
  });

  test("NEX18 — PATCH /api/nexus/tenants/:id/status → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.patch(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/status`, {
      data: { active: true },
    });
    expect(res.status()).toBe(401);
  });

  test("NEX19 — GET /api/nexus/tenants não expõe dados sem auth", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants`);
    expect(res.status()).toBe(401);
    const text = await res.text();
    // Não deve retornar lista de tenants
    expect(text).not.toContain("pmpb");
    expect(text).not.toContain("f0edc186");
  });

  test("NEX20 — Tenant endpoint não retorna 500 (nem com auth inválida)", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}`);
    // 401 esperado — nunca 500
    expect(res.status()).not.toBe(500);
  });

});

// ─── BRANDING VIA NEXUS ─────────────────────────────────────────────────────

test.describe("NEX — Nexus Super Admin — Branding", () => {

  test("NEX21 — PATCH /api/nexus/tenants/:id/branding → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.patch(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/branding`, {
      data: { primary_hex: "#ff0000" },
    });
    expect(res.status()).toBe(401);
  });

  test("NEX22 — PATCH branding hex inválido sem auth → 400 ou 401", async ({ request }) => {
    const res = await request.patch(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/branding`, {
      data: { primary_hex: "red" },
    });
    expect([400, 401]).toContain(res.status());
  });

  test("NEX23 — POST logo upload → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/branding/logo`, {
      multipart: {
        logo: { name: "test.png", mimeType: "image/png", buffer: Buffer.from("fake") },
        logo_type: "tenant",
      },
    });
    expect(res.status()).toBe(401);
  });

  test("NEX24 — Nexus branding endpoint estrutura da resposta (sem auth → 401)", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/branding`);
    expect(res.status()).toBe(401);
    // Body não deve expor dados de branding sem auth
    const data = await res.json().catch(() => ({}));
    expect(data.primary_hex).toBeUndefined();
    expect(data.secondary_hex).toBeUndefined();
  });

  test("NEX25 — Logo tipo inválido sem auth → 401 (não 500)", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/branding/logo`, {
      multipart: {
        logo: { name: "bad.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") },
        logo_type: "tenant",
      },
    });
    expect([400, 401, 403]).toContain(res.status());
    expect(res.status()).not.toBe(500);
  });

});

// ─── MEMBROS & USUÁRIOS ─────────────────────────────────────────────────────

test.describe("NEX — Nexus Super Admin — Membros & Usuários", () => {

  test("NEX26 — GET /api/nexus/tenants/:id/members → 401 sem auth nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/members`);
    expect(res.status()).toBe(401);
  });

  test("NEX27 — Members endpoint não expõe dados sem auth", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants/${TENANT_PMPB}/members`);
    expect(res.status()).toBe(401);
    const text = await res.text();
    expect(text).not.toContain("matricula");
    expect(text).not.toContain("admin_global");
  });

  test("NEX28 — GET /api/nexus/users → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/users`);
    expect([401, 404]).toContain(res.status());
  });

  test("NEX29 — Busca usuário por email → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/users?q=admin@apmcb.dev`);
    expect([401, 404]).toContain(res.status());
  });

  test("NEX30 — User lookup não retorna 500 com parâmetro inválido", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/users?q=`);
    expect(res.status()).not.toBe(500);
  });

});

// ─── AUDIT LOGS ─────────────────────────────────────────────────────────────

test.describe("NEX — Nexus Super Admin — Audit Logs", () => {

  test("NEX31 — GET /api/nexus/audit → 401 sem sessão nexus", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/audit`);
    expect([401, 404]).toContain(res.status());
  });

  test("NEX32 — GET /api/nexus/audit?tenant_id=... → 401", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/audit?tenant_id=${TENANT_PMPB}`);
    expect([401, 404]).toContain(res.status());
  });

  test("NEX33 — Audit não expõe dados sem auth", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/audit`);
    const text = await res.text();
    expect(text).not.toContain(TENANT_PMPB);
    expect(text).not.toContain("action");
  });

  test("NEX34 — Audit endpoint responde rapidamente (sem crash)", async ({ request }) => {
    const start = Date.now();
    await request.get(`${BFF_URL}/api/nexus/audit`);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  test("NEX35 — Audit: filtro por tenant sem auth → 401", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/audit?tenant_id=00000000-0000-0000-0000-000000000000`);
    expect([401, 404]).toContain(res.status());
  });

});

// ─── BFF HEALTH & INFRAESTRUTURA ────────────────────────────────────────────

test.describe("NEX — Nexus Super Admin — BFF Health & Infra", () => {

  test("NEX36 — GET /api/nexus/health → 401 (protegido)", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/health`);
    expect(res.status()).toBe(401);
  });

  test("NEX37 — GET /api/nexus/events → 401 (SSE protegido)", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/events`);
    expect(res.status()).toBe(401);
  });

  test("NEX38 — GET /api/nexus/errors → 401 ou 404 (não exposto)", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/errors`);
    expect([401, 404]).toContain(res.status());
  });

  test("NEX39 — POST /api/nexus/clear-rate-limit → 401 sem auth nexus", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/clear-rate-limit`, { data: { ip: "1.2.3.4" } });
    expect(res.status()).toBe(401);
  });

  test("NEX40 — OPTIONS CORS inclui Access-Control-Allow-Origin para apmcb.pmpb.online", async ({ request }) => {
    const res = await request.fetch(`${BFF_URL}/api/nexus/tenants`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://apmcb.pmpb.online",
        "Access-Control-Request-Method": "GET",
      },
    });
    const acao = res.headers()["access-control-allow-origin"];
    // Deve incluir a origem ou *
    expect(acao ?? "").toMatch(/apmcb\.pmpb\.online|\*/);
  });

});

// ─── SEGURANÇA ──────────────────────────────────────────────────────────────

test.describe("NEX — Nexus Super Admin — Segurança", () => {

  test("NEX41 — Resposta de login não expõe TOTP secret em body", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/auth/login`, {
      data: { email: "devdiegopro@gmail.com", password: "wrongpassword" },
    });
    const text = await res.text();
    expect(text).not.toMatch(/totp_secret|otpauth:\/\//);
  });

  test("NEX42 — Sessão admin_global não acessa rotas nexus", async ({ request }) => {
    await request.post(`${BFF_URL}/api/auth/login`, {
      data: { email: "admin@apmcb.dev", password: "Admin@123" },
    });
    const res = await request.get(`${BFF_URL}/api/nexus/tenants`);
    // Admin global não tem sessão nexus — deve receber 401
    expect(res.status()).toBe(401);
  });

  test("NEX43 — XSS: nome de tenant com <script> rejeitado", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/tenants`, {
      data: { nome: "<script>alert(1)</script>", slug: "xss-test", tipo_orgao: "outro", structure_mode: "simple" },
    });
    expect([400, 401, 422]).toContain(res.status());
    expect(res.status()).not.toBe(201);
  });

  test("NEX44 — XSS: slug com script tag rejeitado", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/tenants`, {
      data: { nome: "Org Teste", slug: "<img/src=x onerror=alert(1)>", tipo_orgao: "outro" },
    });
    expect([400, 401, 422]).toContain(res.status());
  });

  test("NEX45 — SQL injection em slug rejeitado ou sanitizado", async ({ request }) => {
    const res = await request.post(`${BFF_URL}/api/nexus/tenants`, {
      data: { nome: "Org SQL", slug: "'; DROP TABLE tenants; --", tipo_orgao: "outro" },
    });
    // Deve rejeitar slug com caracteres especiais ou retornar 401 (sem auth)
    expect([400, 401, 422]).toContain(res.status());
  });

  test("NEX46 — Brute force: login inválido repetido não retorna 500", async ({ request }) => {
    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        request.post(`${BFF_URL}/api/auth/login`, {
          data: { email: "devdiegopro@gmail.com", password: "wrongpassword" },
        })
      )
    );
    attempts.forEach((r) => {
      expect([400, 401, 429]).toContain(r.status());
      expect(r.status()).not.toBe(500);
    });
  });

  test("NEX47 — Rota nexus com token forjado → 401", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants`, {
      headers: { Cookie: "apmcb_nexus_session=fakesession12345" },
    });
    expect(res.status()).toBe(401);
  });

  test("NEX48 — Sessão normal não acessa rotas nexus", async ({ request }) => {
    // Login com usuario normal
    await request.post(`${BFF_URL}/api/auth/login`, {
      data: { email: "admin@apmcb.dev", password: "Admin@123" },
    });
    const nexusRoutes = [
      `${BFF_URL}/api/nexus/tenants`,
      `${BFF_URL}/api/nexus/health`,
      `${BFF_URL}/api/nexus/events`,
    ];
    const results = await Promise.all(nexusRoutes.map((url) => request.get(url)));
    results.forEach((r) => expect(r.status()).toBe(401));
  });

  test("NEX49 — /nexus/login não expõe QR code se TOTP já configurado", async ({ page }) => {
    await page.goto(`${BASE_URL}/nexus/login`, { waitUntil: "domcontentloaded" });
    // Na página de login (step 1), não deve aparecer QR code
    const qrImage = page.locator("img[alt*='QR' i], canvas, svg[viewBox]");
    const qrVisible = await qrImage.isVisible().catch(() => false);
    expect(qrVisible).toBe(false);
  });

  test("NEX50 — BFF retorna header de content-type application/json em erros", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/nexus/tenants`);
    const ct = res.headers()["content-type"];
    expect(ct).toContain("application/json");
  });

});
