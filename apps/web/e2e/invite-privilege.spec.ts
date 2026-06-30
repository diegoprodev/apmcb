/**
 * invite-privilege.spec.ts — Fase 7C
 *
 * Testa o Privilege Ceiling em POST /api/admin/users/invite.
 * Cada role só pode convidar até o próprio teto (INVITE_CEILING no BFF).
 *
 * INV-01  admin_global convida admin_reserva → 201
 * INV-02  admin_global tenta convidar superadmin → 403
 * INV-03  admin_global convida armeiro → 201
 * INV-04  admin_global tenta convidar papel inválido → 403
 * INV-05  admin_reserva convida auditor → 201
 * INV-06  admin_reserva tenta convidar admin_global → 403
 * INV-07  armeiro convida efetivo (usuario) → 201
 * INV-08  armeiro tenta convidar armeiro → 403
 *
 * SEC-02  admin_global bloqueado em GET /api/nexus/health (requer nexus 2FA)
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BFF_URL, USERS } from "./harness";

const SUPABASE_URL  = process.env.SUPABASE_URL!;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Login via BFF /api/auth/exchange → iron-session cookie. */
async function apiLogin(email: string, password: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.session) return null;

  const { access_token, refresh_token } = data.session;
  const res = await fetch(`${BFF_URL}/api/auth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_token, refresh_token }),
  });

  if (!res.ok) return null;
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/apmcb_session=[^;]+/);
  return match ? match[0] : null;
}

/** Cria usuário temporário com role específico via service_role. */
async function createTempUser(email: string, role: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const matricula = String(Math.floor(Math.random() * 900000) + 100000);
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: "Teste@Inv2026",
    email_confirm: true,
    user_metadata: { nome_completo: `Temp ${role}`, matricula },
  });

  if (error || !data?.user) { console.error("createUser:", error?.message); return null; }

  const userId = data.user.id;

  // Aguarda trigger do profile (até 5s)
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { data: p } = await supabase.from("profiles").select("id").eq("id", userId).single();
    if (p) break;
  }

  await supabase.from("profiles").upsert(
    { id: userId, nome_completo: `Temp ${role}`, matricula, role, registration_status: "complete" },
    { onConflict: "id" }
  );

  return userId;
}

async function deleteTempUser(id: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await supabase.auth.admin.deleteUser(id);
}

/** POST /api/admin/users/invite com cookie de sessão do caller. */
async function callInvite(
  cookie: string,
  targetEmail: string,
  targetRole: string
): Promise<Response> {
  return fetch(`${BFF_URL}/api/admin/users/invite`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": "e2e",
      Cookie: cookie,
    },
    body: JSON.stringify({
      email: targetEmail,
      nome_completo: `E2E ${targetRole}`,
      role: targetRole,
    }),
  });
}

// ─── Suite ────────────────────────────────────────────────────────────────────

test.describe("INV — Privilege Ceiling (POST /api/admin/users/invite)", () => {
  let armeiroCookie: string | null = null;
  let adminReservaCookie: string | null = null;
  let adminReservaId: string | null = null;
  let armeiroId: string | null = null;

  const adminReservaEmail = `inv.admin_reserva.${Date.now()}@e2e.test`;
  const armeiroEmail      = `inv.armeiro.${Date.now()}@e2e.test`;

  test.beforeAll(async () => {
    // Cria usuários temporários para os roles que não estão no harness
    [adminReservaId, armeiroId] = await Promise.all([
      createTempUser(adminReservaEmail, "admin_reserva"),
      createTempUser(armeiroEmail,      "armeiro"),
    ]);

    // Login paralelo
    [adminReservaCookie, armeiroCookie] = await Promise.all([
      apiLogin(adminReservaEmail, "Teste@Inv2026"),
      apiLogin(armeiroEmail,      "Teste@Inv2026"),
    ]);
  });

  test.afterAll(async () => {
    await Promise.all([
      adminReservaId ? deleteTempUser(adminReservaId) : Promise.resolve(),
      armeiroId      ? deleteTempUser(armeiroId)      : Promise.resolve(),
    ]);
  });

  // ── admin_global ─────────────────────────────────────────────────────────

  test("INV-01 — admin_global convida admin_reserva → 201", async () => {
    const cookie = await apiLogin(USERS.admin.email, USERS.admin.password);
    expect(cookie, "Login admin_global falhou").not.toBeNull();

    const res = await callInvite(cookie!, `inv01.${Date.now()}@e2e.test`, "admin_reserva");
    // 201 = invite enviado | 422 = Supabase recusou email de teste (aceito também)
    expect([201, 422], `Esperado 201 ou 422, recebeu ${res.status}`).toContain(res.status);
  });

  test("INV-02 — admin_global tenta convidar superadmin → 403", async () => {
    const cookie = await apiLogin(USERS.admin.email, USERS.admin.password);
    expect(cookie, "Login admin_global falhou").not.toBeNull();

    const res = await callInvite(cookie!, `inv02.${Date.now()}@e2e.test`, "superadmin");
    expect(res.status).toBe(403);
  });

  test("INV-03 — admin_global convida armeiro → 201", async () => {
    const cookie = await apiLogin(USERS.admin.email, USERS.admin.password);
    expect(cookie, "Login admin_global falhou").not.toBeNull();

    const res = await callInvite(cookie!, `inv03.${Date.now()}@e2e.test`, "armeiro");
    expect([201, 422]).toContain(res.status);
  });

  test("INV-04 — admin_global tenta convidar role inválido → 403", async () => {
    const cookie = await apiLogin(USERS.admin.email, USERS.admin.password);
    expect(cookie, "Login admin_global falhou").not.toBeNull();

    const res = await callInvite(cookie!, `inv04.${Date.now()}@e2e.test`, "god_mode");
    expect(res.status).toBe(403);
  });

  // ── admin_reserva ────────────────────────────────────────────────────────

  test("INV-05 — admin_reserva convida auditor → 201", async () => {
    if (!adminReservaCookie) { test.skip(true, "Login admin_reserva falhou"); return; }

    const res = await callInvite(adminReservaCookie, `inv05.${Date.now()}@e2e.test`, "auditor");
    expect([201, 422]).toContain(res.status);
  });

  test("INV-06 — admin_reserva tenta convidar admin_global → 403", async () => {
    if (!adminReservaCookie) { test.skip(true, "Login admin_reserva falhou"); return; }

    const res = await callInvite(adminReservaCookie, `inv06.${Date.now()}@e2e.test`, "admin_global");
    expect(res.status).toBe(403);
  });

  // ── armeiro ──────────────────────────────────────────────────────────────

  test("INV-07 — armeiro convida efetivo (usuario) → 201", async () => {
    if (!armeiroCookie) { test.skip(true, "Login armeiro falhou"); return; }

    const res = await callInvite(armeiroCookie, `inv07.${Date.now()}@e2e.test`, "usuario");
    expect([201, 422]).toContain(res.status);
  });

  test("INV-08 — armeiro tenta convidar armeiro → 403", async () => {
    if (!armeiroCookie) { test.skip(true, "Login armeiro falhou"); return; }

    const res = await callInvite(armeiroCookie, `inv08.${Date.now()}@e2e.test`, "armeiro");
    expect(res.status).toBe(403);
  });

  // ── usuario bloqueado totalmente ─────────────────────────────────────────

  test("INV-X1 — usuario não tem acesso ao endpoint → 403", async () => {
    const cookie = await apiLogin(USERS.cadete.email, USERS.cadete.password);
    expect(cookie, "Login cadete falhou").not.toBeNull();

    const res = await callInvite(cookie!, `invx1.${Date.now()}@e2e.test`, "usuario");
    expect(res.status).toBe(403);
  });
});

// ─── SEC-02 ──────────────────────────────────────────────────────────────────

test.describe("SEC — Security Guards", () => {
  test("SEC-02 — admin_global bloqueado em GET /api/nexus/health (sem 2FA nexus)", async () => {
    const cookie = await apiLogin(USERS.admin.email, USERS.admin.password);
    expect(cookie, "Login admin_global falhou").not.toBeNull();

    const res = await fetch(`${BFF_URL}/api/nexus/health`, {
      headers: { Cookie: cookie! },
    });
    // admin_global não é superadmin → requireNexusSession retorna 403
    expect(res.status).toBe(403);
  });

  test("SEC-03 — sem sessão → 401 em /api/nexus/health", async () => {
    const res = await fetch(`${BFF_URL}/api/nexus/health`);
    expect([401, 403]).toContain(res.status);
  });
});
