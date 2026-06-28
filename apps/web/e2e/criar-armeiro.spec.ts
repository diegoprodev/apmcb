import { test, expect } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://apmcb.pmpb.online";

// Credenciais do admin_reserva — usar vars de ambiente ou fallback para usuário admin_global
// que também tem acesso à página (admin_global pode criar armeiros)
const ADMIN_EMAIL = process.env.E2E_ADMIN_RESERVA_EMAIL ?? process.env.E2E_ADMIN_EMAIL ?? "admin@apmcb.dev";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_RESERVA_PASSWORD ?? process.env.E2E_ADMIN_PASSWORD ?? "Admin@123";

test.describe("Criar Armeiro (Admin Reserva)", () => {
  test("CA01 — página /reserva/criar-armeiro carrega para admin_reserva", async ({ page }) => {
    // Login como admin_reserva (ou admin_global como fallback)
    await page.goto(`${BASE}/login`);
    await page.fill("[name=email], input[type=email]", ADMIN_EMAIL);
    await page.fill("[name=password], input[type=password]", ADMIN_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/(reserva|admin)/, { timeout: 15_000 });

    await page.goto(`${BASE}/reserva/criar-armeiro`);
    await expect(page.locator("[data-testid='criar-armeiro-ready']")).toBeVisible({ timeout: 10_000 });
  });

  test("CA02 — card 'Criar Armeiro' aparece no dashboard da reserva", async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.fill("[name=email], input[type=email]", ADMIN_EMAIL);
    await page.fill("[name=password], input[type=password]", ADMIN_PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(/\/(reserva|admin)/, { timeout: 15_000 });

    await page.goto(`${BASE}/reserva`);
    await expect(page.locator("[data-testid='card-criar-armeiro']")).toBeVisible({ timeout: 10_000 });
  });

  test("CA03 — API /api/admin/users rejeita role=armeiro sem sessão (401/403)", async ({ request }) => {
    // Sem sessão deve retornar 401 ou 403
    const res = await request.post(`${BASE}/api/admin/users`, {
      data: {
        email: "test_armeiro_ca03@test.com",
        nome_completo: "Test Armeiro",
        matricula: "999000",
        role: "armeiro",
        method: "magic_link",
      },
    });
    expect([401, 403]).toContain(res.status());
  });
});
