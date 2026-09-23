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
  reserve_id: string;
  armeiro_signature_id: string | null;
  militar_signature_id: string | null;
} | null = null;

// Achado ALTO de review (2026-09-23): os 4 testes originais deste arquivo
// usavam só role="admin_reserva", que faz requireActiveShift curto-circuitar
// em `{ok:true, shift:null}` sem NUNCA consultar service_shifts nem comparar
// targetReserveId — ou seja, a proteção cross-reserve que o comentário em
// cautelamentos.ts:1024-1029 descreve como "achado ALTO" nunca era exercitada
// pelo handler real. mockRole/mockActiveShift permitem os 2 novos testes
// abaixo cobrirem role="armeiro" com turno certo e com turno de outra reserva.
let mockRole = "admin_reserva";
let mockActiveShift: { id: string; reserve_id: string } | null = null;

// Captura o payload do PATCH .update("cautelamentos") de verdade (não uma
// réplica) — usado pelo teste de sucesso abaixo pra confirmar que
// devolucao_processada_por/shift_id_devolucao (achado 2026-09-22,
// rastreabilidade cross-turno) vão no mesmo UPDATE que já muda status.
let capturedCautelaUpdate: Record<string, unknown> | null = null;

// Builder encadeável genérico — qualquer método comum de query (select/
// insert/update/eq/order/limit/...) devolve a si mesmo; resolve como
// {data:null,error:null} no fim da cadeia (single/maybeSingle/then). Cobre
// tabelas tocadas por caminhos fire-and-forget (auditLog → audit_events,
// logShiftEvent → service_shifts/log_shift_event_atomic) que os 3 testes
// pré-existentes deste arquivo nunca alcançavam (sempre voltavam 422 antes
// do UPDATE) — sem isso, supabase.from() lançaria "tabela não mockada"
// dentro de uma função async, virando unhandled rejection.
function noopBuilder(): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      }
      if (prop === "single" || prop === "maybeSingle") {
        return async () => ({ data: null, error: null });
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = (table: string) => {
    if (table === "revoked_sessions") {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    }
    if (table === "profiles") {
      return { select: () => ({ eq: () => ({ single: async () => ({ data: { role: mockRole, sessions_invalidated_at: null }, error: null }) }) }) };
    }
    if (table === "service_shifts") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: mockActiveShift, error: null }),
            }),
          }),
        }),
      };
    }
    if (table === "cautelamentos") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: mockCautela, error: mockCautela ? null : { message: "not found" } }),
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          capturedCautelaUpdate = payload;
          return {
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({ data: mockCautela ? { id: mockCautela.id } : null, error: null }),
                  }),
                }),
              }),
            }),
          };
        },
      };
    }
    if (table === "material_items") {
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({ single: async () => ({ data: { id: "item-mock" }, error: null }) }),
              }),
            }),
          }),
        }),
      };
    }
    return noopBuilder();
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
    mockRole = "admin_reserva";
    mockCautela = {
      id: "aaaaaaaa-0000-0000-0000-000000000001",
      status: "ativa", item_id: "item-1", tenant_id: TENANT_ID, reserve_id: "resA",
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
    mockRole = "admin_reserva";
    mockCautela = {
      id: "aaaaaaaa-0000-0000-0000-000000000002",
      status: "ativa", item_id: "item-2", tenant_id: TENANT_ID, reserve_id: "resA",
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
    mockRole = "admin_reserva";
    mockCautela = {
      id: "aaaaaaaa-0000-0000-0000-000000000003",
      status: "ativa", item_id: "item-3", tenant_id: TENANT_ID, reserve_id: "resA",
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

  it("as duas assinaturas presentes → devolve e grava devolucao_processada_por (achado 2026-09-22, rastreabilidade cross-turno)", async () => {
    mockRole = "admin_reserva";
    mockCautela = {
      id: "aaaaaaaa-0000-0000-0000-000000000004",
      status: "ativa", item_id: "item-4", tenant_id: TENANT_ID, reserve_id: "resA",
      armeiro_signature_id: "sig-armeiro-1", militar_signature_id: "sig-militar-1",
    };
    capturedCautelaUpdate = null;
    const actorId = "99999999-4444-4444-4444-444444444444";
    const cookie = await sealSession({
      userId: actorId, role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: null, supabaseAccessToken: "fake",
      sessionId: "sess-cautela-4", issuedAt: Date.now(),
    });

    const res = await postReturn(cookie, mockCautela.id);
    assert.equal(res.status, 200);
    const body = await res.json() as { ok?: boolean };
    assert.equal(body.ok, true);

    assert.ok(capturedCautelaUpdate, "UPDATE de cautelamentos não foi chamado");
    // `capturedCautelaUpdate = payload` acontece dentro do closure passado
    // ao monkey-patch de supabase.from() (achado de review: TS não segue
    // essa reatribuição indireta e estreita a variável pra `never` após o
    // assert.ok acima) — cópia local via cast quebra o narrowing incorreto.
    const update = capturedCautelaUpdate as Record<string, unknown>;
    // admin_reserva nunca tem turno formal (requireActiveShift retorna
    // shift:null sem query) — shift_id_devolucao fica null neste cenário,
    // devolucao_processada_por é sempre o ator da sessão, com ou sem turno.
    assert.equal(update.devolucao_processada_por, actorId);
    assert.equal(update.shift_id_devolucao, null);
    assert.equal(update.status, "devolvida");
  });

  it("armeiro com turno ativo na MESMA reserva da cautela → devolve e grava shift_id_devolucao do próprio turno (achado ALTO de review, 2026-09-23)", async () => {
    mockRole = "armeiro";
    mockActiveShift = { id: "shift-certo", reserve_id: "resA" };
    mockCautela = {
      id: "aaaaaaaa-0000-0000-0000-000000000005",
      status: "ativa", item_id: "item-5", tenant_id: TENANT_ID, reserve_id: "resA",
      armeiro_signature_id: "sig-armeiro-1", militar_signature_id: "sig-militar-1",
    };
    capturedCautelaUpdate = null;
    const actorId = "99999999-5555-5555-5555-555555555555";
    const cookie = await sealSession({
      userId: actorId, role: "armeiro",
      tenantId: TENANT_ID, reserveId: "resA", supabaseAccessToken: "fake",
      sessionId: "sess-cautela-5", issuedAt: Date.now(),
    });

    const res = await postReturn(cookie, mockCautela.id);
    assert.equal(res.status, 200);

    assert.ok(capturedCautelaUpdate, "UPDATE de cautelamentos não foi chamado");
    const update = capturedCautelaUpdate as unknown as Record<string, unknown>;
    assert.equal(update.devolucao_processada_por, actorId);
    assert.equal(update.shift_id_devolucao, "shift-certo");
  });

  it("armeiro com turno ativo em OUTRA reserva → 403 SHIFT_WRONG_RESERVE (não devolve, achado ALTO de review, 2026-09-23)", async () => {
    mockRole = "armeiro";
    mockActiveShift = { id: "shift-errado", reserve_id: "resB" };
    mockCautela = {
      id: "aaaaaaaa-0000-0000-0000-000000000006",
      status: "ativa", item_id: "item-6", tenant_id: TENANT_ID, reserve_id: "resA",
      armeiro_signature_id: "sig-armeiro-1", militar_signature_id: "sig-militar-1",
    };
    capturedCautelaUpdate = null;
    const cookie = await sealSession({
      userId: "99999999-6666-6666-6666-666666666666", role: "armeiro",
      tenantId: TENANT_ID, reserveId: "resA", supabaseAccessToken: "fake",
      sessionId: "sess-cautela-6", issuedAt: Date.now(),
    });

    const res = await postReturn(cookie, mockCautela.id);
    const body = await res.json() as { error?: string };
    assert.equal(res.status, 403);
    assert.equal(body.error, "SHIFT_WRONG_RESERVE");
    assert.equal(capturedCautelaUpdate, null, "não deve chamar UPDATE quando o guard de turno bloqueia");
  });
});
