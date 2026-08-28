import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { cautelamentosRoutes } from "../../routes/cautelamentos.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Achado ALTO de code review (2026-08-28, revisão do fix "devolução exige 2
// assinaturas"): o teste estático em idor-write-scope.test.ts (`file.includes`
// sobre o texto-fonte) garante que o guard EXISTE no arquivo e está na ordem
// certa, mas nunca invoca o handler de verdade — não pegaria, por exemplo, um
// nome de coluna errado no SELECT, um `return` antecipado escondendo o guard
// atrás de um branch morto, ou o `code`/status HTTP errados na resposta. Este
// arquivo monta o app Hono real (mesmo `app.route` + `authMiddleware` de
// src/index.ts) e chama POST /api/cautelamentos/:id/return via app.request()
// de verdade, só trocando o que o Supabase responderia — mesmo padrão de
// auth-me-real-handler.test.ts.
//
// Roda via `bun test` (`npm run test:integration`), NÃO
// `node --experimental-strip-types --test` — ver comentário completo em
// auth-me-real-handler.test.ts sobre por que (imports relativos sem extensão
// só resolvem via bun/bundler).
//
// role="admin_reserva" (não "armeiro") de propósito: requireActiveShift
// retorna `{ok:true, shift:null}` sem NENHUMA query pra admin_reserva/
// admin_global — evita ter que mockar também `service_shifts` só pra chegar
// no guard de assinatura que este teste realmente cobre.
//
// userIds únicos (prefixo "9") pra não colidir com o cache de
// checkSessionValid (session-guard.ts, TTL por userId) caso este arquivo
// rode no mesmo processo bun que auth-me-real-handler.test.ts (que usa
// prefixos "1"/"2"/"3").

const ORIGINAL_FROM = supabase.from.bind(supabase);
const TENANT_ID = "99999999-0000-0000-0000-000000000001";
let mockCautela: {
  id: string;
  status: string;
  item_id: string;
  tenant_id: string;
  armeiro_signature_id: string | null;
  militar_signature_id: string | null;
} | null = null;

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

async function postReturn(cookie: string, id: string) {
  return app.request(`/api/cautelamentos/${id}/return`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ condicao_devolucao: "bom" }),
  });
}

describe("POST /api/cautelamentos/:id/return — handler real (integração via app Hono, não réplica)", () => {
  it("nenhuma assinatura → 422 SIGNATURES_PENDING (não devolve)", async () => {
    mockCautela = {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      status: "ativa", item_id: "item-1", tenant_id: TENANT_ID,
      armeiro_signature_id: null, militar_signature_id: null,
    };
    const cookie = await sealSession({
      userId: "99999999-1111-1111-1111-111111111111", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-cautela-1", issuedAt: Date.now(),
    });

    const res = await postReturn(cookie, mockCautela.id);
    const body = await res.json() as { error?: string; code?: string };
    assert.equal(res.status, 422);
    assert.equal(body.code, "SIGNATURES_PENDING");
  });

  it("só armeiro assinou → 422 SIGNATURES_PENDING (não devolve)", async () => {
    mockCautela = {
      id: "aaaaaaaa-0000-0000-0000-000000000002",
      status: "ativa", item_id: "item-2", tenant_id: TENANT_ID,
      armeiro_signature_id: "sig-armeiro-1", militar_signature_id: null,
    };
    const cookie = await sealSession({
      userId: "99999999-2222-2222-2222-222222222222", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-cautela-2", issuedAt: Date.now(),
    });

    const res = await postReturn(cookie, mockCautela.id);
    const body = await res.json() as { error?: string; code?: string };
    assert.equal(res.status, 422);
    assert.equal(body.code, "SIGNATURES_PENDING");
  });

  it("só militar assinou → 422 SIGNATURES_PENDING (não devolve)", async () => {
    mockCautela = {
      id: "aaaaaaaa-0000-0000-0000-000000000003",
      status: "ativa", item_id: "item-3", tenant_id: TENANT_ID,
      armeiro_signature_id: null, militar_signature_id: "sig-militar-1",
    };
    const cookie = await sealSession({
      userId: "99999999-3333-3333-3333-333333333333", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-cautela-3", issuedAt: Date.now(),
    });

    const res = await postReturn(cookie, mockCautela.id);
    const body = await res.json() as { error?: string; code?: string };
    assert.equal(res.status, 422);
    assert.equal(body.code, "SIGNATURES_PENDING");
  });
});
