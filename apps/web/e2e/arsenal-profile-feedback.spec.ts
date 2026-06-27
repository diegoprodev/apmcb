import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

test.describe("Arsenal, perfil e suporte", () => {
  test("reserva abre sem erro no-response do service worker", async ({ page }) => {
    const serviceWorkerErrors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      const text = msg.text();
      if (/no-response|FetchEvent|sw\.js/i.test(text)) serviceWorkerErrors.push(text);
    });
    page.on("pageerror", (error) => {
      const text = error.message;
      if (/no-response|FetchEvent|sw\.js/i.test(text)) serviceWorkerErrors.push(text);
    });

    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("header")).toBeVisible();
    await page.waitForTimeout(1000);

    expect(serviceWorkerErrors).toHaveLength(0);
  });

  test("admin abre Adicionar Material com campo opcional de foto", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/arsenal`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /adicionar material/i }).click();
    const dialog = page.locator('[role="dialog"]');

    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel(/foto do material/i)).toBeVisible();
  });

  test("armeiro solicita adicao ou desativacao de material via aprovacao", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: /adicionar material/i })).toBeVisible();
    await page.getByRole("button", { name: /adicionar material/i }).click();
    await expect(page.getByText(/solicitar adicao de material/i)).toBeVisible();
    await expect(page.getByPlaceholder(/nome do material/i)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("arsenal-material-row").first().click();
    await expect(page.getByText(/solicitar adicao de material/i)).toBeVisible();
    await expect(page.getByText(/solicitar desativacao de material/i)).toBeVisible();
  });

  test("cautelas do armeiro saem do carregamento rapidamente", async ({ page }) => {
    await login(page, "reserva");

    const startedAt = Date.now();
    await page.goto(`${BASE_URL}/reserva/cautelas`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("cautelas-ready")).toBeVisible({ timeout: 4000 });

    expect(Date.now() - startedAt).toBeLessThan(5000);
  });

  test("menu do usuario abre perfil e suporte para todos RBAC", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });

    await page.locator("header").getByRole("button").last().click();

    await expect(page.getByRole("menuitem", { name: /perfil/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /reportar/i })).toBeVisible();
  });
});
