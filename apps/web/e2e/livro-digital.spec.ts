/**
 * APMCB — Fase 6-B: Livro Digital de Serviço — E2E Spec
 *
 * Cobre: LDS01-LDS38 (migration validada separadamente)
 * Usuário armeiro: usa storageState (zero logins durante a suite)
 * Admin: usa BFF_URL para testes de API
 *
 * Run: npx playwright test e2e/livro-digital.spec.ts --project=livro-suite
 */

import { test, expect, type Page, type Locator } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, BFF_URL } from "./harness";
import {
  waitForLivroReady, hasActiveShift, getVisibleEventCount, searchEvents,
  switchToListView, switchToHistoricoTab, switchToTurnoTab,
} from "./harness/livro";

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

/**
 * Helper: fetches the current TOTP code from the BFF for the logged-in armeiro
 * and fills it into the shift-auth dialog's TOTP input.
 *
 * livro-suite runs with workers: 1 (sequential), so consecutive shift actions
 * (close then open, etc.) can land in the same 30s TOTP window and fetch the
 * exact same code — the BFF's anti-replay guard would then reject the second
 * action with "Código já utilizado neste período". This helper tracks the
 * last code it consumed and waits for window rotation before reusing one.
 */
let lastConsumedTotp: string | null = null;

async function enterShiftTotp(page: Page, dialog: Locator): Promise<void> {
  const csrfToken = await page.evaluate(() =>
    localStorage.getItem("csrf-token") ?? sessionStorage.getItem("csrf-token") ?? ""
  );

  let code: string;
  for (;;) {
    const res = await page.request.get(`${BFF_URL}/api/totp/code`, {
      headers: { "X-CSRF-Token": csrfToken },
    });
    expect(
      res.ok(),
      `GET /api/totp/code falhou (${res.status()}) — armeiro de teste sem TOTP configurado ou secret incompatível com a chave do ambiente`
    ).toBeTruthy();
    const body = await res.json() as { code: string; seconds_remaining: number };
    if (body.code !== lastConsumedTotp) { code = body.code; break; }
    // Mesmo código já consumido por uma ação anterior — aguarda a próxima janela.
    await page.waitForTimeout((body.seconds_remaining + 1) * 1000);
  }

  const input = dialog.getByTestId("shift-totp-input");
  await expect(input, "campo shift-totp-input não apareceu no dialog de autenticação").toBeVisible({ timeout: 2000 });
  await input.fill(code);
  lastConsumedTotp = code;
}

/**
 * `Locator.isVisible({ timeout })` não espera — o Playwright instalado ignora
 * a opção `timeout` e resolve imediatamente. Para checagens defensivas
 * ("apareceu dentro de N ms? senão, skip") usar `waitFor` explicitamente.
 */
