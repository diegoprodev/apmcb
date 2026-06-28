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
  await page.context().storageState({ path: ARMEIRO_STATE });
});
