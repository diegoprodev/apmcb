import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { emailChangeConfirmRoutes } from "../../routes/email-change-confirm.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Achado real (2026-09-17, teste vivo em produção com pmpbdga@gmail.com):
// POST /api/auth/email-change/confirm chamava auditLogDirect({actorId: null,
// actorRole: null, ...}) — a guarda antiga em auditLogDirect
// (`if (!actorId || !actorRole) return`) descartava SILENCIOSAMENTE todo
// audit_event deste endpoint (sucesso E falha), sem log de erro nem exceção.
// Confirmado via query direta em produção: audit_events tinha o evento
// `admin.user.email_change_requested` (endpoint autenticado, admin.ts) mas
// NENHUM `email_change_confirmed` depois do usuário clicar o link de
// verdade — apesar do código explicitamente tentar gravar. Fix: a guarda
// agora só exige actor_role (bate com o schema, actor_id é nullable); este
// endpoint (sem sessão, token é a prova de identidade) resolve o actor_id
// como o próprio user_id da pendência e busca o role dele. Este teste
// exercita o HANDLER REAL (não réplica) e afirma que audit_events.insert é
// chamado nos 4 branches, com actor_id/actor_role corretos — sem isso, o
// bug corrigido aqui pode voltar silenciosamente numa refatoração futura de
// audit.ts ou deste arquivo.
//
// Roda via `bun test` (`npm run test:integration`), não
// `node --experimental-strip-types --test` — mesmo motivo documentado em
// auth-me-real-handler.test.ts (imports relativos sem extensão no código-
// fonte só resolvem via bun/bundler).

const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_UPDATE_USER = supabase.auth.admin.updateUserById.bind(supabase.auth.admin);

const TENANT_ID = "77777777-0000-0000-0000-000000000001";
const USER_ID = "88888888-0000-0000-0000-000000000002";

let mockPending: {
  id: string; user_id: string; tenant_id: string;
  old_email: string; new_email: string;
  requested_by: string; requested_by_role: string;
  confirmed_at: string | null; expires_at: string;
} | null = null;
let mockProfile: { role: string; nome_completo: string } | null = null;
let auditInserts: Array<Record<string, unknown>> = [];
let pendingUpdateCalls: Array<Record<string, unknown>> = [];

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = (table: string) => {
    if (table === "pending_email_changes") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: mockPending, error: null }),
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async () => {
            pendingUpdateCalls.push(payload);
            return { error: null };
          },
        }),
      };
    }
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: mockProfile, error: null }),
          }),
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    if (table === "audit_events") {
      return {
        select: () => ({
          order: () => ({
            limit: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
              is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          }),
        }),
        insert: async (row: Record<string, unknown>) => {
          auditInserts.push(row);
          return { error: null };
        },
      };
    }
    // e-mail de aviso (path de sucesso) falha silenciosamente por design em
    // teste (RESEND_API_KEY ausente → sendEmail retorna not_configured) —
    // só precisa não explodir por tabela não mockada.
    if (table === "email_log" || table === "audit_logs" || table === "notifications") {
      return { insert: async () => ({ error: null }) };
    }
    throw new Error(`tabela não mockada neste teste: ${table}`);
  };

  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.auth.admin.updateUserById = async () => ({ data: { user: { id: USER_ID } }, error: null });
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  supabase.auth.admin.updateUserById = ORIGINAL_UPDATE_USER;
});

const app = new Hono<{ Variables: HonoVariables }>();
app.route("/api/auth/email-change", emailChangeConfirmRoutes);

