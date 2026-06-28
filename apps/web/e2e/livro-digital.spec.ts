/**
 * APMCB — Fase 6-B: Livro Digital de Serviço — E2E Spec
 *
 * Cobre: LDS01-LDS14 (migration validada separadamente)
 * Usuário armeiro: usa storageState (zero logins durante a suite)
 * Admin: usa BFF_URL para testes de API
 *
 * Run: npx playwright test e2e/livro-digital.spec.ts --project=livro-suite
 */

import { test, expect, type Page } from "@playwright/test";
import { BASE_URL, BFF_URL } from "./harness";

const T = {
  nav:      25_000,
  api:      12_000,
  dialog:   10_000,
  toast:     6_000,
  interact:  5_000,
};

async function goTo(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
}

// ── Suite: Livro Digital — Armeiro ───────────────────────────────────────────

test.describe("LDS — Livro Digital de Serviço (Armeiro)", () => {

  // LDS01 — Página carrega e detecta estado (sem turno)
  test("LDS01 — /reserva/livro carrega sem 401 e mostra estado correto", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByRole("heading", { name: /livro digital de serviço/i })).toBeVisible({ timeout: T.nav });
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });
    await expect(page.getByText(/401|Unauthorized/i)).not.toBeVisible({ timeout: 2000 });
  });

  // LDS02 — Botão "Assumir Turno" ou badge "Turno Ativo" visível
  test("LDS02 — botão 'Assumir Turno' ou badge 'Turno Ativo' visível após carregar", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });
    // Qualquer dos dois estados é válido — turno ativo OU botão assumir
    const hasBadge = await page.getByText(/turno ativo/i).isVisible().catch(() => false);
    const hasBtn   = await page.getByRole("button", { name: /^assumir turno$/i }).isVisible().catch(() => false);
    const hasBtnAlt = await page.getByRole("button", { name: /assumir turno agora/i }).isVisible().catch(() => false);
    expect(hasBadge || hasBtn || hasBtnAlt).toBeTruthy();
  });

  // LDS03 — Clicar "Assumir Turno" abre dialog de abertura
  test("LDS03 — clicar 'Assumir Turno' abre dialog de abertura", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    // Se já tem turno, encerra antes
    const encerrarBtn = page.getByRole("button", { name: /encerrar turno/i });
    if (await encerrarBtn.isVisible().catch(() => false)) {
      await encerrarBtn.click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible({ timeout: T.dialog });
      const confirmBtn = dialog.getByRole("button", { name: /encerrar turno/i });
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1500);
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });
      }
    }

    // Usa .first() pois pode haver "Assumir Turno" e "Assumir Turno Agora" na tela
    const assumirBtn = page.getByRole("button", { name: /assumir turno/i }).first();
    await expect(assumirBtn).toBeVisible({ timeout: T.interact });
    await assumirBtn.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });
    await expect(dialog.getByText(/assumir turno de serviço/i)).toBeVisible();
  });

  // LDS04 — Abrir turno com seleção de reserva cria turno ativo
  test("LDS04 — abrir turno cria turno ativo e mostra badge verde", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    // Se já tem turno ativo, skip
    if (await page.getByText(/turno ativo/i).isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    // Encerrar turno pendente se existir
    const encerrarBtn = page.getByRole("button", { name: /encerrar turno/i });
    if (await encerrarBtn.isVisible().catch(() => false)) {
      await encerrarBtn.click();
      const dlg = page.getByRole("dialog");
      await dlg.getByRole("button", { name: /encerrar turno/i }).click();
      await page.waitForTimeout(1500);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });
    }

    // .first() pois pode haver "Assumir Turno" e "Assumir Turno Agora" simultâneos
    await page.getByRole("button", { name: /assumir turno/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });

    // Selecionar primeira reserva disponível
    const select = dialog.locator("select");
    await expect(select).toBeVisible({ timeout: T.interact });
    const options = await select.locator("option").all();
    if (options.length > 1) {
      await select.selectOption({ index: 1 });
    }

    await dialog.getByRole("button", { name: /assumir turno/i }).click();
    // Usa "Turno Ativo —" (com traço) para não colidir com "Sem turno ativo" / "Você não tem turno ativo"
    await expect(page.getByText(/turno ativo —/i)).toBeVisible({ timeout: T.api });
    await expect(page.getByText(/turno aberto com sucesso/i)).toBeVisible({ timeout: T.toast });
  });

  // LDS05 — Linha do tempo mostra evento "turno_assumido" após abertura
  test("LDS05 — evento 'turno_assumido' aparece na linha do tempo", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    // Precisa de turno ativo
    if (!(await page.getByText(/turno ativo/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await expect(page.getByText(/turno assumido/i)).toBeVisible({ timeout: T.interact });
  });

  // LDS06 — Stats: eventos, pendências, cautelas aparecem no painel
  test("LDS06 — painel de stats mostra contadores quando turno ativo", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    if (!(await page.getByText(/turno ativo/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // 3 cards de estatísticas devem aparecer
    await expect(page.getByText(/eventos/i).first()).toBeVisible({ timeout: T.interact });
    await expect(page.getByText(/pendências/i).first()).toBeVisible({ timeout: T.interact });
    await expect(page.getByText(/cautelas/i).first()).toBeVisible({ timeout: T.interact });
  });

  // LDS07 — Botão "Registrar" abre dialog de evento manual
  test("LDS07 — botão 'Registrar' abre dialog de evento manual", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    if (!(await page.getByText(/turno ativo/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await page.getByRole("button", { name: /registrar/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });
    await expect(dialog.getByText(/registrar evento/i)).toBeVisible();
    await expect(dialog.getByPlaceholder(/descreva o evento/i)).toBeVisible();
  });

  // LDS08 — Registrar evento manual aparece na linha do tempo
  test("LDS08 — evento manual registrado aparece na timeline", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    if (!(await page.getByText(/turno ativo/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await page.getByRole("button", { name: /registrar/i }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });

    const desc = `Teste E2E — evento manual ${Date.now()}`;
    await dialog.getByPlaceholder(/descreva o evento/i).fill(desc);
    await dialog.getByRole("button", { name: /^registrar$/i }).click();

    await expect(page.getByText(/evento registrado/i)).toBeVisible({ timeout: T.toast });
    await expect(page.getByText(desc)).toBeVisible({ timeout: T.api });
  });

  // LDS09 — Hash chain: evento tem hash visível na timeline
  test("LDS09 — eventos exibem hash SHA-256 truncado na timeline", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    if (!(await page.getByText(/turno ativo/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // Hash truncado aparece em elemento com classe font-mono (span do hash)
    // Busca por qualquer texto que pareça um hash hex (pelo menos 16 chars hex)
    const hashSpan = page.locator(".font-mono span.truncate").first();
    await expect(hashSpan).toBeVisible({ timeout: T.interact });
    const hashText = await hashSpan.textContent();
    expect(hashText).toMatch(/^[a-f0-9]{16,}/i);
  });

  // LDS10 — Badge "encadeado" aparece em eventos com prev_hash
  test("LDS10 — ícone de escudo (encadeado) aparece em eventos com prev_hash", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    if (!(await page.getByText(/turno ativo/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // Após pelo menos 2 eventos, deve aparecer "encadeado"
    const events = await page.locator(".relative.pl-10.pb-4").count();
    if (events >= 2) {
      await expect(page.getByText(/encadeado/i).first()).toBeVisible({ timeout: T.interact });
    } else {
      test.skip();
    }
  });

  // LDS11 — Link "histórico" navega para /reserva/livro/historico
  test("LDS11 — link 'histórico de turnos anteriores' navega corretamente", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    if (!(await page.getByText(/turno ativo/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await page.getByText(/histórico de turnos anteriores/i).click();
    await expect(page).toHaveURL(/\/reserva\/livro\/historico/, { timeout: T.nav });
    await expect(page.getByRole("heading", { name: /histórico de turnos/i })).toBeVisible({ timeout: T.nav });
  });

  // LDS12 — Histórico lista turnos anteriores
  test("LDS12 — /reserva/livro/historico carrega e lista turnos", async ({ page }) => {
    await goTo(page, "/reserva/livro/historico");
    await expect(page.getByTestId("historico-ready")).toBeVisible({ timeout: T.api });
    await expect(page.getByRole("heading", { name: /histórico de turnos/i })).toBeVisible({ timeout: T.nav });
    // Pode ter 0 ou mais — só validar que não há 401
    await expect(page.getByText(/401|Unauthorized/i)).not.toBeVisible({ timeout: 2000 });
  });

  // LDS13 — Expandir turno no histórico mostra eventos
  test("LDS13 — expandir turno no histórico mostra linha do tempo", async ({ page }) => {
    await goTo(page, "/reserva/livro/historico");
    await expect(page.getByTestId("historico-ready")).toBeVisible({ timeout: T.api });

    const firstShift = page.locator("button").filter({ hasText: /ativo|encerrado/i }).first();
    if (!(await firstShift.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await firstShift.click();
    await page.waitForTimeout(1000);
    // Deve mostrar eventos ou "nenhum evento"
    const hasEvents = await page.locator("[class*='rounded-md border bg-background']").first().isVisible()
      .catch(() => false);
    const hasEmpty = await page.getByText(/nenhum evento neste turno/i).isVisible()
      .catch(() => false);
    expect(hasEvents || hasEmpty).toBeTruthy();
  });

  // LDS14 — Encerrar turno registra evento "turno_encerrado"
  test("LDS14 — encerrar turno registra evento e altera status", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    if (!(await page.getByText(/turno ativo/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    const encerrarBtn = page.getByRole("button", { name: /encerrar turno/i });
    await expect(encerrarBtn).toBeVisible({ timeout: T.interact });
    await encerrarBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });
    await expect(dialog.getByText(/encerrar turno/i).first()).toBeVisible();

    await dialog.getByRole("button", { name: /encerrar turno/i }).click();
    await expect(page.getByText(/turno encerrado/i)).toBeVisible({ timeout: T.toast });
    await expect(page.getByText(/sem turno ativo|assumir turno/i).first()).toBeVisible({ timeout: T.api });
  });

});

// ── Suite: API BFF — Livro (sem storageState para testes de auth) ─────────────

test.describe("LDS — API BFF /api/shifts", () => {

  // LDS15 — GET /api/shifts/active retorna 200 com sesão armeiro
  test("LDS15 — GET /api/shifts/active retorna 200 com sessão autenticada", async ({ request }) => {
    const res = await request.get(`${BFF_URL}/api/shifts/active`);
    expect(res.status()).toBeGreaterThanOrEqual(200);
    expect(res.status()).toBeLessThanOrEqual(299);
    const body = await res.json();
    // shift pode ser null (sem turno) ou objeto
    expect(body).toHaveProperty("shift");
  });

  // LDS16 — GET /api/shifts sem sessão retorna 401/403
  test("LDS16 — GET /api/shifts sem sessão retorna 401/403", async () => {
    const res = await fetch(`${BFF_URL}/api/shifts`);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  // LDS17 — GET /api/shifts/active sem sessão retorna 401/403
  test("LDS17 — GET /api/shifts/active sem sessão retorna 401/403", async () => {
    const res = await fetch(`${BFF_URL}/api/shifts/active`);
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  // LDS18 — POST /api/shifts/open sem sessão retorna 401/403
  test("LDS18 — POST /api/shifts/open sem sessão retorna 401/403", async () => {
    const res = await fetch(`${BFF_URL}/api/shifts/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reserve_id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  // LDS19 — POST /api/shifts/{id}/close sem sessão retorna 401/403
  test("LDS19 — POST /api/shifts/:id/close sem sessão retorna 401/403", async () => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const res = await fetch(`${BFF_URL}/api/shifts/${fakeId}/close`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
  });

  // LDS20 — Sidebar tem "Livro de Serviço" no nav do armeiro
  test("LDS20 — sidebar armeiro exibe link 'Livro de Serviço'", async ({ page }) => {
    await goTo(page, "/reserva");
    await expect(page.getByRole("link", { name: /livro de serviço/i })).toBeVisible({ timeout: T.nav });
  });

});
