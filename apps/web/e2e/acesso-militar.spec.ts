/**
 * APMCB — E2E: jornada REAL de acesso do militar (uso de ponta a ponta)
 *
 * Cobre os fixes de produção de 2026-09-09 (PR #7):
 *   AM01  admin cadastra militar (role usuario) + marca "enviar e-mail de acesso"
 *         → toast "Convite enviado", sem 500
 *   AM02  cadastrar a MESMA matrícula de novo → mensagem 409 clara
 *         ("Matrícula já cadastrada. Use 'Militar já cadastrado' …"), NUNCA 500 mudo
 *   AM03  o link do e-mail (/auth/callback?token_hash=…&type=recovery&next=…)
 *         leva a /auth/update-password — NÃO a /auth/error (era o bug)
 *   AM04  militar define a senha → "Senha atualizada" → "Ir para o login" → /login
 *
 * Roda contra produção (E2E_BASE_URL). O militar de teste usa matrícula com
 * prefixo E2E → global-teardown (is-ephemeral-account.ts) limpa; o afterAll
 * também inativa + bane como rede de segurança (hard-delete falha pela FK
 * imutável de audit_events depois que a conta gera trilha).
 */

import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BASE_URL, BFF_URL, login, T } from "./harness";

function adminSupabase(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

const RUN = Math.random().toString(36).slice(2, 8).toUpperCase();
const MATRICULA = `E2EACESSO${RUN}`;
const NOME = `E2E Acesso Militar ${RUN}`;
const EMAIL = `e2e.acesso.${RUN.toLowerCase()}@e2e.test`;
const SENHA = `E2eAcesso#${RUN}9`;

test.describe.configure({ mode: "serial" });

test.describe("AM — jornada de acesso do militar (real)", () => {
  let militarUserId: string | null = null;

  test.afterAll(async () => {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    const db = adminSupabase();
    const { data } = await db.from("profiles").select("id").eq("matricula", MATRICULA).maybeSingle();
    const id = militarUserId ?? data?.id;
    if (!id) return;
    // hard-delete falha se a conta já gerou audit_events → inativa + bane.
    const del = await db.from("profiles").delete().eq("id", id);
    if (del.error) {
      await db.from("profiles").update({ registration_status: "inactive", role: "usuario" }).eq("id", id);
    }
    const authDel = await db.auth.admin.deleteUser(id);
    if (authDel.error) await db.auth.admin.updateUserById(id, { ban_duration: "876000h" });
  });

  test("AM01 — cadastrar militar + enviar e-mail de acesso (sem 500)", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    await page.getByTestId("btn-cadastrar-usuario").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Cadastrar Usuário" })).toBeVisible();

    await dialog.locator("#cm-nome").fill(NOME);
    await dialog.locator("#cm-matricula").fill(MATRICULA);
    await dialog.getByLabel("Perfil inicial").selectOption("Usuário");
    await dialog.getByRole("checkbox", { name: /enviar e-mail de acesso/i }).check();
    await dialog.getByRole("textbox", { name: /e-mail do usuário/i }).fill(EMAIL);

    const created = page.waitForResponse(
      (r) => r.url().includes("/api/admin/militares") && r.request().method() === "POST",
    );
    await dialog.getByTestId("cm-submit-btn").click();
    expect((await created).status()).toBe(200);

    await expect(dialog.getByText(/cadastrado com sucesso/i)).toBeVisible({ timeout: T.navigation });
    await expect(dialog.getByText(new RegExp(`Convite enviado para ${EMAIL}`, "i"))).toBeVisible();

    const db = adminSupabase();
    const { data } = await db
      .from("profiles")
      .select("id, role, email, registration_status")
      .eq("matricula", MATRICULA)
      .single();
    militarUserId = data!.id;
    expect(data!.role).toBe("usuario");
    expect(data!.email).toBe(EMAIL);
  });

  test("AM02 — matrícula duplicada → 409 com mensagem clara, nunca 500", async ({ page }) => {
    await login(page, "admin");
    await page.goto(`${BASE_URL}/admin/usuarios`, { waitUntil: "load" });

    await page.getByTestId("btn-cadastrar-usuario").click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#cm-nome").fill(`${NOME} DUP`);
    await dialog.locator("#cm-matricula").fill(MATRICULA);

    const resp = page.waitForResponse(
      (r) => r.url().includes("/api/admin/militares") && r.request().method() === "POST",
    );
    await dialog.getByTestId("cm-submit-btn").click();

    const r = await resp;
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toMatch(/matrícula já cadastrada/i);
    // a UI mostra a mensagem amigável, não um genérico "erro ao criar"
    await expect(page.getByText(/matrícula já cadastrada/i).first()).toBeVisible({ timeout: T.apiResponse });
  });

  test("AM03 — link do e-mail leva a /auth/update-password, NÃO a /auth/error", async ({ page, browser }) => {
    // gera um recovery link fresco (o mesmo shape que o e-mail carrega)
    const db = adminSupabase();
    const link = await db.auth.admin.generateLink({ type: "recovery", email: EMAIL });
    const hashedToken = link.data?.properties?.hashed_token;
    expect(hashedToken, "generateLink devolve hashed_token").toBeTruthy();

    // contexto limpo (militar não está logado)
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    await p.goto(
      `${BASE_URL}/auth/callback?token_hash=${hashedToken}&type=recovery&next=/auth/update-password`,
      { waitUntil: "load" },
    );
    await p.waitForURL("**/auth/update-password", { timeout: T.navigation });
    expect(p.url()).toContain("/auth/update-password");
    expect(p.url()).not.toContain("/auth/error");
    await expect(p.getByText(EMAIL)).toBeVisible();

    // AM04 — define a senha e cai no login
    await p.getByRole("textbox", { name: /nova senha/i }).fill(SENHA);
    await p.getByRole("textbox", { name: /confirmar senha/i }).fill(SENHA);
    await p.getByRole("button", { name: /definir nova senha/i }).click();
    await expect(p.getByText(/senha atualizada/i)).toBeVisible({ timeout: T.navigation });
    await p.getByRole("button", { name: /ir para o login/i }).click();
    await p.waitForURL("**/login", { timeout: T.navigation });

    await ctx.close();
  });

  test("AM05 — endpoint enviar-acesso exige sessão (401/403)", async () => {
    const res = await fetch(`${BFF_URL}/api/admin/users/enviar-acesso`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: militarUserId ?? "00000000-0000-0000-0000-000000000000", email: EMAIL }),
    });
    expect([401, 403]).toContain(res.status);
  });
});
