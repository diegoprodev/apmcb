import { expect, test } from "@playwright/test";
import { BASE_URL, BFF_URL, USERS } from "./harness";

test.describe("Login UI session", () => {
  test("login por senha cria sessao BFF e nao volta para session_expired", async ({ page }) => {
    const authMeStatuses: number[] = [];
    page.on("response", (response) => {
      if (response.url().includes("/api/auth/me")) {
        authMeStatuses.push(response.status());
      }
    });

    await page.context().clearCookies();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "load" });
    await page.waitForTimeout(750);
    await page.locator("#email").click();
    await page.locator("#email").pressSequentially(USERS.admin.email);
    await page.locator("#password").click();
    await page.locator("#password").pressSequentially(USERS.admin.password);
    const submit = page.getByRole("button", { name: /^entrar$/i });
    await expect(submit).toBeEnabled();
    await submit.click();

    await page.waitForURL(/\/admin/, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/session_expired/);
    const me = await page.request.get(`${BFF_URL}/api/auth/me`);
    expect(me.status()).toBe(200);
    expect(authMeStatuses).not.toContain(401);
  });
});
