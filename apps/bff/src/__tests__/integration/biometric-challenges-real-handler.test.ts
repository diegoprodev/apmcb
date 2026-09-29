import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { biometricRoutes } from "../../routes/biometric.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { baseLogger } from "../../lib/logger.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Achado da revisão (2026-09-29): abrir/fechar turno e assinaturas do armeiro
// são autoautenticação — a digital tem de ser do PRÓPRIO ator. Sem esperado,
// o bridge fazia 1:N no tenant; com esperado de outra pessoa, o /result
// devolvia nome/matrícula dela. Este arquivo roda o handler REAL de
// POST /api/biometric/challenges (padrão *-real-handler.test.ts) e prova a
// regra no servidor — os testes de lib só provam as funções puras.
//
// Roda via `bun test` (`npm run test:integration`). Prefixo de ids "95".

const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_CHILD = baseLogger.child.bind(baseLogger);
const TENANT_ID = "95555555-0000-0000-0000-000000000001";
const RESERVE_ID = "95555555-0000-0000-0000-000000000002";
const ACTOR_ID = "95555555-1111-1111-1111-111111111111";
const OTHER_ID = "95555555-2222-2222-2222-222222222222";

let hasMembership = true;
let insertedChallenge: Record<string, unknown> | null = null;
let queriedTables: string[] = [];
let warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];

function builder(data: unknown): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data, error: null });
      if (prop === "single" || prop === "maybeSingle") return async () => ({ data, error: null });
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = (table: string) => {
    queriedTables.push(table);
    if (table === "revoked_sessions") return builder(null);
    if (table === "profiles") return builder({ role: "armeiro", sessions_invalidated_at: null });
    if (table === "reserve_memberships") return builder(hasMembership ? { reserve_id: RESERVE_ID } : null);
    if (table === "biometric_challenges") {
      return {
        insert: (row: Record<string, unknown>) => {
          insertedChallenge = row;
          return builder({ id: "95555555-3333-3333-3333-333333333333", ...row, status: "pending" });
        },
      };
    }
    return builder(null);
  };

  baseLogger.child = ((bindings: Record<string, unknown>) => {
    const child = ORIGINAL_CHILD(bindings);
    child.warn = ((obj: Record<string, unknown>, msg: string) => { warns.push({ obj, msg }); }) as typeof child.warn;
    return child;
  }) as unknown as typeof baseLogger.child;
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  baseLogger.child = ORIGINAL_CHILD;
});

beforeEach(() => {
  hasMembership = true;
  insertedChallenge = null;
  queriedTables = [];
  warns = [];
});

const app = new Hono<{ Variables: HonoVariables }>();
app.use("*", requestIdMiddleware);
app.use("/api/biometric/*", authMiddleware);
app.route("/api/biometric", biometricRoutes);

let cookie = "";
async function sealSession(): Promise<string> {
  if (cookie) return cookie;
  const req = new Request("http://localhost/seal");
  const res = new Response(null);
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  Object.assign(session, {
    userId: ACTOR_ID, role: "armeiro", tenantId: TENANT_ID, reserveId: RESERVE_ID,
    supabaseAccessToken: "fake", sessionId: "sess-bio-self-1", issuedAt: Date.now(),
  } satisfies Partial<SessionData>);
  await session.save();
  const setCookie = res.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`));
  assert.ok(setCookie, "falha ao selar sessão de teste");
  cookie = setCookie.split(";")[0];
  return cookie;
}

async function createChallenge(body: Record<string, unknown>) {
  return app.request("/api/biometric/challenges", {
    method: "POST",
    headers: { cookie: await sealSession(), "content-type": "application/json" },
    body: JSON.stringify({ reserve_id: RESERVE_ID, ...body }),
  });
}

describe("POST /api/biometric/challenges — autoautenticação no servidor (handler real)", () => {
  it("open_shift sem usuário esperado → 400 (nunca vira identificação 1:N)", async () => {
    const res = await createChallenge({ purpose: "open_shift" });
    assert.equal(res.status, 400);
    assert.equal(insertedChallenge, null);
  });

  it("open_shift mirando outra pessoa → 403 BIOMETRIC_SELF_AUTH_ONLY, log nomeado e nenhum desafio criado", async () => {
    const res = await createChallenge({ purpose: "open_shift", expected_user_id: OTHER_ID });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "BIOMETRIC_SELF_AUTH_ONLY" });
    assert.equal(insertedChallenge, null);
    assert.ok(!queriedTables.includes("reserve_memberships"), "a regra vem antes de qualquer consulta de autorização");

    const denial = warns.find((w) => w.msg === "biometric.challenge.denied");
    assert.ok(denial, "a recusa não deixou rastro no log");
    assert.equal(denial.obj.reason, "self_auth_target_mismatch");
    assert.equal(denial.obj.purpose, "open_shift");
  });

  it("open_shift com o próprio armeiro e vínculo com a reserva → 201", async () => {
    const res = await createChallenge({ purpose: "open_shift", expected_user_id: ACTOR_ID });
    assert.equal(res.status, 201);
    assert.equal(insertedChallenge?.expected_user_id, ACTOR_ID);
    assert.equal(insertedChallenge?.actor_id, ACTOR_ID);
  });

  it("sem vínculo com a reserva → 403 'Reserva nao autorizada' com log reserve_forbidden (motivos distinguíveis)", async () => {
    hasMembership = false;
    const res = await createChallenge({ purpose: "open_shift", expected_user_id: ACTOR_ID });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "Reserva nao autorizada" });
    const denial = warns.find((w) => w.msg === "biometric.challenge.denied");
    assert.ok(denial, "a recusa por reserva não deixou rastro no log");
    assert.equal(denial.obj.reason, "reserve_forbidden");
  });
});
