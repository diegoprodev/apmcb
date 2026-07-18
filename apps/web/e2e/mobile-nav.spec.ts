import { expect, test, devices } from "@playwright/test";
import { BASE_URL, login } from "./harness";

/**
 * Regressão do bug visual reportado em produção (PWA e Safari mobile,
 * 2026-07-18): o drawer do menu mobile (`MobileNav`) usa `position: fixed;
 * top-14` (56px) e, fechado, `-translate-y-[...]` para escondê-lo acima da
 * viewport. Um translate percentual puro (ex: -110%) só considera a altura
 * do próprio elemento — nunca o offset de `top-14` — deixando uma fatia
 * visível por cima da header sempre que o drawer é mais baixo que ~560px.
 * O papel "usuario" (poucos itens de menu) é o caso real que estourou em
 * produção, por isso o teste loga como esse papel especificamente.
 */

const { defaultBrowserType, ...deviceContextOptions } = devices["iPhone 13 Pro Max"];
void defaultBrowserType;

test.describe("Mobile nav — drawer não deve sobrepor a header", () => {
  test.use({ ...deviceContextOptions });

  test("MND-01 - drawer fechado fica inteiramente fora da viewport (papel usuario)", async ({ page }) => {
    await login(page, "efetivo");

    const nav = page.locator('nav[aria-label="Menu principal"]');
    await expect(nav).toBeAttached();

    const navRect = await nav.boundingBox();
    expect(navRect, "boundingBox do drawer deveria resolver").not.toBeNull();
    // Fechado, o drawer não pode invadir a viewport — nenhum pixel visível
    // sobrepondo a header (bug original: ~27px de sobra por cima da header).
    expect(navRect!.y + navRect!.height).toBeLessThanOrEqual(0);
  });

  test("MND-02 - drawer aberto aparece imediatamente abaixo da header, sem gap nem overlap", async ({ page }) => {
    await login(page, "efetivo");

    const header = page.locator("header").first();
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();

    await page.locator('button[aria-label="Abrir menu"]').click();

    const nav = page.locator('nav[aria-label="Menu principal"]');
    await expect(nav).toBeVisible();
    await page.waitForTimeout(350); // aguarda transition-transform (duration-300)

    const navRect = await nav.boundingBox();
    expect(navRect).not.toBeNull();
    expect(navRect!.y).toBeCloseTo(headerBox!.y + headerBox!.height, 0);
  });
});
