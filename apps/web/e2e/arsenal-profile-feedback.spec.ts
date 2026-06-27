import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./helpers";

test.describe("Arsenal, perfil e suporte", () => {
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

    await page.getByTestId("arsenal-material-row").first().click();
    await expect(page.getByText(/solicitar adicao de material/i)).toBeVisible();
    await expect(page.getByText(/solicitar desativacao de material/i)).toBeVisible();
  });

  test("menu do usuario abre perfil e suporte para todos RBAC", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin`, { waitUntil: "domcontentloaded" });

    await page.locator("header").getByRole("button").last().click();

    await expect(page.getByRole("menuitem", { name: /perfil/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /reportar/i })).toBeVisible();
  });
});
