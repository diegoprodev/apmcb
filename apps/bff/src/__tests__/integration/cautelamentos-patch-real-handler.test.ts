import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { cautelamentosRoutes } from "../../routes/cautelamentos.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Mesmo padrão de cautelamentos-return-real-handler.test.ts/cautelamentos-
// cancel-real-handler.test.ts (ver comentário completo lá) — CAULC-05.
//
// Achado ALTO de code review (implementação): faltava a checagem de
// igualdade em `prazo_devolucao_tipo` que `motivo_emissao` já tinha — toda
// edição gravava um "cautela_editada" fantasma de prazo (mesmo valor), e
// null→"indeterminado" virava uma mutação de dado real disparada por um
// campo que o usuário nem tocou. Este arquivo cobre exatamente esse
// comportamento com o handler real, não só checagem estática de texto.

const ORIGINAL_FROM = supabase.from.bind(supabase);
const TENANT_ID = "99999999-0000-0000-0000-000000000003";
let mockCautela: {
  id: string; status: string; tenant_id: string;
  data_emissao: string; motivo_emissao: string; prazo_devolucao_tipo: string | null;
} | null = null;
let updateCalls: Array<Record<string, unknown>> = [];

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
                    updateCalls.push(payload);
                    return { data: { id: mockCautela?.id }, error: null };
                  },
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === "audit_events") {
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

async function patchCautela(cookie: string, id: string, body: Record<string, unknown>) {
  return app.request(`/api/cautelamentos/${id}`, {
    method: "PATCH",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/cautelamentos/:id — handler real (integração via app Hono, não réplica)", () => {
  it("enviar o MESMO prazo já ativo não gera update (sem edição fantasma)", async () => {
    updateCalls = [];
    mockCautela = {
      id: "cccccccc-0000-0000-0000-000000000001", status: "ativa", tenant_id: TENANT_ID,
      data_emissao: "2026-01-01T12:00:00Z", motivo_emissao: "Uso pessoal",
      prazo_devolucao_tipo: "30_dias",
    };
    const cookie = await sealSession({
      userId: "99999999-8888-8888-8888-888888888881", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-patch-1", issuedAt: Date.now(),
    });

    const res = await patchCautela(cookie, mockCautela.id, {
      motivo_emissao: "Uso pessoal", prazo_devolucao_tipo: "30_dias",
    });
    const body = await res.json() as { ok?: boolean };
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(updateCalls.length, 0, "não deveria disparar UPDATE nenhum — nada mudou de fato");
  });

  it("prazo NULL no banco + body 'indeterminado' (mesmo significado) não gera update", async () => {
    updateCalls = [];
    mockCautela = {
      id: "cccccccc-0000-0000-0000-000000000002", status: "ativa", tenant_id: TENANT_ID,
      data_emissao: "2026-01-01T12:00:00Z", motivo_emissao: "Uso pessoal",
      prazo_devolucao_tipo: null,
    };
    const cookie = await sealSession({
      userId: "99999999-8888-8888-8888-888888888882", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-patch-2", issuedAt: Date.now(),
    });

    const res = await patchCautela(cookie, mockCautela.id, {
      motivo_emissao: "Uso pessoal", prazo_devolucao_tipo: "indeterminado",
    });
    assert.equal(res.status, 200);
    assert.equal(updateCalls.length, 0, "NULL e 'indeterminado' são o mesmo estado — não deveria mutar prazo_devolucao_tipo pra string à toa");
  });

  it("mudar só o motivo não recalcula nem grava o prazo (edição parcial de verdade)", async () => {
    updateCalls = [];
    mockCautela = {
      id: "cccccccc-0000-0000-0000-000000000003", status: "ativa", tenant_id: TENANT_ID,
      data_emissao: "2026-01-01T12:00:00Z", motivo_emissao: "Uso pessoal",
      prazo_devolucao_tipo: "30_dias",
    };
    const cookie = await sealSession({
      userId: "99999999-8888-8888-8888-888888888883", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-patch-3", issuedAt: Date.now(),
    });

    const res = await patchCautela(cookie, mockCautela.id, {
      motivo_emissao: "Transferência de unidade", prazo_devolucao_tipo: "30_dias",
    });
    assert.equal(res.status, 200);
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].motivo_emissao, "Transferência de unidade");
    assert.equal("prazo_devolucao_tipo" in updateCalls[0], false, "prazo não mudou — não deveria estar no payload do update");
  });

  it("mudar o prazo recalcula a partir da data_emissao ORIGINAL, não de hoje", async () => {
    updateCalls = [];
    mockCautela = {
      id: "cccccccc-0000-0000-0000-000000000004", status: "ativa", tenant_id: TENANT_ID,
      data_emissao: "2026-01-01T12:00:00-03:00", motivo_emissao: "Uso pessoal",
      prazo_devolucao_tipo: "indeterminado",
    };
    const cookie = await sealSession({
      userId: "99999999-8888-8888-8888-888888888884", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-patch-4", issuedAt: Date.now(),
    });

    const res = await patchCautela(cookie, mockCautela.id, { prazo_devolucao_tipo: "90_dias" });
    assert.equal(res.status, 200);
    assert.equal(updateCalls.length, 1);
    // 01/01/2026 + 90 dias = 01/04/2026 — se a âncora fosse "hoje" (data do
    // teste, muito depois de 2026-01-01), o resultado seria uma data bem
    // mais distante que essa.
    assert.equal(updateCalls[0].prazo_devolucao_data, "2026-04-01");
  });

  it("cautela não-ativa → 422, sem update", async () => {
    updateCalls = [];
    mockCautela = {
      id: "cccccccc-0000-0000-0000-000000000005", status: "devolvida", tenant_id: TENANT_ID,
      data_emissao: "2026-01-01T12:00:00Z", motivo_emissao: "Uso pessoal",
      prazo_devolucao_tipo: null,
    };
    const cookie = await sealSession({
      userId: "99999999-8888-8888-8888-888888888885", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-patch-5", issuedAt: Date.now(),
    });

    const res = await patchCautela(cookie, mockCautela.id, { motivo_emissao: "Tentativa inválida" });
    assert.equal(res.status, 422);
    assert.equal(updateCalls.length, 0);
  });
});
