/**
 * Setup: salva session do armeiro em arquivo para reuso em armeiro-suite.
 * Roda UMA VEZ antes da suite — evita 21 logins sequenciais que causam rate-limit.
 */
import { test as setup } from "@playwright/test";
import { login } from "../harness";
import path from "path";

export const ARMEIRO_STATE = path.join(__dirname, "../../.auth/armeiro.json");

setup("armeiro auth state", async ({ page }) => {
  await login(page, "reserva");
  // sessionStorage não é persistido pelo storageState do Playwright.
  // Copia o CSRF token para localStorage para que o storageState o capture
  // e testes que usam storageState possam fazer requisições mutantes (POST/PUT/DELETE).
  await page.evaluate(() => {
    const t = sessionStorage.getItem("csrf-token");
    if (t) localStorage.setItem("csrf-token", t);
  });
  await page.context().storageState({ path: ARMEIRO_STATE });
});
