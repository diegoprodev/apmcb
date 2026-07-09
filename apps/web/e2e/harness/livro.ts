/**
 * Harness reutilizável para os testes do Livro Digital de Serviço (LDS*).
 * Helpers de leitura/interação de UI que não consomem TOTP — a lógica de
 * autenticação (enterShiftTotp, anti-replay) permanece em livro-digital.spec.ts
 * como fonte única de verdade do último código consumido; duplicar esse
 * estado aqui reintroduziria a colisão de anti-replay já corrigida (C1).
 */
import { type Page, expect } from "@playwright/test";
import { BASE_URL } from "../harness";

export async function waitForLivroReady(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/reserva/livro`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: 15_000 });
}

export function hasActiveShift(page: Page): Promise<boolean> {
  return page.getByText(/turno ativo —/i).isVisible().catch(() => false);
}

/**
 * Conta cards visíveis na timeline. A borda verde (`.border-l-green-500`) só
 * existe na view "timeline" — chamar após `switchToListView()` sempre retorna 0.
 */
export async function getVisibleEventCount(page: Page): Promise<number> {
  return page.locator(".border-l-green-500").count();
}

export async function searchEvents(page: Page, query: string): Promise<void> {
  const input = page.getByTestId("input-busca-eventos");
  await input.fill(query);
}

export async function switchToListView(page: Page): Promise<void> {
  await page.getByTestId("btn-toggle-view").click();
}

export async function switchToHistoricoTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /histórico/i }).click();
}

export async function switchToTurnoTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: /turno atual/i }).click();
}
