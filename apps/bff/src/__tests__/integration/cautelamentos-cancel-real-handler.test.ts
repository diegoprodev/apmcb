import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { cautelamentosRoutes } from "../../routes/cautelamentos.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Mesmo padrão de cautelamentos-return-real-handler.test.ts (ver comentário
// completo lá) — CAULC-04 (docs/enterprise/specs/cautela-lifecycle-enterprise.md):
// endpoint novo, mais sensível dos 3 adicionados (muta status pra "cancelada"
// e libera o item), merece o mesmo harness real (Hono + authMiddleware, não
// só checagem estática de texto-fonte).
//
// Roda via `bun test` (`npm run test:integration`) — ver motivo completo em
// auth-me-real-handler.test.ts.
//
// role="admin_reserva" de propósito: requireActiveShift pula a query de
// service_shifts pra esse role, simplificando o mock.

const ORIGINAL_FROM = supabase.from.bind(supabase);
const TENANT_ID = "99999999-0000-0000-0000-000000000002";
let mockCautela: {
  id: string;
  status: string;
  item_id: string;
  tenant_id: string;
  militar_id: string;
  armeiro_signature_id: string | null;
  militar_signature_id: string | null;
  item: { material_type: { nome: string } };
} | null = null;
let updateCalls: Array<{ table: string; payload: Record<string, unknown> }> = [];

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = (table: string) => {
    if (table === "revoked_sessions") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    }
    if (table === "profiles") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: "admin_reserva", sessions_invalidated_at: null }, error: null }) }) }) };
    }
    if (table === "cautelamentos") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: mockCautela, error: mockCautela ? null : { message: "not found" } }),
          }),
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: async () => {
                    updateCalls.push({ table: "cautelamentos", payload });
                    return { data: { id: mockCautela?.id }, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === "material_items") {
      return { update: () => ({ eq: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }) };
    }
    if (table === "notifications") {
      return { insert: async () => ({ error: null }) };
    }
    if (table === "audit_events") {
      // getLastEventHash (lib/audit-hash.ts) faz um SELECT encadeado antes
      // do INSERT — mock as duas operações pra não gerar log de erro
      // (best-effort/fire-and-forget de todo modo, não afeta as asserções).
      return {
        select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ single: async () => ({ data: null, error: null }) }) }) }) }),
        insert: async () => ({ error: null }),
      };
    }
    throw new Error(`tabela não mockada neste teste: ${table}`);
  };
});

after(() => {
  supabase.from = ORIGINAL_FROM;
});

const app = new Hono<{ Variables: HonoVariables }>();
app.use("/api/cautelamentos/*", authMiddleware);
app.route("/api/cautelamentos", cautelamentosRoutes);

async function sealSession(data: Partial<SessionData>): Promise<string> {
  const req = new Request("http://localhost/seal");
  const res = new Response(null);
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  Object.assign(session, data);
  await session.save();
  const setCookie = res.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`));
  assert.ok(setCookie, "falha ao selar sessão de teste");
  return setCookie.split(";")[0];
}

async function postCancel(cookie: string, id: string, motivo: string) {
  return app.request(`/api/cautelamentos/${id}/cancel`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ motivo }),
  });
}

describe("POST /api/cautelamentos/:id/cancel — handler real (integração via app Hono, não réplica)", () => {
  it("nenhuma assinatura → cancela com sucesso (cancelar não exige assinaturas)", async () => {
    updateCalls = [];
    mockCautela = {
      id: "bbbbbbbb-0000-0000-0000-000000000001", status: "ativa",
      item_id: "item-1", tenant_id: TENANT_ID, militar_id: "militar-1",
      armeiro_signature_id: null, militar_signature_id: null,
      item: { material_type: { nome: "Colete" } },
    };
    const cookie = await sealSession({
      userId: "99999999-9999-9999-9999-999999999991", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-cancel-1", issuedAt: Date.now(),
    });

    const res = await postCancel(cookie, mockCautela.id, "Cadastro feito por engano");
    const body = await res.json() as { ok?: boolean };
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].payload.status, "cancelada");
    assert.equal(updateCalls[0].payload.motivo_cancelamento, "Cadastro feito por engano");
  });

  it("as 2 assinaturas já existem → 422 SIGNATURES_COMPLETE (não cancela)", async () => {
    updateCalls = [];
    mockCautela = {
      id: "bbbbbbbb-0000-0000-0000-000000000002", status: "ativa",
      item_id: "item-2", tenant_id: TENANT_ID, militar_id: "militar-2",
      armeiro_signature_id: "sig-armeiro", militar_signature_id: "sig-militar",
      item: { material_type: { nome: "Colete" } },
    };
    const cookie = await sealSession({
      userId: "99999999-9999-9999-9999-999999999992", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-cancel-2", issuedAt: Date.now(),
    });

    const res = await postCancel(cookie, mockCautela.id, "Tentativa inválida");
    const body = await res.json() as { error?: string; code?: string };
    assert.equal(res.status, 422);
    assert.equal(body.code, "SIGNATURES_COMPLETE");
    assert.equal(updateCalls.length, 0);
  });

  it("motivo com menos de 5 caracteres → 400, não chega a checar a cautela", async () => {
    updateCalls = [];
    mockCautela = {
      id: "bbbbbbbb-0000-0000-0000-000000000003", status: "ativa",
      item_id: "item-3", tenant_id: TENANT_ID, militar_id: "militar-3",
      armeiro_signature_id: null, militar_signature_id: null,
      item: { material_type: { nome: "Colete" } },
    };
    const cookie = await sealSession({
      userId: "99999999-9999-9999-9999-999999999993", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-cancel-3", issuedAt: Date.now(),
    });

    const res = await postCancel(cookie, mockCautela.id, "oi");
    assert.equal(res.status, 400);
    assert.equal(updateCalls.length, 0);
  });
});
