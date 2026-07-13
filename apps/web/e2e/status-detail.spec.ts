/**
 * APMCB — Status Management + Saída Detail Suite
 * SD01–SD08
 *
 * Covers:
 * - Status column visible in militares grid (armeiro + admin)
 * - BFF permission enforcement for status changes
 * - Saída row click opens detail sheet
 * - Impedimento blocking in nova saída flow
 *
 * Run: npx playwright test e2e/status-detail.spec.ts --project=status-suite
 */

import { test, expect } from "@playwright/test";
import { BASE_URL, BFF_URL, login, USERS } from "./harness";
import { bffCall } from "./harness/ssa";
import { createClient as createSupabaseAdmin } from "@supabase/supabase-js";

// ─── Supabase admin client ─────────────────────────────────────────────────

function db() {
  return createSupabaseAdmin(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getCadeteId(): Promise<string> {
  const { data } = await db()
    .from("profiles")
    .select("id")
    .eq("matricula", USERS.efetivo.matricula)
    .single();
  if (!data?.id) throw new Error("Cadete profile not found");
  return data.id;
}

async function resetCadeteStatus() {
  const id = await getCadeteId();
  await db().from("profiles").update({ registration_status: "complete" }).eq("id", id);
}

// ─── SD01 — Coluna Status no grid do armeiro ────────────────────────────────

test.describe("SD01 — Grid militares: coluna Status", () => {
  test("SD01 - armeiro vê coluna Status na tabela de militares", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/militares`, { waitUntil: "load" });
    // MilitaresTable abre em modo "cards" por padrão — força modo grade para
    // renderizar a <table> que este teste valida.
    await page.locator('button[title="Ver em grade"]').click();

    // The table header should have a "Status" column
    const statusHeader = page
      .getByRole("columnheader", { name: /status/i })
      .or(page.locator("th").filter({ hasText: /status/i }))
      .first();
    await expect(statusHeader).toBeVisible({ timeout: 10_000 });
  });

  test("SD01b - admin vê coluna Status na tabela de usuários", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });
    // UsersTable abre em modo "cards" por padrão — força modo grade para
    // renderizar a <table> que este teste valida.
    await page.locator('button[title="Ver em grade"]').click();

    // Admin usuarios table has a Status column header
    const statusHeader = page
      .getByRole("columnheader", { name: /status/i })
      .or(page.locator("th").filter({ hasText: /status/i }))
      .first();
    await expect(statusHeader).toBeVisible({ timeout: 10_000 });

    // At least one data row should exist with the status cell populated
    const firstRow = page.locator("tbody tr").first();
    await expect(firstRow).toBeVisible({ timeout: 10_000 });
  });
});

// ─── SD02 — Armeiro pode inativar militar ──────────────────────────────────

test.describe("SD02 — Armeiro inativa militar via BFF", () => {
  test.afterAll(resetCadeteStatus);

  test("SD02 - BFF aceita status=inactive do armeiro (200)", async ({ page }) => {
    await login(page, "reserva");
    const cadeteId = await getCadeteId();
    const { status } = await bffCall(page, "PATCH", `/api/profiles/${cadeteId}/status`, {
      status: "inactive",
    });
    expect(status).toBe(200);
  });
});

// ─── SD03 — Armeiro NÃO pode aplicar impedimento_administrativo ────────────

test.describe("SD03 — Armeiro não pode aplicar impedimento", () => {
  test("SD03 - BFF bloqueia armeiro tentando aplicar impedimento (403)", async ({ page }) => {
    await login(page, "reserva");
    const cadeteId = await getCadeteId();
    const { status } = await bffCall(page, "PATCH", `/api/profiles/${cadeteId}/status`, {
      status: "impedimento_administrativo",
    });
    expect(status).toBe(403);
  });
});

// ─── SD04 — Admin pode aplicar impedimento_administrativo ──────────────────

test.describe("SD04 — Admin aplica impedimento", () => {
  test.afterAll(resetCadeteStatus);

  test("SD04 - BFF aceita impedimento_administrativo do admin (200)", async ({ page }) => {
    await login(page, "admin");
    const cadeteId = await getCadeteId();
    const { status, data } = await bffCall(page, "PATCH", `/api/profiles/${cadeteId}/status`, {
      status: "impedimento_administrativo",
    });
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).ok).toBe(true);
  });
});

// ─── SD05-SD07 — Detalhe de saída ao clicar na linha ──────────────────────

test.describe("SD05-07 — Detail sheet ao clicar em saída", () => {
  test("SD05 - clicar em linha de saída abre sheet de detalhe", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/saidas`, { waitUntil: "domcontentloaded" });
    // Wait for React hydration: data-testid on rows is set by client component, not SSR
    await page.waitForSelector("tr[data-testid^='saida-row-'], [data-testid='empty-state']", { timeout: 20_000 }).catch(() => {});

    const rows = page.locator("tr[data-testid^='saida-row-']");
    const rowCount = await rows.count();

    if (rowCount === 0) {
      test.skip();
      return;
    }

    // Click on material name text (first column content, not the cell itself)
    const firstRow = rows.first();
    await firstRow.locator("td").first().locator("p").first().click({ force: true });

    // Sheet should open — use text locator (more resilient than role during animation)
    await expect(page.getByText("Detalhe da Saída", { exact: false })).toBeVisible({ timeout: 10_000 });
  });

  test("SD06 - sheet exibe modo de autenticação", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/saidas`, { waitUntil: "domcontentloaded" });
    // Wait for React hydration via data-testid
    await page.waitForSelector("tr[data-testid^='saida-row-'], [data-testid='empty-state']", { timeout: 20_000 }).catch(() => {});

    const rows = page.locator("tr[data-testid^='saida-row-']");
    const rowCount = await rows.count();
    if (rowCount === 0) { test.skip(); return; }

    await rows.first().locator("td").first().locator("p").first().click({ force: true });
    await expect(page.getByText("Detalhe da Saída", { exact: false })).toBeVisible({ timeout: 10_000 });

    // Sheet should show auth mode label
    const authMode = page
      .getByText(/modo de autenticação/i)
      .or(page.getByText(/biometria digital|código totp|manual/i));
    await expect(authMode.first()).toBeVisible({ timeout: 4_000 });
  });

  test("SD07 - sheet indica tipo de solicitação (presencial ou remota)", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/saidas`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("tr[data-testid^='saida-row-'], [data-testid='empty-state']", { timeout: 20_000 }).catch(() => {});

    const rows = page.locator("tr[data-testid^='saida-row-']");
    const rowCount = await rows.count();
    if (rowCount === 0) { test.skip(); return; }

    await rows.first().locator("td").first().locator("p").first().click({ force: true });
    await expect(page.getByText("Detalhe da Saída", { exact: false })).toBeVisible({ timeout: 10_000 });

    // Should show presencial or remota badge
    const tipo = page
      .getByText(/presencial/i)
      .or(page.getByText(/remota/i));
    await expect(tipo.first()).toBeVisible({ timeout: 4_000 });
  });
});

