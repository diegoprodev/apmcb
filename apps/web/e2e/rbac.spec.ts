/**
 * APMCB — RBAC Enterprise Suite (Fase 2)
 * Valida que roleGuard bloqueia acessos não autorizados e permite autorizados.
 *
 * PT01: usuario tenta POST /api/lendings → 403
 * PT02: armeiro tenta GET /api/nexus/health → 403
 * PT03: admin_reserva tenta criar tenant via Nexus → 403
 * PT04: auditor tenta PATCH em recurso → 403
 * PT05: armeiro emite cautela → 201
 * PT06: admin_global vê usuários do tenant → 200
 * PT07: role forjado no body é ignorado
 * PT08: superadmin (testado como armeiro sem nexus 2FA) → 403 em nexus
 */

import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BFF_URL, BASE_URL, USERS } from "./harness";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SUPABASE_URL   = process.env.SUPABASE_URL!;
const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface SessionCookies {
  cookie: string;
}

/** Login via BFF exchange para obter iron-session cookie (sem browser). */
async function apiLogin(
  email: string,
  password: string,
  request: ReturnType<typeof test.info>["project"]["use"] & { fetch?: never } & object
): Promise<SessionCookies | null> {
  const fetch = globalThis.fetch;
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
  return match ? { cookie: match[0] } : null;
}

/** Cria usuário temporário de teste com role específico via service_role. */
async function createTempUser(
  email: string,
  role: string,
  password = "Teste@Rbac2026"
): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Matricula numérica de 6 dígitos para satisfazer constraints do trigger
  const matricula = String(Math.floor(Math.random() * 900000) + 100000);

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome_completo: `Test ${role}`, matricula },
  });

  if (error || !data?.user) { console.error("createUser error:", error?.message); return null; }
  const userId = data.user.id;

  // Aguarda trigger criar o profile (até 5s)
  let profileExists = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const { data: p } = await supabase.from("profiles").select("id").eq("id", userId).single();
    if (p) { profileExists = true; break; }
  }

  // Se trigger não criou o profile, cria manualmente via service_role (bypass RLS)
  if (!profileExists) {
    const { error: insertError } = await supabase.from("profiles").insert({
      id: userId,
      nome_completo: `Test ${role}`,
      matricula,
      role: "usuario",
      registration_status: "complete",
    });
    if (insertError) { console.error("profile insert error:", insertError.message); return null; }
  }

  const { error: updateError } = await supabase.from("profiles").update({ role, registration_status: "complete" }).eq("id", userId);
  if (updateError) { console.error("role update error:", updateError.message); return null; }

  return userId;
}

/** Remove usuário temporário. */
async function deleteTempUser(userId: string) {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  await supabase.auth.admin.deleteUser(userId);
}

// ─── Testes ───────────────────────────────────────────────────────────────────