async function waitFor(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout esperando efeito assíncrono (fire-and-forget)");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function confirm(token: string) {
  return app.request("/api/auth/email-change/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

describe("POST /api/auth/email-change/confirm — handler real, cobertura de audit_events", () => {
  it("token que não resolve a nenhuma pendência → 400, audit anônimo (actor_id null, tenant_id null)", async () => {
    auditInserts = [];
    mockPending = null;

    const res = await confirm("token-inexistente");
    assert.equal(res.status, 400);

    await waitFor(() => auditInserts.length === 1);
    const evt = auditInserts[0];
    assert.equal(evt.action, "admin.user.email_change_confirm_failed");
    assert.equal(evt.actor_id, null);
    assert.equal(evt.actor_role, "anonymous");
    assert.equal(evt.tenant_id, null);
    assert.deepEqual(evt.metadata, { reason: "invalid" });
  });

  it("token de pendência já confirmada → 409, audit atribuído ao dono da conta (posse do token)", async () => {
    auditInserts = [];
    mockPending = {
      id: "pend-1", user_id: USER_ID, tenant_id: TENANT_ID,
      old_email: "antigo@apmcb.dev", new_email: "novo@apmcb.dev",
      requested_by: "admin-1", requested_by_role: "admin_global",
      confirmed_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    mockProfile = { role: "armeiro", nome_completo: "Fulano Teste" };

    const res = await confirm("token-ja-usado");
    assert.equal(res.status, 409);

    await waitFor(() => auditInserts.length === 1);
    const evt = auditInserts[0];
    assert.equal(evt.action, "admin.user.email_change_confirm_failed");
    assert.equal(evt.actor_id, USER_ID);
    assert.equal(evt.actor_role, "armeiro");
    assert.equal(evt.tenant_id, TENANT_ID);
    assert.equal((evt.metadata as Record<string, unknown>).reason, "already_confirmed");
    assert.equal((evt.metadata as Record<string, unknown>).identity_source, "token_possession");
  });

  it("token expirado → 410, audit atribuído ao dono da conta com reason expired", async () => {
    auditInserts = [];
    mockPending = {
      id: "pend-2", user_id: USER_ID, tenant_id: TENANT_ID,
      old_email: "antigo@apmcb.dev", new_email: "novo@apmcb.dev",
      requested_by: "admin-1", requested_by_role: "admin_global",
      confirmed_at: null,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    mockProfile = { role: "armeiro", nome_completo: "Fulano Teste" };

    const res = await confirm("token-expirado");
    assert.equal(res.status, 410);

    await waitFor(() => auditInserts.length === 1);
    const evt = auditInserts[0];
    assert.equal(evt.action, "admin.user.email_change_confirm_failed");
    assert.equal(evt.actor_id, USER_ID);
    assert.equal(evt.actor_role, "armeiro");
    assert.equal((evt.metadata as Record<string, unknown>).reason, "expired");
  });

  it("token válido e dentro da janela → 200, e-mail efetivamente trocado + audit email_change_confirmed com before/after", async () => {
    auditInserts = [];
    pendingUpdateCalls = [];
    mockPending = {
      id: "pend-3", user_id: USER_ID, tenant_id: TENANT_ID,
      old_email: "antigo@apmcb.dev", new_email: "novo@apmcb.dev",
      requested_by: "admin-1", requested_by_role: "admin_global",
      confirmed_at: null,
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    mockProfile = { role: "armeiro", nome_completo: "Fulano Teste" };

    const res = await confirm("token-valido");
    const body = await res.json() as { ok?: boolean };
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);

    // pending_email_changes.confirmed_at marcado
    assert.equal(pendingUpdateCalls.length, 1);
    assert.ok(pendingUpdateCalls[0].confirmed_at);

    await waitFor(() => auditInserts.some((e) => e.action === "admin.user.email_change_confirmed"));
    const evt = auditInserts.find((e) => e.action === "admin.user.email_change_confirmed")!;
    assert.equal(evt.actor_id, USER_ID);
    assert.equal(evt.actor_role, "armeiro");
    assert.equal(evt.tenant_id, TENANT_ID);
    assert.deepEqual(evt.before_snapshot, { email: "antigo@apmcb.dev" });
    assert.deepEqual(evt.after_snapshot, { email: "novo@apmcb.dev" });
    assert.equal((evt.metadata as Record<string, unknown>).identity_source, "token_possession");
  });
});
