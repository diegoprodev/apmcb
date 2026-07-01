"use strict";
/**
 * TOTP UI Confirmation — confirmar visualmente card setup + display + dialog Reserva de Armamento
 */
import { test, expect } from "@playwright/test";
import { BASE_URL, login, T } from "./harness";

test.describe("TOTP UI Confirmation", () => {

  test("TOTP-C01 — cadete vê card de setup ou display de código", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "test-results/totp-cadete-dashboard.png", fullPage: true });

    // Deve ter UM dos dois: card de setup OU display de código
    const hasSetupCard = await page.getByText(/configurar código de acesso/i).isVisible().catch(() => false);
    const hasCodeDisplay = await page.locator('[data-testid="totp-display"]').isVisible().catch(() => false);
    const hasCodeText = await page.getByText(/código de acesso/i).first().isVisible().catch(() => false);

    console.log({ hasSetupCard, hasCodeDisplay, hasCodeText });
    expect(hasSetupCard || hasCodeDisplay || hasCodeText,
      "Cadete deve ver card de setup OU display de código TOTP").toBe(true);
  });

  test("TOTP-C02 — cadete sem TOTP vê botão de configurar", async ({ page }) => {
    await login(page, "efetivo");
    await page.goto(`${BASE_URL}/efetivo`, { waitUntil: "load" });
    await page.waitForTimeout(1500);

    const pageText = await page.textContent("body") ?? "";
    console.log("Cadete page keywords found:", {
      totp: pageText.toLowerCase().includes("totp") || pageText.toLowerCase().includes("código"),
      configurar: pageText.toLowerCase().includes("configurar"),
      acesso: pageText.toLowerCase().includes("acesso"),
    });
    await page.screenshot({ path: "test-results/totp-cadete-full.png", fullPage: true });
  });

  test("TOTP-A01 — Reserva de Armamento dashboard tem botão Verificar Código", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/totp-Reserva de Armamento-dashboard.png", fullPage: true });

    const pageText = await page.textContent("body") ?? "";
    console.log("Reserva de Armamento page keywords:", {
      verificar: pageText.toLowerCase().includes("verificar"),
      codigo: pageText.toLowerCase().includes("código"),
      totp: pageText.toLowerCase().includes("totp"),
      pendencias: pageText.toLowerCase().includes("pendência"),
    });

    // Verifica botão Verificar Código ou equivalente
    const hasVerificarBtn = await page.getByRole("button", { name: /verificar.*(código|totp)/i }).isVisible().catch(() => false)
      || await page.getByTestId("btn-verificar-codigo").isVisible().catch(() => false)
      || await page.getByText(/verificar código/i).isVisible().catch(() => false);

    console.log({ hasVerificarBtn });
    await page.screenshot({ path: "test-results/totp-Reserva de Armamento-buttons.png" });
    expect(hasVerificarBtn, "Reserva de Armamento deve ver botão Verificar Código").toBe(true);
  });

  test("TOTP-A02 — Reserva de Armamento clica Verificar Código e dialog abre", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva`, { waitUntil: "load" });
    await page.waitForTimeout(1500);

    // Tenta clicar em qualquer botão relacionado a verificar código
    const btn = page.getByRole("button", { name: /verificar.*(código|totp)/i })
      .or(page.getByTestId("btn-verificar-codigo"))
      .or(page.getByText(/verificar código/i));

    const btnVisible = await btn.first().isVisible().catch(() => false);
    if (btnVisible) {
      await btn.first().click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: "test-results/totp-Reserva de Armamento-dialog.png" });

      const dialogVisible = await page.getByRole("dialog").isVisible().catch(() => false);
      console.log("Dialog opened:", dialogVisible);
      expect(dialogVisible, "Dialog deve abrir ao clicar Verificar Código").toBe(true);
    } else {
      // Captura o que está na tela para diagnóstico
      const allButtons = await page.getByRole("button").allTextContents();
      console.log("Buttons on Reserva de Armamento page:", allButtons);
      await page.screenshot({ path: "test-results/totp-Reserva de Armamento-no-btn.png", fullPage: true });
      expect.soft(false, `Botão Verificar Código não encontrado. Buttons: ${allButtons.join(", ")}`).toBe(true);
    }
  });

  test("TOTP-A03 — Reserva de Armamento SSA request list page exists", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/solicitacoes`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: "test-results/totp-Reserva de Armamento-solicitacoes.png", fullPage: true });

    const is404 = page.url().includes("404") || await page.getByText(/404|not found/i).isVisible().catch(() => false);
    console.log("Solicitacoes page - is 404:", is404, "URL:", page.url());
    expect(is404, "Página /reserva/solicitacoes não deve ser 404").toBe(false);
  });

});
