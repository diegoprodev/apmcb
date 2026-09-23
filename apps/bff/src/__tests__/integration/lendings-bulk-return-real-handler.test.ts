import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { lendingRoutes } from "../../routes/lendings.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Achado de review (2026-09-22, feature de rastreabilidade cross-turno):
// zero cobertura pras 3 rotas de lendings.ts que passaram a gravar
// p_shift_id/returned_by. Este arquivo monta o app Hono real (mesmo padrão
// de cautelamentos-return-real-handler.test.ts) e chama POST
// /api/lendings/bulk-return via app.request() de verdade, capturando os
// args passados pro supabase.rpc("record_lending_returns", ...) — confirma
// que p_shift_id vem do turno ativo do ATOR (não um valor arbitrário) e que
// role !== "armeiro" (sem turno formal) grava null, não quebra a chamada.
//
// Roda via `bun test` (`npm run test:integration`), NÃO
// `node --experimental-strip-types --test` — imports relativos sem extensão
// só resolvem via bun/bundler (ver auth-me-real-handler.test.ts).
//
// userIds únicos (prefixo "97") pra não colidir com o cache de
// checkSessionValid caso este arquivo rode no mesmo processo bun que outros
// testes de integração (prefixos "1"/"2"/"3"/"9").

const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_RPC = supabase.rpc.bind(supabase);
const TENANT_ID = "97777777-0000-0000-0000-000000000001";
const RESERVE_ID = "97777777-0000-0000-0000-000000000002";

let mockRole = "armeiro";
let mockActiveShift: { id: string; reserve_id: string } | null = null;
let capturedRpcArgs: Record<string, unknown> | null = null;

function noopBuilder(): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: null, error: null });
      if (prop === "single" || prop === "maybeSingle") return async () => ({ data: null, error: null });
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
      // Suporta tanto o lookup do authMiddleware (select().eq().single())
      // quanto o lookup dentro da rota pra montar a descrição do evento do
      // Livro Digital (select().eq().eq().maybeSingle()) — objeto union com
      // os campos que qualquer um dos dois consumidores possa ler.
      const profileData = { role: mockRole, sessions_invalidated_at: null, nome_completo: "Militar Teste", matricula: "900000", posto: null };
      const handler: ProxyHandler<object> = {
        get(_target, prop) {
          if (prop === "single" || prop === "maybeSingle") return async () => ({ data: profileData, error: null });
          return () => new Proxy({}, handler);
        },
      };
      return new Proxy({}, handler);
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
    return noopBuilder();
  };

  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.rpc = (fn: string, args: Record<string, unknown>) => {
    if (fn === "record_lending_returns") {
      capturedRpcArgs = args;
      return { single: async () => ({ data: { returned_count: 1 }, error: null }) };
    }
    throw new Error(`RPC não mockada neste teste: ${fn}`);
  };
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  supabase.rpc = ORIGINAL_RPC;
});

const app = new Hono<{ Variables: HonoVariables }>();
app.use("/api/lendings/*", authMiddleware);
app.route("/api/lendings", lendingRoutes);

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

async function postBulkReturn(cookie: string, lendingId: string) {
  return app.request("/api/lendings/bulk-return", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ lending_ids: [lendingId] }),
  });
}

describe("POST /api/lendings/bulk-return — handler real (integração, não réplica)", () => {
  it("armeiro com turno ativo → grava p_shift_id do próprio turno (achado 2026-09-22, rastreabilidade cross-turno)", async () => {
    mockRole = "armeiro";
    mockActiveShift = { id: "97777777-0000-0000-0000-000000000003", reserve_id: RESERVE_ID };
    capturedRpcArgs = null;
    const actorId = "97777777-1111-1111-1111-111111111111";
    const cookie = await sealSession({
      userId: actorId, role: "armeiro",
      tenantId: TENANT_ID, reserveId: RESERVE_ID, supabaseAccessToken: "fake",
      sessionId: "sess-lending-1", issuedAt: Date.now(),
      pendingIdentity: {
        profile_id: "97777777-2222-2222-2222-222222222222",
        tenant_id: TENANT_ID, reserve_id: RESERVE_ID,
        identified_at: Date.now(), auth_mode: "totp",
        totp_claim_id: "97777777-3333-3333-3333-333333333333",
      },
    });

    const res = await postBulkReturn(cookie, "97777777-4444-4444-4444-444444444444");
    assert.equal(res.status, 200);

    assert.ok(capturedRpcArgs, "record_lending_returns não foi chamada");
    const args = capturedRpcArgs as Record<string, unknown>;
    assert.equal(args.p_actor_id, actorId);
    assert.equal(args.p_shift_id, mockActiveShift.id);
  });

  it("admin_reserva (sem turno formal) → p_shift_id null, não quebra a chamada", async () => {
    mockRole = "admin_reserva";
    mockActiveShift = null;
    capturedRpcArgs = null;
    const actorId = "97777777-5555-5555-5555-555555555555";
    const cookie = await sealSession({
      userId: actorId, role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: RESERVE_ID, supabaseAccessToken: "fake",
      sessionId: "sess-lending-2", issuedAt: Date.now(),
      pendingIdentity: {
        profile_id: "97777777-6666-6666-6666-666666666666",
        tenant_id: TENANT_ID, reserve_id: RESERVE_ID,
        identified_at: Date.now(), auth_mode: "totp",
        totp_claim_id: "97777777-7777-7777-7777-777777777777",
      },
    });

    const res = await postBulkReturn(cookie, "97777777-8888-8888-8888-888888888888");
    assert.equal(res.status, 200);

    assert.ok(capturedRpcArgs, "record_lending_returns não foi chamada");
    const args = capturedRpcArgs as Record<string, unknown>;
    assert.equal(args.p_actor_id, actorId);
    assert.equal(args.p_shift_id, null);
  });
});