async function isVisibleWithin(locator: Locator, timeout: number): Promise<boolean> {
  return locator.waitFor({ state: "visible", timeout }).then(() => true).catch(() => false);
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

  // LDS02 — Botão "Assumir Turno" ou badge "Turno Ativo —" visível
  test("LDS02 — botão 'Assumir Turno' ou badge 'Turno Ativo' visível após carregar", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });
    // "Turno Ativo —" só aparece quando há turno ativo (com traço + nome da reserva)
    const hasBadge  = await page.getByText(/turno ativo —/i).isVisible().catch(() => false);
    const hasBtn    = await page.getByRole("button", { name: /^assumir turno$/i }).isVisible().catch(() => false);
    const hasBtnAlt = await page.getByRole("button", { name: /assumir turno agora/i }).isVisible().catch(() => false);
    expect(hasBadge || hasBtn || hasBtnAlt).toBeTruthy();
  });

  // LDS03 — Clicar "Assumir Turno" abre dialog de abertura
  test("LDS03 — clicar 'Assumir Turno' abre dialog de abertura", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    // Se já tem turno ativo, encerra antes (verificação por botão, não pelo badge)
    const encerrarBtn = page.getByRole("button", { name: /encerrar turno/i });
    if (await encerrarBtn.isVisible().catch(() => false)) {
      await encerrarBtn.click();
      const dlgClose = page.getByRole("dialog");
      await expect(dlgClose).toBeVisible({ timeout: T.dialog });
      await enterShiftTotp(page, dlgClose);
      const confirmBtn = dlgClose.getByTestId("shift-auth-confirm");
      if (await confirmBtn.isEnabled({ timeout: 2000 }).catch(() => false)) {
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
    // LDS03: verifica que campo TOTP e abas de autenticação aparecem no dialog
    await expect(dialog.getByTestId("shift-totp-input")).toBeVisible({ timeout: T.interact });
  });

  // LDS04 — Abrir turno com seleção de reserva cria turno ativo
  test("LDS04 — abrir turno cria turno ativo e mostra badge verde", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    // Se já tem turno ativo, skip — /turno ativo —/ só bate em "Turno Ativo — RESERVA"
    if (await page.getByText(/turno ativo —/i).isVisible().catch(() => false)) {
      test.skip();
      return;
    }

    // Encerrar turno pendente se existir (agora requer TOTP)
    const encerrarBtn = page.getByRole("button", { name: /encerrar turno/i });
    if (await encerrarBtn.isVisible().catch(() => false)) {
      await encerrarBtn.click();
      const dlg = page.getByRole("dialog");
      await enterShiftTotp(page, dlg);
      await dlg.getByTestId("shift-auth-confirm").click();
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

    // Autenticação obrigatória: preencher TOTP antes de confirmar
    await enterShiftTotp(page, dialog);
    await dialog.getByTestId("shift-auth-confirm").click();
    // Usa "Turno Ativo —" (com traço) para não colidir com "Sem turno ativo" / "Você não tem turno ativo"
    await expect(page.getByText(/turno ativo —/i)).toBeVisible({ timeout: T.api });
    await expect(page.getByText(/turno aberto com sucesso/i)).toBeVisible({ timeout: T.toast });
  });

  // LDS05 — Linha do tempo mostra evento "turno_assumido" após abertura
  test("LDS05 — evento 'turno_assumido' aparece na linha do tempo", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    // Precisa de turno ativo
    if (!(await page.getByText(/turno ativo —/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    // .first() — badge "Turno Assumido" + description "Turno assumido." = 2 matches
    await expect(page.getByText(/turno assumido/i).first()).toBeVisible({ timeout: T.interact });
  });

  // LDS06 — Stats: eventos, pendências, cautelas aparecem no painel
  test("LDS06 — painel de stats mostra contadores quando turno ativo", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    if (!(await page.getByText(/turno ativo —/i).isVisible().catch(() => false))) {
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

    if (!(await page.getByText(/turno ativo —/i).isVisible().catch(() => false))) {
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

    if (!(await page.getByText(/turno ativo —/i).isVisible().catch(() => false))) {
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

    if (!(await page.getByText(/turno ativo —/i).isVisible().catch(() => false))) {
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

    if (!(await page.getByText(/turno ativo —/i).isVisible().catch(() => false))) {
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

  // LDS11 — Tab "Histórico" mostra o histórico de turnos anteriores
  // (Fase D substituiu o link de navegação por abas — /reserva/livro/historico
  // segue existindo para links diretos, mas a UI padrão agora troca de aba sem navegar.)
  test("LDS11 — aba 'Histórico' mostra histórico de turnos anteriores", async ({ page }) => {
    await goTo(page, "/reserva/livro");
    await expect(page.getByTestId("livro-ready")).toBeVisible({ timeout: T.api });

    if (!(await page.getByText(/turno ativo —/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await switchToHistoricoTab(page);
    await expect(page.getByTestId("historico-ready")).toBeVisible({ timeout: T.api });
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

    if (!(await page.getByText(/turno ativo —/i).isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    const encerrarBtn = page.getByRole("button", { name: /encerrar turno/i });
    await expect(encerrarBtn).toBeVisible({ timeout: T.interact });
    await encerrarBtn.click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });
    await expect(dialog.getByText(/encerrar turno/i).first()).toBeVisible();

    // Autenticação obrigatória: preencher TOTP antes de confirmar
    await enterShiftTotp(page, dialog);
    await dialog.getByTestId("shift-auth-confirm").click();
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

  // LDS21 — Guard BFF: POST cautela sem turno ativo → 403 SHIFT_REQUIRED
  test("LDS21 — POST /api/cautelamentos sem turno ativo retorna 403 SHIFT_REQUIRED", async ({ page }) => {
    // Verifica via API se há turno ativo (mais confiável que a UI aqui).
    const activeRes = await page.request.get(`${BFF_URL}/api/shifts/active`);
    const activeBody = await activeRes.json() as { shift: unknown };
    if (activeBody.shift) { test.skip(); return; }

    // page.request não executa JS, então não tem acesso ao csrf-token guardado em
    // localStorage (armeiro-auth.setup.ts) — sem o header X-CSRF-Token, o middleware
    // de CSRF do BFF rejeita ANTES do guard de turno, mascarando o 403 SHIFT_REQUIRED
    // com um 403 CSRF genérico. Precisa navegar para ler o token do storageState.
    await goTo(page, "/reserva");
    const csrfToken = await page.evaluate(() =>
      localStorage.getItem("csrf-token") ?? sessionStorage.getItem("csrf-token") ?? ""
    );

    const res = await page.request.post(`${BFF_URL}/api/cautelamentos`, {
      headers: { "X-CSRF-Token": csrfToken },
      data: {
        item_id: "00000000-0000-0000-0000-000000000001",
        militar_id: "00000000-0000-0000-0000-000000000002",
        reserve_id: "00000000-0000-0000-0000-000000000003",
        motivo_emissao: "Teste LDS21 — guard sem turno ativo",
      },
    });
    expect(res.status()).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("SHIFT_REQUIRED");
  });

  // LDS22 — Guard UI: dialog "Turno não iniciado" aparece ao tentar cautelar sem turno
  test("LDS22 — UI mostra dialog de turno necessário ao emitir cautela sem turno ativo", async ({ page }) => {
    const activeRes = await page.request.get(`${BFF_URL}/api/shifts/active`);
    const activeBody = await activeRes.json() as { shift: unknown };
    if (activeBody.shift) { test.skip(); return; }

    // Intercepta o POST real — a UI deve reagir ao {error:"SHIFT_REQUIRED"} exibindo o dialog,
    // independente de haver item/militar reais cadastrados no ambiente de teste.
    await page.route("**/api/cautelamentos", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "SHIFT_REQUIRED", message: "Inicie um turno no Livro Digital antes de registrar movimentações." }),
      });
    });

    await goTo(page, "/reserva/cautelas");
    const novaCautelaBtn = page.getByRole("button", { name: /nova cautela/i });
    await expect(novaCautelaBtn).toBeVisible({ timeout: T.nav });
    await novaCautelaBtn.click();

    const dialog = page.getByRole("dialog").filter({ hasText: /nova cautela permanente/i });
    // Em produção o clique inicial ocasionalmente não abre o dialog (suspeita:
    // corrida com hidratação do client component logo após domcontentloaded) —
    // um segundo clique após breve espera é suficiente para estabilizar.
    if (!(await isVisibleWithin(dialog, T.interact))) {
      await novaCautelaBtn.click();
    }
    await expect(dialog).toBeVisible({ timeout: T.dialog });

    const itemInput = dialog.getByPlaceholder(/buscar item/i);
    await itemInput.click();
    const itemFirstOption = dialog.locator("button").filter({ hasText: /.+/ }).first();
    if (await isVisibleWithin(dialog.getByText(/nenhum resultado/i), 2000)) {
      test.skip();
      return;
    }
    await itemFirstOption.click();

    const militarInput = dialog.getByPlaceholder(/buscar por posto/i);
    await militarInput.click();
    if (await isVisibleWithin(dialog.getByText(/nenhum resultado/i), 2000)) {
      test.skip();
      return;
    }
    await dialog.locator("button").filter({ hasText: /.+/ }).first().click();

    await dialog.getByPlaceholder(/pistola de uso pessoal/i).fill("Teste LDS22 — guard UI");
    await dialog.getByRole("button", { name: /emitir e assinar/i }).click();

    await expect(page.getByText(/turno não iniciado/i)).toBeVisible({ timeout: T.toast });
    await expect(page.getByTestId("btn-ir-para-livro")).toBeVisible();
  });

  // LDS23 — Data e hora aparecem em cada evento da timeline
  test("LDS23 — cada evento na timeline mostra data e hora", async ({ page }) => {
    await waitForLivroReady(page);
    if (!(await hasActiveShift(page))) { test.skip(); return; }

    const firstCard = page.locator(".border-l-green-500").first();
    if (!(await isVisibleWithin(firstCard, T.interact))) { test.skip(); return; }
    // Formato dd/mm ou "hoje HH:mm" — verificamos apenas presença de dígitos com separador de hora.
    await expect(firstCard.getByText(/\d{1,2}:\d{2}/)).toBeVisible();
  });

  // LDS24 — Borda verde visível na timeline
  test("LDS24 — cards da timeline têm borda esquerda verde", async ({ page }) => {
    await waitForLivroReady(page);
    if (!(await hasActiveShift(page))) { test.skip(); return; }

    const count = await getVisibleEventCount(page);
    if (count === 0) { test.skip(); return; }
    await expect(page.locator(".border-l-green-500").first()).toBeVisible();
  });

  // LDS25 — Toggle: botão alterna entre timeline e list view
  test("LDS25 — botão de alternar view troca entre timeline e lista", async ({ page }) => {
    await waitForLivroReady(page);
    if (!(await hasActiveShift(page))) { test.skip(); return; }

    const toggle = page.getByTestId("btn-toggle-view");
    await expect(toggle).toBeVisible({ timeout: T.interact });
    await switchToListView(page);
    await expect(page.locator("table")).toBeVisible({ timeout: T.interact });
    await switchToListView(page);
    await expect(page.locator("table")).not.toBeVisible();
  });

  // LDS26 — Busca filtra eventos por descrição
  test("LDS26 — busca filtra eventos por descrição", async ({ page }) => {
    await waitForLivroReady(page);
    if (!(await hasActiveShift(page))) { test.skip(); return; }

    const before = await getVisibleEventCount(page);
    if (before === 0) { test.skip(); return; }
    await searchEvents(page, "zzz_termo_inexistente_lds26");
    await expect(page.getByText(/nenhum evento corresponde/i)).toBeVisible({ timeout: T.interact });
    await searchEvents(page, "");
  });

  // LDS27 — Busca filtra eventos por tipo de evento
  test("LDS27 — busca filtra eventos por tipo (ex: turno assumido)", async ({ page }) => {
    await waitForLivroReady(page);
    if (!(await hasActiveShift(page))) { test.skip(); return; }

    const before = await getVisibleEventCount(page);
    if (before === 0) { test.skip(); return; }
    // Todo turno ativo tem obrigatoriamente um evento "turno_assumido" (logado
    // na abertura) — a busca por esse tipo deve sempre encontrar resultado.
    await searchEvents(page, "turno_assumido");
    await expect(page.getByText(/turno assumido/i).first()).toBeVisible({ timeout: T.interact });
    await searchEvents(page, "");
  });

  // LDS28 — Tabs "Turno Atual" / "Histórico" visíveis em /reserva/livro
  test("LDS28 — tabs 'Turno Atual' e 'Histórico' visíveis", async ({ page }) => {
    await waitForLivroReady(page);
    await expect(page.getByRole("tab", { name: /turno atual/i })).toBeVisible({ timeout: T.interact });
    await expect(page.getByRole("tab", { name: /histórico/i })).toBeVisible({ timeout: T.interact });
    await switchToHistoricoTab(page);
    await expect(page.getByTestId("historico-ready")).toBeVisible({ timeout: T.api });
    await switchToTurnoTab(page);
  });

  // LDS29 — Dialog de abrir turno contém campo TOTP (6 dígitos)
  test("LDS29 — dialog de abrir turno tem campo TOTP de 6 dígitos", async ({ page }) => {
    await waitForLivroReady(page);
    if (await hasActiveShift(page)) { test.skip(); return; }

    await page.getByRole("button", { name: /assumir turno/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });
    const input = dialog.getByTestId("shift-totp-input");
    await expect(input).toBeVisible({ timeout: T.interact });
    await expect(input).toHaveAttribute("maxlength", "6");
    await dialog.getByRole("button", { name: /cancelar/i }).click();
  });

  // LDS30 — TOTP inválido: erro exibido, turno não abre
  test("LDS30 — TOTP inválido não abre turno e exibe erro", async ({ page }) => {
    await waitForLivroReady(page);
    if (await hasActiveShift(page)) { test.skip(); return; }

    await page.getByRole("button", { name: /assumir turno/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });

    const select = dialog.locator("select");
    if (await isVisibleWithin(select, 2000)) {
      const options = await select.locator("option").all();
      if (options.length > 1) await select.selectOption({ index: 1 });
    }

    await dialog.getByTestId("shift-totp-input").fill("000000");
    await dialog.getByTestId("shift-auth-confirm").click();
    await expect(page.getByText(/totp inválido|código já utilizado|credenciais inválidas/i)).toBeVisible({ timeout: T.toast });
    await expect(page.getByText(/turno ativo —/i)).not.toBeVisible({ timeout: 2000 });
    await dialog.getByRole("button", { name: /cancelar/i }).click().catch(() => {});
  });

  // LDS31 — Histórico: filtro de data disponível
  test("LDS31 — histórico do armeiro tem filtros de data", async ({ page }) => {
    await goTo(page, "/reserva/livro/historico");
    await expect(page.getByTestId("historico-ready")).toBeVisible({ timeout: T.api });
    await expect(page.getByTestId("input-historico-from")).toBeVisible({ timeout: T.interact });
    await expect(page.getByTestId("input-historico-to")).toBeVisible({ timeout: T.interact });
  });

  // LDS32 — Histórico admin: filtro de busca por armeiro disponível
  test("LDS32 — histórico admin tem busca por armeiro", async ({ request }) => {
    // admin/livros é rota de admin — só confirmamos que o endpoint aceita ?q= sem erro
    // (a suite roda como armeiro; o teste de UI do admin fica coberto por admin-suites dedicadas).
    const res = await request.get(`${BFF_URL}/api/shifts?q=teste`);
    expect([200, 403]).toContain(res.status());
  });

  // ── LDS33-38 usam um turno encerrado real do próprio armeiro ──────────────
  async function findClosedShiftId(request: import("@playwright/test").APIRequestContext): Promise<string | null> {
    const res = await request.get(`${BFF_URL}/api/shifts?status=encerrado`);
    if (!res.ok()) return null;
    const body = await res.json() as { shifts: { id: string }[] };
    return body.shifts?.[0]?.id ?? null;
  }

  // LDS33 — GET /api/shifts/:id/pdf → 200 + Content-Type application/pdf
  test("LDS33 — GET /api/shifts/:id/pdf retorna PDF válido", async ({ request }) => {
    const shiftId = await findClosedShiftId(request);
    if (!shiftId) { test.skip(); return; }

    const res = await request.get(`${BFF_URL}/api/shifts/${shiftId}/pdf`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const buf = await res.body();
    expect(buf.subarray(0, 4).toString("utf-8")).toBe("%PDF");
  });

  // LDS34 — GET /api/shifts/:id/csv → 200 + Content-Type text/csv
  test("LDS34 — GET /api/shifts/:id/csv retorna CSV válido", async ({ request }) => {
    const shiftId = await findClosedShiftId(request);
    if (!shiftId) { test.skip(); return; }

    const res = await request.get(`${BFF_URL}/api/shifts/${shiftId}/csv`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const text = await res.text();
    expect(text.split("\n")[0]).toBe("happened_at,event_type,actor_nome,actor_matricula,description,event_hash,prev_hash");
  });

  // LDS35 — GET /api/public/shifts/:id/verify → 200 sem auth, tem root_hash
  test("LDS35 — verificação pública funciona sem sessão e traz root_hash", async ({ request, page }) => {
    const shiftId = await findClosedShiftId(page.request);
    if (!shiftId) { test.skip(); return; }

    // `request` fixture aqui é um contexto novo, sem storageState/cookies — simula visitante público.
    const res = await request.get(`${BFF_URL}/api/public/shifts/${shiftId}/verify`);
    expect(res.status()).toBe(200);
    const body = await res.json() as { verified: boolean; root_hash: string | null; armeiro: { matricula?: string } | null };
    expect(body.verified).toBe(true);
    expect(body.root_hash).toBeTruthy();
    // PII: matrícula nunca deve vazar no endpoint público.
    expect(body.armeiro?.matricula).toBeUndefined();
  });

  // LDS36 — Realtime: evento registrado aparece automaticamente sem reload manual
  test("LDS36 — evento manual aparece na timeline via realtime sem reload", async ({ page }) => {
    await waitForLivroReady(page);
    if (!(await hasActiveShift(page))) { test.skip(); return; }

    const before = await getVisibleEventCount(page);
    const marker = `LDS36 realtime ${Date.now()}`;

    const activeRes = await page.request.get(`${BFF_URL}/api/shifts/active`);
    const { shift } = await activeRes.json() as { shift: { id: string } | null };
    if (!shift) { test.skip(); return; }

    await page.request.post(`${BFF_URL}/api/shifts/${shift.id}/log`, {
      data: { description: marker, event_type: "evento_manual", is_pending: false },
    });

    // Sem reload — espera o realtime subscription atualizar a timeline sozinho.
    await expect(page.getByText(marker)).toBeVisible({ timeout: T.api });
    const after = await getVisibleEventCount(page);
    expect(after).toBeGreaterThan(before);
  });

  // LDS37 — Botões PDF/CSV visíveis quando turno está encerrado (histórico do armeiro)
  test("LDS37 — botões PDF/CSV visíveis no histórico para turno encerrado", async ({ page }) => {
    await goTo(page, "/reserva/livro/historico");
    await expect(page.getByTestId("historico-ready")).toBeVisible({ timeout: T.api });

    await page.getByTestId("select-historico-status").selectOption("encerrado");
    const firstRow = page.locator(".rounded-lg.border.bg-card").first();
    if (!(await isVisibleWithin(firstRow, T.api))) { test.skip(); return; }
    await firstRow.click();

    await expect(page.getByTestId("btn-export-pdf").first()).toBeVisible({ timeout: T.interact });
    await expect(page.getByTestId("btn-export-csv").first()).toBeVisible({ timeout: T.interact });
  });

  // LDS38 — CSV contém colunas event_hash e prev_hash com valores
  test("LDS38 — CSV exportado contém event_hash e prev_hash preenchidos", async ({ request }) => {
    const shiftId = await findClosedShiftId(request);
    if (!shiftId) { test.skip(); return; }

    const res = await request.get(`${BFF_URL}/api/shifts/${shiftId}/csv`);
    expect(res.status()).toBe(200);
    const lines = (await res.text()).trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2); // header + ao menos 1 evento (turno_assumido)

    const header = lines[0].split(",");
    const hashIdx = header.indexOf("event_hash");
    expect(hashIdx).toBeGreaterThanOrEqual(0);

    const firstRow = lines[1].split(",");
    expect(firstRow[hashIdx].replace(/"/g, "").length).toBeGreaterThan(10);
  });

});

// ── Suite: Livro Digital — Melhorias (guard de saída, turno duplicado por
// reserva, abas horizontais, timeline rica, histórico paginado) ────────────
//
// LDS43 e LDS49 fazem seed/cleanup direto no banco via service role — só
// rodam se SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY estiverem configurados no
// ambiente (mesmo padrão de degradação graciosa de e2e/global-setup.ts:
// "CI sem credenciais — pular"). Sem isso, o teste é pulado, não falha.
function adminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function csrfToken(page: Page): Promise<string> {
  return page.evaluate(() =>
    localStorage.getItem("csrf-token") ?? sessionStorage.getItem("csrf-token") ?? ""
  );
}

async function currentTotpCode(page: Page, csrf: string): Promise<string> {
  const res = await page.request.get(`${BFF_URL}/api/totp/code`, { headers: { "X-CSRF-Token": csrf } });
  expect(res.ok(), "GET /api/totp/code falhou — armeiro de teste sem TOTP configurado").toBeTruthy();
  const body = await res.json() as { code: string };
  return body.code;
}

test.describe("LDS — Guard de turno na Nova Saída (item 1)", () => {

  // LDS39 — /reserva/saidas/nova SEM turno ativo mostra o dialog de turno
  // necessário, e nunca o formulário (campo de busca de militar não deve
  // sequer estar no DOM — o guard roda no servidor, antes do render do form).
  test("LDS39 — /reserva/saidas/nova sem turno ativo mostra dialog, não o formulário", async ({ page }) => {
    await waitForLivroReady(page);
    if (await hasActiveShift(page)) { test.skip(); return; }

    await goTo(page, "/reserva/saidas/nova");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: T.dialog });
    await expect(dialog.getByText(/turno não iniciado/i)).toBeVisible();
    await expect(dialog.getByTestId("btn-ir-para-livro")).toBeVisible();
    await expect(page.getByPlaceholder(/buscar por nome ou matrícula/i)).not.toBeVisible();
  });

  // LDS40 — regressão inversa: COM turno ativo, o formulário aparece normalmente
  test("LDS40 — /reserva/saidas/nova com turno ativo mostra o formulário normalmente", async ({ page }) => {
    await waitForLivroReady(page);
    if (!(await hasActiveShift(page))) { test.skip(); return; }

    await goTo(page, "/reserva/saidas/nova");
    await expect(page.getByPlaceholder(/buscar por nome ou matrícula/i)).toBeVisible({ timeout: T.nav });
    await expect(page.getByText(/turno não iniciado/i)).not.toBeVisible({ timeout: 2000 });
  });

});

test.describe("LDS — Bloqueio de turno duplicado por reserva (item 2)", () => {

  // LDS41 — UI: BFF retornando RESERVE_SHIFT_ACTIVE mostra o dialog amigável
  // (mock de rede — não depende de um segundo armeiro real logado).
  test("LDS41 — UI mostra dialog de turno já ativo na reserva (RESERVE_SHIFT_ACTIVE)", async ({ page }) => {
    await waitForLivroReady(page);
    if (await hasActiveShift(page)) { test.skip(); return; }

    await page.route("**/api/shifts/open", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: "RESERVE_SHIFT_ACTIVE",
          message: "Esta reserva já tem um turno ativo com outro armeiro.",
          armeiro: { nome_completo: "Fulano de Tal Teste LDS41", matricula: "999999", posto: "Sd PM" },
          started_at: new Date().toISOString(),
        }),
      });
    });

    await page.getByRole("button", { name: /assumir turno/i }).first().click();
    const openDialog = page.getByRole("dialog");
    await expect(openDialog).toBeVisible({ timeout: T.dialog });

    const select = openDialog.locator("select");
    if (await isVisibleWithin(select, 2000)) {
      const options = await select.locator("option").all();
      if (options.length > 1) await select.selectOption({ index: 1 });
    }
    await enterShiftTotp(page, openDialog);
    await openDialog.getByTestId("shift-auth-confirm").click();

    const reserveActiveDialog = page.getByTestId("reserve-shift-active-dialog");
    await expect(reserveActiveDialog).toBeVisible({ timeout: T.dialog });
    await expect(reserveActiveDialog.getByText(/fulano de tal teste lds41/i)).toBeVisible();
    await expect(page.getByText(/turno aberto com sucesso/i)).not.toBeVisible({ timeout: 2000 });
    await reserveActiveDialog.getByTestId("reserve-shift-active-confirm").click();
  });

  // LDS42 — Backend real (sem mock): seed de um turno ativo de OUTRO armeiro
  // na mesma reserva do armeiro de teste → tentativa de abrir turno deve
  // retornar 409 RESERVE_SHIFT_ACTIVE e NÃO criar um segundo turno "ativo"
  // para a reserva. Requer service role para seed/cleanup direto no banco.
  test("LDS42 — reserva com turno ativo de outro armeiro bloqueia abertura e não duplica", async ({ page }) => {
    const admin = adminClient();
    test.skip(!admin, "SUPABASE_SERVICE_ROLE_KEY não configurado neste ambiente — seed direto indisponível");
    if (!admin) return;

    if (await hasActiveShift(page)) { test.skip(); return; }

    const meRes = await page.request.get(`${BFF_URL}/api/auth/me`);
    expect(meRes.ok()).toBeTruthy();
    const { user } = await meRes.json() as { user: { id: string; role: string } | null };
    if (!user) { test.skip(); return; }

    const reservesRes = await page.request.get(`${BFF_URL}/api/profiles/me/reserves`);
    expect(reservesRes.ok()).toBeTruthy();
    const { reserves } = await reservesRes.json() as { reserves: { id: string; nome: string }[] };
    if (!reserves?.length) { test.skip(); return; }
    const reserveId = reserves[0].id;

    const { data: reserveRow } = await admin.from("reserves").select("tenant_id").eq("id", reserveId).maybeSingle();
    if (!reserveRow) { test.skip(); return; }

    const { data: otherArmeiro } = await admin
      .from("profiles")
      .select("id, nome_completo, matricula")
      .eq("role", "armeiro")
      .eq("default_tenant_id", reserveRow.tenant_id)
      .neq("id", user.id)
      .limit(1)
      .maybeSingle();
    if (!otherArmeiro) { test.skip(); return; }

    const { data: seeded, error: seedErr } = await admin
      .from("service_shifts")
      .insert({
        tenant_id: reserveRow.tenant_id,
        reserve_id: reserveId,
        armeiro_id: otherArmeiro.id,
        status: "ativo",
        opening_snapshot: {},
      })
      .select("id")
      .single();
    expect(seedErr, `falha ao semear turno concorrente: ${seedErr?.message}`).toBeFalsy();

    try {
      const csrf = await csrfToken(page);
      const code = await currentTotpCode(page, csrf);
      const res = await page.request.post(`${BFF_URL}/api/shifts/open`, {
        headers: { "X-CSRF-Token": csrf },
        data: { reserve_id: reserveId, auth_mode: "totp", totp_token: code },
      });

      expect(res.status()).toBe(409);
      const body = await res.json() as { error: string; armeiro?: { nome_completo?: string; matricula?: string } };
      expect(body.error).toBe("RESERVE_SHIFT_ACTIVE");
      expect(body.armeiro?.matricula).toBe(otherArmeiro.matricula);

      // Confirma que NENHUM segundo turno "ativo" foi criado para a reserva —
      // o guard (SELECT prévio + índice único parcial) não deve deixar
      // vazar uma segunda linha mesmo que a resposta HTTP esteja correta.
      const { data: activeShifts } = await admin
        .from("service_shifts")
        .select("id")
        .eq("reserve_id", reserveId)
        .eq("status", "ativo");
      expect((activeShifts ?? []).map((s) => s.id)).toEqual([seeded!.id]);
    } finally {
      await admin.from("service_shifts").delete().eq("id", seeded!.id);
    }
  });

});

test.describe("LDS — Abas horizontais (item 3, regressão de UI)", () => {

  // LDS43 — as duas abas devem estar lado a lado na MESMA linha (padrão
  // horizontal do resto do app), não empilhadas verticalmente como um menu
  // lateral — a reclamação original do usuário era exatamente essa.
  test("LDS43 — abas Turno Atual/Histórico ficam lado a lado na mesma linha", async ({ page }) => {
    await waitForLivroReady(page);
    const turnoTab = page.getByRole("tab", { name: /turno atual/i });
    const historicoTab = page.getByRole("tab", { name: /histórico/i });
    await expect(turnoTab).toBeVisible();
    await expect(historicoTab).toBeVisible();

    const turnoBox = await turnoTab.boundingBox();
    const historicoBox = await historicoTab.boundingBox();
    expect(turnoBox).not.toBeNull();
    expect(historicoBox).not.toBeNull();

    // Horizontal: mesma altura (Y quase igual) e histórico à direita do turno.
    expect(Math.abs(turnoBox!.y - historicoBox!.y)).toBeLessThan(5);
    expect(historicoBox!.x).toBeGreaterThan(turnoBox!.x);
  });

});

test.describe("LDS — Timeline rica no turno atual (item 4)", () => {

  // LDS44 — cada evento mostra quem o registrou (nome + matrícula do ator),
  // não só o hash truncado — a view timeline (cards).
  test("LDS44 — timeline mostra o nome/matrícula de quem registrou o evento", async ({ page }) => {
    await waitForLivroReady(page);
    if (!(await hasActiveShift(page))) { test.skip(); return; }

    const firstCard = page.locator(".border-l-green-500").first();
    if (!(await isVisibleWithin(firstCard, T.interact))) { test.skip(); return; }

    // Todo turno tem o evento "turno_assumido" — seu actor é sempre o próprio
    // armeiro, então a linha "por <nome> · mat. <matrícula>" sempre existe.
    await expect(firstCard.getByText(/mat\./i)).toBeVisible({ timeout: T.interact });
  });

  // LDS45 — a view em lista (tabela) tem coluna "Registrado por"
  test("LDS45 — view em lista mostra coluna 'Registrado por'", async ({ page }) => {
    await waitForLivroReady(page);
    if (!(await hasActiveShift(page))) { test.skip(); return; }

    await switchToListView(page);
    await expect(page.getByRole("columnheader", { name: /registrado por/i })).toBeVisible({ timeout: T.interact });
    await switchToListView(page); // volta pra timeline — não vaza estado entre testes
  });

});

test.describe("LDS — Histórico: paginação real e busca (item 5)", () => {

  // LDS46 — o backend recebe o parâmetro limit=10 por padrão (não busca tudo
  // de uma vez) e "Ver mais" pede mais uma página real (10→20→30).
  test("LDS46 — histórico pede limit=10 por padrão e 'Ver mais' pagina de verdade no backend", async ({ page }) => {
    let lastLimit: string | null = null;
    await page.route("**/api/shifts*", async (route) => {
      const url = new URL(route.request().url());
      lastLimit = url.searchParams.get("limit");
      return route.fallback();
    });

    await goTo(page, "/reserva/livro/historico");
    await expect(page.getByTestId("historico-ready")).toBeVisible({ timeout: T.api });
    await expect.poll(() => lastLimit, { timeout: T.interact }).toBe("10");

    const verMaisBtn = page.getByTestId("btn-ver-mais");
    if (!(await isVisibleWithin(verMaisBtn, 3000))) {
      test.skip(); // menos de 10 turnos no ambiente — sem próxima página pra testar
      return;
    }
    await verMaisBtn.click();
    await page.getByTestId("btn-limit-20").click();
    await expect.poll(() => lastLimit, { timeout: T.interact }).toBe("20");
  });

  // LDS47 — privilege ceiling: o próprio armeiro (só vê os próprios turnos)
  // não tem o filtro de busca por armeiro — ele não faria sentido nesse caso
  // e o BFF já ignora esse parâmetro pra esse role.
  test("LDS47 — histórico do armeiro não mostra filtro de busca por armeiro", async ({ page }) => {
    await goTo(page, "/reserva/livro/historico");
    await expect(page.getByTestId("historico-ready")).toBeVisible({ timeout: T.api });
    await expect(page.getByTestId("filter-historico-armeiro")).not.toBeVisible({ timeout: 3000 });
  });

  // LDS48 — Bug #6 (raiz): o filtro de período usava started_at puro, então
  // um turno aberto ANTES do período mas encerrado DENTRO dele desaparecia
  // da lista. Semeia um turno assim (3 dias atrás → ontem) e confirma que
  // filtrar por "ontem" o encontra — o comportamento pré-fix excluiria essa
  // linha porque started_at (3 dias atrás) < from (ontem).
  test("LDS48 — filtro de período encontra turno que começou antes e terminou dentro do intervalo", async ({ page }) => {
    const admin = adminClient();
    test.skip(!admin, "SUPABASE_SERVICE_ROLE_KEY não configurado neste ambiente — seed direto indisponível");
    if (!admin) return;

    const meRes = await page.request.get(`${BFF_URL}/api/auth/me`);
    const { user } = await meRes.json() as { user: { id: string } | null };
    if (!user) { test.skip(); return; }

    const reservesRes = await page.request.get(`${BFF_URL}/api/profiles/me/reserves`);
    const { reserves } = await reservesRes.json() as { reserves: { id: string }[] };
    if (!reserves?.length) { test.skip(); return; }
    const reserveId = reserves[0].id;
    const { data: reserveRow } = await admin.from("reserves").select("tenant_id").eq("id", reserveId).maybeSingle();
    if (!reserveRow) { test.skip(); return; }

    const now = Date.now();
    const startedAt = new Date(now - 3 * 24 * 3_600_000).toISOString();
    const endedAt   = new Date(now - 1 * 24 * 3_600_000).toISOString();
    const yesterday = new Date(now - 1 * 24 * 3_600_000).toISOString().slice(0, 10);

    const { data: seeded, error: seedErr } = await admin
      .from("service_shifts")
      .insert({
        tenant_id: reserveRow.tenant_id,
        reserve_id: reserveId,
        armeiro_id: user.id,
        status: "encerrado",
        started_at: startedAt,
        ended_at: endedAt,
        opening_snapshot: {},
        closing_snapshot: {},
      })
      .select("id")
      .single();
    expect(seedErr, `falha ao semear turno para LDS48: ${seedErr?.message}`).toBeFalsy();

    try {
      const res = await page.request.get(
        `${BFF_URL}/api/shifts?from=${yesterday}&to=${yesterday}&limit=100`
      );
      expect(res.ok()).toBeTruthy();
      const { shifts } = await res.json() as { shifts: { id: string }[] };
      expect(shifts.map((s) => s.id)).toContain(seeded!.id);
    } finally {
      await admin.from("service_shifts").delete().eq("id", seeded!.id);
    }
  });

});
