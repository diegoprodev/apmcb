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
  // Copia o CSRF token para localStorage para que o storageState o capture.
  // Se sessionStorage ainda não tem o token (ex: CF Pages CDN cacheou o exchange antigo),
  // busca diretamente do BFF /api/auth/session-info como fallback.
  const csrfMigrated = await page.evaluate(() => {
    const t = sessionStorage.getItem("csrf-token");
    if (t) { localStorage.setItem("csrf-token", t); return true; }
    return false;
  });

  if (!csrfMigrated) {
    // Fallback: requisição BFF com credentials — retorna o csrfToken da sessão ativa
    const bffUrl = process.env.E2E_BFF_URL ?? "https://api.apmcb.pmpb.online";
    const csrfToken = await page.evaluate(async (url) => {
      try {
        const res = await fetch(`${url}/api/session/csrf`, { credentials: "include", signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json() as { csrfToken?: string };
          return data.csrfToken ?? null;
        }
      } catch {}
      return null;
    }, bffUrl);

    if (csrfToken) {
      await page.evaluate((t) => {
        sessionStorage.setItem("csrf-token", t);
        localStorage.setItem("csrf-token", t);
      }, csrfToken);
    }
  }

  await page.context().storageState({ path: ARMEIRO_STATE });
});