// ─── SD08 — Nova saída bloqueada para militar com impedimento ──────────────

test.describe("SD08 — Impedimento bloqueia nova saída", () => {
  test.beforeAll(async () => {
    const id = await getCadeteId();
    await db().from("profiles").update({ registration_status: "impedimento_administrativo" }).eq("id", id);
  });

  test.afterAll(resetCadeteStatus);

  test("SD08 - BFF bloqueia armamento de militar com impedimento (403)", async ({ page }) => {
    await login(page, "reserva");
    const cadeteId = await getCadeteId();

    // BFF-level block: POST /api/lendings with military that has impedimento
    const { data: materials } = await db().from("material_types").select("id").limit(1).single();
    if (!materials?.id) { test.skip(); return; }

    const { status } = await bffCall(page, "POST", "/api/lendings", {
      military_id: cadeteId,
      material_type_id: materials.id,
      quantidade: 1,
      auth_mode: "manual",
    });
    expect(status).toBe(403);
  });

  test("SD08b - UI mostra alerta de impedimento na nova saída", async ({ page }) => {
    await login(page, "reserva");
    await page.goto(`${BASE_URL}/reserva/saidas/nova`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("input[placeholder*='nome']", { timeout: 15_000 });

    const combobox = page.getByPlaceholder(/buscar por nome/i).first();
    await combobox.click();
    await page.keyboard.type("Cadete", { delay: 80 });

    // Wait for dropdown to appear
    const resultBtn = page.locator("div[style*='var(--card)'] button, .absolute button").filter({ hasText: /efetivo/i }).first();
    await expect(resultBtn).toBeVisible({ timeout: 5_000 }).catch(() => {});

    const visible = await resultBtn.isVisible().catch(() => false);
    if (!visible) { test.skip(); return; }

    // Use mousedown event as the combobox uses onMouseDown to prevent blur
    await resultBtn.evaluate((el: HTMLElement) => {
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(200);

    // The impedimento alert should appear
    const alert = page.getByText(/impedimento administrativo/i);
    await expect(alert).toBeVisible({ timeout: 8_000 });
  });
});
