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

  test("admin global visualiza almoxarifado sem acao de mutacao direta", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/arsenal`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /almoxarifado/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /adicionar material/i })).toHaveCount(0);
  });

  test("armeiro ve foto opcional na solicitacao de material", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /adicionar material/i }).click();

    await expect(page.getByText(/solicitar adicao de material/i)).toBeVisible();
    await expect(page.getByLabel(/foto do material/i)).toBeVisible();
  });

  test("material metadata mostra calibre para arma e validade para colete", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /adicionar material/i }).click();
    await expect(page.getByText(/solicitar adicao de material/i)).toBeVisible();

    await expect(page.getByText(/calibre/i)).toBeVisible();

    await page.getByLabel(/categoria/i).fill("Colete");
    await expect(page.getByText(/validade obrigatoria para colete/i)).toBeVisible();
    await expect(page.getByText(/1 ano/i)).toBeVisible();
    await expect(page.getByText(/6 meses/i)).toBeVisible();
    await expect(page.getByText(/90 dias/i)).toBeVisible();
  });

  test("armeiro solicita adicao ou desativacao de material via aprovacao", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/arsenal`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: /adicionar material/i })).toBeVisible();
    await page.getByRole("button", { name: /adicionar material/i }).click();
    await expect(page.getByText(/solicitar adicao de material/i)).toBeVisible();
    await expect(page.getByPlaceholder(/nome do material/i)).toBeVisible();
    await expect(page.getByLabel(/categoria/i)).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByTestId("arsenal-material-row").first().click();
    await expect(page.getByText(/solicitar adicao de material/i)).toBeVisible();
    await expect(page.getByText(/solicitar desativacao de material/i)).toBeVisible();
  });

  test("relatorios exibem filtro de calibre ao selecionar categoria arma", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/relatorios`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /filtros avan/i }).click();
    await page.locator('label:has-text("Categoria")').locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: /^arma$/i }).click();

    await expect(page.getByText("Calibre")).toBeVisible();
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

  test("suporte usa canal unico sem seletor de tipo, email correto e copia", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/suporte`, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("suporteonix@arckosia.com.br")).toBeVisible();
    await expect(page.getByText(/at[eé] 3 dias [uú]teis/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /copiar email/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /enviar email/i })).toHaveCount(1);
    await expect(page.locator('a[href^="mailto:"]')).toHaveCount(1);

    await expect(page.getByText(/tipo de contato/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /reportar problema/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sugest[aã]o/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /cr[ií]tica/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^elogio$/i })).toHaveCount(0);
    await expect(page.getByText("iasuporteonix@arckosia.com.br")).toHaveCount(0);
  });
});
