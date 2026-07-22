/**
 * biometric-pairing-ui.spec.ts — UI de pareamento em /reserva/biometria
 * (Fase B da spec Fase 1C, seção 6)
 *
 * Achado CRÍTICO de code review (2026-07-21): "Cancelar"/"Fechar" no
 * rodapé do dialog chamavam setOpen(false) diretamente, o que NÃO passa
 * por onOpenChange (só Esc/backdrop/ícone "X" passam) — o estado do
 * código gerado nunca era resetado nesses 2 botões. Reabrir o dialog
 * depois de fechar por "Fechar" mostrava o código antigo (de uma reserva
 * possivelmente diferente da exibida na descrição) em vez do formulário —
 * dado de reserva errada na tela, num sistema de custódia de armamento.
 * Este spec existe especificamente pra pegar essa classe de regressão —
 * um teste de API (como biometric-bridge-phase1b.spec.ts) nunca pegaria
 * isso, já que é puramente estado de UI client-side.
 *
 * PU01 — gerar código → fechar via "Fechar" → reabrir → deve mostrar o
 *        FORMULÁRIO (nome do leitor), nunca o código antigo
 * PU02 — gerar código → cancelar durante o fetch (submitting) não deve
 *        deixar o código aparecer depois
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, login } from "./harness";

test.describe.configure({ mode: "serial" });

test("PU01 (CRÍTICO, code review 2026-07-21) — fechar e reabrir o dialog de pareamento mostra o formulário, não o código antigo", async ({ page }) => {
  await login(page, "admin");
  await page.goto(`${BASE_URL}/reserva/biometria`, { waitUntil: "domcontentloaded" });

  const pairButton = page.getByTestId("btn-biometric-pair-new");
  const hasPairButton = await pairButton.isVisible({ timeout: 10_000 }).catch(() => false);
  test.skip(!hasPairButton, "Usuário admin sem reserva vinculada nesta instância — fixture insuficiente");

  // 1. Abre o dialog e gera um código.
  await pairButton.click();
  const nameInput = page.getByTestId("input-pair-device-name");
  await expect(nameInput).toBeVisible();
  await nameInput.fill(`E2E Pairing UI Test ${Date.now()}`);
  await page.getByTestId("btn-pair-generate-code").click();

  const codeDisplay = page.getByTestId("pair-device-code");
  await expect(codeDisplay).toBeVisible({ timeout: 10_000 });
  const generatedCode = await codeDisplay.textContent();
  expect(generatedCode).toMatch(/^APMCB-/);

  // 2. Fecha pelo botão "Fechar" do rodapé (não Esc, não backdrop) —
  // exatamente o caminho que não passava por onOpenChange antes do fix.
  await page.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByTestId("pair-device-dialog")).not.toBeVisible();

  // 3. Reabre — deve mostrar o FORMULÁRIO (campo de nome), não o código
  // da vez anterior.
  await pairButton.click();
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  await expect(nameInput).toHaveValue("");
  await expect(codeDisplay).not.toBeVisible();
});

test("PU02 — cancelar durante o envio não deixa um código órfão aparecer depois", async ({ page }) => {
  await login(page, "admin");
  await page.goto(`${BASE_URL}/reserva/biometria`, { waitUntil: "domcontentloaded" });

  const pairButton = page.getByTestId("btn-biometric-pair-new");
  const hasPairButton = await pairButton.isVisible({ timeout: 10_000 }).catch(() => false);
  test.skip(!hasPairButton, "Usuário admin sem reserva vinculada nesta instância — fixture insuficiente");

  await pairButton.click();
  const nameInput = page.getByTestId("input-pair-device-name");
  await nameInput.fill(`E2E Pairing Cancel Test ${Date.now()}`);

  const generateBtn = page.getByTestId("btn-pair-generate-code");
  await generateBtn.click();
  // Cancela imediatamente, antes do POST resolver — o botão "Cancelar"
  // precisa continuar clicável (não travado) mesmo com o request em voo.
  const cancelBtn = page.getByRole("button", { name: "Cancelar" });
  if (await cancelBtn.isVisible({ timeout: 500 }).catch(() => false) && await cancelBtn.isEnabled()) {
    await cancelBtn.click();
  }
  await expect(page.getByTestId("pair-device-dialog")).not.toBeVisible({ timeout: 5_000 });

  // Reabre — não deve mostrar um código que "vazou" da tentativa cancelada.
  await pairButton.click();
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId("pair-device-code")).not.toBeVisible();
});

// PU03 — Achado CRÍTICO de code review (2026-07-22): fechar via Esc/backdrop
// durante um POST em voo (o único jeito de fechar antes do fix, já que
// "Cancelar" ficava disabled durante o submit) deixava `submitting=true`
// para sempre — o botão "Gerar código" ficava travado em "Gerando…"
// permanentemente, mesmo reabrindo o dialog, sem nenhuma requisição real em
// andamento. Este teste existe especificamente pra travar essa classe de
// regressão de novo.
test("PU03 (CRÍTICO, code review 2026-07-22) — fechar via Esc durante o envio não trava o botão 'Gerar código' pra sempre", async ({ page }) => {
  await login(page, "admin");
  await page.goto(`${BASE_URL}/reserva/biometria`, { waitUntil: "domcontentloaded" });

  const pairButton = page.getByTestId("btn-biometric-pair-new");
  const hasPairButton = await pairButton.isVisible({ timeout: 10_000 }).catch(() => false);
  test.skip(!hasPairButton, "Usuário admin sem reserva vinculada nesta instância — fixture insuficiente");

  await pairButton.click();
  const nameInput = page.getByTestId("input-pair-device-name");
  await nameInput.fill(`E2E Pairing Esc Test ${Date.now()}`);

  const generateBtn = page.getByTestId("btn-pair-generate-code");
  await generateBtn.click();
  // Fecha por Esc imediatamente, antes do POST resolver — antes do fix,
  // este era o único caminho habilitado (Cancelar ficava disabled) e o
  // que deixava submitting travado.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("pair-device-dialog")).not.toBeVisible({ timeout: 5_000 });

  // Reabre — o botão "Gerar código" precisa estar clicável de novo, não
  // travado em "Gerando…" por causa de um submitting que nunca resetou.
  await pairButton.click();
  await expect(nameInput).toBeVisible({ timeout: 5_000 });
  await nameInput.fill(`E2E Pairing Esc Retry ${Date.now()}`);
  const generateBtnAgain = page.getByTestId("btn-pair-generate-code");
  await expect(generateBtnAgain).toBeEnabled({ timeout: 2_000 });
  await expect(generateBtnAgain).toHaveText(/gerar código/i);
});