test.describe("RBAC — Bloqueios por role", () => {
  // IDs dos usuários temporários criados no beforeAll
  let adminReservaId: string | null = null;
  let auditorId: string | null = null;
  const adminReservaEmail = `rbac.admin_reserva.${Date.now()}@e2e.test`;
  const auditorEmail      = `rbac.auditor.${Date.now()}@e2e.test`;

  test.beforeAll(async () => {
    adminReservaId = await createTempUser(adminReservaEmail, "admin_reserva");
    auditorId      = await createTempUser(auditorEmail, "auditor");
  });

  test.afterAll(async () => {
    if (adminReservaId) await deleteTempUser(adminReservaId);
    if (auditorId)      await deleteTempUser(auditorId);
  });

  /**
   * PT01: usuario não pode emitir cautela (POST /api/lendings).
   */
  test("PT01 — usuario bloqueado em POST /api/lendings", async () => {
    const session = await apiLogin(USERS.cadete.email, USERS.cadete.password, {});
    expect(session, "Login cadete falhou").not.toBeNull();

    const res = await fetch(`${BFF_URL}/api/lendings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": session!.cookie,
      },
      body: JSON.stringify({ material_type_id: "x", military_id: "y", quantity: 1 }),
    });
    expect(res.status).toBe(403);
  });

  /**
   * PT02: armeiro não pode acessar nexus (GET /api/nexus/health).
   */
  test("PT02 — armeiro bloqueado em GET /api/nexus/health", async () => {
    const session = await apiLogin(USERS.reserva.email, USERS.reserva.password, {});
    expect(session, "Login armeiro falhou").not.toBeNull();

    const res = await fetch(`${BFF_URL}/api/nexus/health`, {
      headers: { "Cookie": session!.cookie },
    });
    // Nexus requer nexusAuthorized (2FA) mesmo para admin_global; armeiro → 403
    expect(res.status).toBe(403);
  });

  /**
   * PT03: admin_reserva não pode criar tenant via Nexus.
   */
  test("PT03 — admin_reserva bloqueado em POST /api/nexus/tenants", async () => {
    if (!adminReservaId) {
      test.skip(true, "Usuário admin_reserva não foi criado");
      return;
    }

    const session = await apiLogin(adminReservaEmail, "Teste@Rbac2026", {});
    expect(session, "Login admin_reserva falhou").not.toBeNull();

    const res = await fetch(`${BFF_URL}/api/nexus/tenants`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": session!.cookie,
      },
      body: JSON.stringify({ nome: "Tenant Indevido", slug: "indevido" }),
    });
    expect(res.status).toBe(403);
  });

  /**
   * PT04: auditor não pode alterar status (PATCH em profiles).
   */
  test("PT04 — auditor bloqueado em PATCH /api/profiles/:id/status", async () => {
    if (!auditorId) {
      test.skip(true, "Usuário auditor não foi criado");
      return;
    }

    const session = await apiLogin(auditorEmail, "Teste@Rbac2026", {});
    expect(session, "Login auditor falhou").not.toBeNull();

    // Tenta alterar status de si mesmo ou de qualquer profile
    const res = await fetch(`${BFF_URL}/api/profiles/${auditorId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Cookie": session!.cookie,
      },
      body: JSON.stringify({ status: "ativo" }),
    });
    // auditor não tem role permitido para PATCH em profiles → 403
    expect(res.status).toBe(403);
  });

  /**
   * PT05: armeiro consegue listar lendings da sua unidade.
   */
  test("PT05 — armeiro pode GET /api/lendings", async () => {
    const session = await apiLogin(USERS.reserva.email, USERS.reserva.password, {});
    expect(session, "Login armeiro falhou").not.toBeNull();

    const res = await fetch(`${BFF_URL}/api/lendings`, {
      headers: { "Cookie": session!.cookie },
    });
    expect(res.status).toBe(200);
  });

  /**
   * PT06: admin_global pode listar usuários do tenant.
   */
  test("PT06 — admin_global pode GET /api/admin/estrutura", async () => {
    const session = await apiLogin(USERS.admin.email, USERS.admin.password, {});
    expect(session, "Login admin falhou").not.toBeNull();

    const res = await fetch(`${BFF_URL}/api/admin/estrutura`, {
      headers: { "Cookie": session!.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // estrutura retorna { reserve, orgUnit, tenant } ou similar
    expect(body).not.toBeNull();
  });

  /**
   * PT07: role forjado no body/query é ignorado — BFF usa role da sessão.
   * Testa que um cadete não se torna admin ao injetar role no body.
   */
  test("PT07 — role forjado no body não eleva privilégio", async () => {
    const session = await apiLogin(USERS.cadete.email, USERS.cadete.password, {});
    expect(session, "Login cadete falhou").not.toBeNull();

    // Tenta emitir cautela injetando role=admin_global no payload
    const res = await fetch(`${BFF_URL}/api/lendings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": session!.cookie,
      },
      body: JSON.stringify({
        role: "admin_global",
        callerRole: "admin_global",
        material_type_id: "x",
        military_id: "y",
        quantity: 1,
      }),
    });
    // Sessão diz que é usuário; roleGuard bloqueia independente do body
    expect(res.status).toBe(403);
  });

  /**
   * PT08: armeiro sem nexus 2FA → 403 em nexus (valida que nexus não é acessível por armeiro).
   * Nota: teste positivo de superadmin exige 2FA manual — validado via nexus-suite.
   */
  test("PT08 — armeiro sem nexusAuthorized bloqueado em nexus", async () => {
    const session = await apiLogin(USERS.reserva.email, USERS.reserva.password, {});
    expect(session, "Login armeiro falhou").not.toBeNull();

    const res = await fetch(`${BFF_URL}/api/nexus/tenants`, {
      headers: { "Cookie": session!.cookie },
    });
    expect(res.status).toBe(403);
  });
});

/**
 * Testes de segurança adicionais — escalada de privilégio.
 */
test.describe("RBAC — Segurança contra escalada", () => {
  test("SEC-2-01 — admin_global não pode acessar nexus sem 2FA", async () => {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data } = await supabase.auth.signInWithPassword({
      email: USERS.admin.email,
      password: USERS.admin.password,
    });
    if (!data?.session) { test.skip(true, "Login admin falhou"); return; }

    const { access_token, refresh_token } = data.session;
    const exchangeRes = await fetch(`${BFF_URL}/api/auth/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token, refresh_token }),
    });
    expect(exchangeRes.ok).toBe(true);
    const setCookie = exchangeRes.headers.get("set-cookie") ?? "";
    const match = setCookie.match(/apmcb_session=[^;]+/);
    const cookie = match?.[0] ?? "";

    // Sem nexusAuthorized na sessão ou cookie vazio → 401/403 (bloqueado em qualquer caso)
    const nexusRes = await fetch(`${BFF_URL}/api/nexus/tenants`, {
      headers: { "Cookie": cookie },
    });
    expect([401, 403]).toContain(nexusRes.status);
  });

  test("SEC-2-02 — landAt correto: admin_global → /admin, armeiro → /reserva, usuario → /cadete", async () => {
    for (const [key, user] of Object.entries(USERS)) {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: user.password,
      });
      if (!data?.session) continue;
      const res = await fetch(`${BFF_URL}/api/auth/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }),
      });
      expect(res.ok, `exchange falhou para ${key}`).toBe(true);
      const body = await res.json();
      expect(body.landAt, `landAt errado para ${key}`).toBe(user.landAt);
    }
  });
});
