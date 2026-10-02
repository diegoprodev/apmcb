import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { identityRejectState, lendingRoutes } from "../../routes/lendings.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { baseLogger } from "../../lib/logger.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Achado real (2026-09-24): "Registrar Saída" com digital falhava com 409
// LENDING_BIOMETRIC_PROOF_INVALID e o `docker logs` não mostrava nada. Os
// testes de fiação (rejection-log.test.ts) só provam que o código chama o
// helper; este arquivo roda o handler REAL (mesmo padrão de
// lendings-bulk-return-real-handler.test.ts) e prova que a recusa chega ao
// logger com motivo, código e ids — e sem campo de dado pessoal.
//
// Roda via `bun test` (`npm run test:integration`), NÃO node --test.
// userIds com prefixo "96" (não colide com o cache de checkSessionValid de
// outros testes de integração no mesmo processo).

const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_RPC = supabase.rpc.bind(supabase);
const ORIGINAL_CHILD = baseLogger.child.bind(baseLogger);
const TENANT_ID = "96666666-0000-0000-0000-000000000001";
const RESERVE_ID = "96666666-0000-0000-0000-000000000002";

// Chaves permitidas no contexto de uma recusa: motivo + ids. Qualquer outra
// (nome, matrícula, CPF...) reprova o teste.
const ALLOWED_KEYS = new Set([
  "reason", "code", "detail", "identity", "tenantId", "actorId", "masterId",
  "reserveId", "movementId", "operationId", "materialTypeId",
]);

let totpSecretRow: Record<string, unknown> | null = null;
let warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];
let errors: Array<{ obj: Record<string, unknown>; msg: string }> = [];
const P0001 = { code: "P0001", message: "LENDING_BIOMETRIC_PROOF_INVALID: prova de Fulano 960000 recusada" };
let rpcError: { code: string; message: string } = P0001;

function noopBuilder(data: unknown = null): unknown {
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
    if (table === "revoked_sessions") return noopBuilder(null);
    if (table === "profiles") {
      return noopBuilder({
        id: "96666666-2222-2222-2222-222222222222", role: "admin_reserva", sessions_invalidated_at: null,
        nome_completo: "Militar Teste", matricula: "960000", posto: null, foto_url: null,
      });
    }
    if (table === "reserves") return noopBuilder({ id: RESERVE_ID });
    if (table === "reserve_memberships") return noopBuilder({ reserve_id: RESERVE_ID, user_id: "96666666-2222-2222-2222-222222222222" });
    if (table === "tenant_memberships") return noopBuilder({ tenant_id: TENANT_ID });
    if (table === "material_types") return noopBuilder({ quantidade_total: 10, quantidade_cautela: 0, nome: "Pistola" });
    if (table === "totp_secrets") return noopBuilder(totpSecretRow);
    return noopBuilder(null);
  };

  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.rpc = (fn: string) => {
    if (fn === "record_lending_returns" || fn === "record_lending_batch") {
      const result = { data: null, error: rpcError };
      // /batch aguarda a chamada direto; /bulk-return usa .single().
      return { then: (resolve: (v: unknown) => void) => resolve(result), single: async () => result };
    }
    throw new Error(`RPC não mockada neste teste: ${fn}`);
  };

  // Captura o que o handler usa de fato (c.get("log") = child do request-id).
  baseLogger.child = ((bindings: Record<string, unknown>) => {
    const child = ORIGINAL_CHILD(bindings);
    child.warn = ((obj: Record<string, unknown>, msg: string) => {
      warns.push({ obj, msg });
    }) as typeof child.warn;
    child.error = ((obj: Record<string, unknown>, msg: string) => {
      errors.push({ obj, msg });
    }) as typeof child.error;
    return child;
  }) as unknown as typeof baseLogger.child;
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  supabase.rpc = ORIGINAL_RPC;
  baseLogger.child = ORIGINAL_CHILD;
});

beforeEach(() => { warns = []; errors = []; rpcError = P0001; });

const app = new Hono<{ Variables: HonoVariables }>();
app.use("*", requestIdMiddleware);
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

function assertNoPii(obj: Record<string, unknown>) {
  const extra = Object.keys(obj).filter((k) => !ALLOWED_KEYS.has(k));
  assert.deepEqual(extra, [], `chaves fora da allowlist no log de recusa: ${extra.join(", ")}`);
  assert.doesNotMatch(JSON.stringify(obj), /Fulano|960000/, "dado pessoal vazou para o log");
}

describe("identityRejectState — sub-motivo de identity_required", () => {
  const now = 1_000_000_000;
  const TTL = 120_000;
  it("ausente, expirada (limite exato do TTL), sem claim de código e divergente", () => {
    assert.equal(identityRejectState(undefined, now), "absent");
    assert.equal(identityRejectState({ identified_at: now - TTL }, now), "mismatch", "no limite exato ainda vale");
    assert.equal(identityRejectState({ identified_at: now - TTL - 1 }, now), "expired");
    assert.equal(identityRejectState({ identified_at: now, auth_mode: "totp" }, now), "claim_missing");
    assert.equal(identityRejectState({ identified_at: now, auth_mode: "totp", totp_claim_id: "c" }, now), "mismatch");
    assert.equal(identityRejectState({ identified_at: now, auth_mode: "biometria" }, now), "mismatch");
  });
});

// 42501 das RPCs vem de assert_actor_in_reserve (ator sem autoridade na
// reserva) → negação de autorização: 403 com texto fixo, nunca a mensagem crua.
// Mas "permission denied for function" (GRANT perdido após recriar a RPC)
// também é 42501 e é falha de infraestrutura: 500 + log de erro.
describe("42501 das RPCs de saída/devolução — handler real", () => {
  const MILITARY_ID = "96666666-2222-2222-2222-222222222222";
  const routes = [
    {
      name: "/batch", path: "/api/lendings/batch", event: "lending.batch_create.rejected",
      body: { military_id: MILITARY_ID, reserve_id: RESERVE_ID, movement_id: "96666666-bbbb-bbbb-bbbb-bbbbbbbbbbbb", auth_mode: "totp", items: [{ material_type_id: "96666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantidade: 1 }] },
    },
    {
      name: "POST /", path: "/api/lendings", event: "lending.create.rejected",
      body: { military_id: MILITARY_ID, reserve_id: RESERVE_ID, material_type_id: "96666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantidade: 1, auth_mode: "totp" },
    },
    {
      name: "/bulk-return", path: "/api/lendings/bulk-return", event: "lending.bulk_return.rejected",
      body: { lending_ids: ["96666666-4444-4444-4444-444444444444"] },
    },
  ];

  async function post(path: string, body: unknown, sessionId: string) {
    const cookie = await sealSession({
      userId: "96666666-cccc-cccc-cccc-cccccccccccc", role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: RESERVE_ID, supabaseAccessToken: "fake",
      sessionId, issuedAt: Date.now(),
      pendingIdentity: {
        profile_id: MILITARY_ID, tenant_id: TENANT_ID, reserve_id: RESERVE_ID,
        identified_at: Date.now(), auth_mode: "totp", totp_claim_id: "96666666-dddd-dddd-dddd-dddddddddddd",
      },
    });
    return app.request(path, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  for (const route of routes) {
    it(`${route.name}: ator sem autoridade na reserva → 403 texto fixo + warn rpc_forbidden`, async () => {
      rpcError = { code: "42501", message: "ator 96666666-cccc nao autorizado na reserva 96666666-0000" };
      const res = await post(route.path, route.body, `sess-42501-${route.name}`);
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), { error: "Operacao nao autorizada nesta reserva" });
      const rejection = warns.find((w) => w.msg === route.event);
      assert.ok(rejection, `${route.name}: recusa 42501 sem rastro`);
      assert.equal(rejection.obj.reason, "rpc_forbidden");
      assertNoPii(rejection.obj);
    });

    it(`${route.name}: "permission denied for function" (GRANT perdido) → 500 + log de erro, não "não autorizado"`, async () => {
      rpcError = { code: "42501", message: "permission denied for function record_lending_batch" };
      const res = await post(route.path, route.body, `sess-grant-${route.name}`);
      assert.equal(res.status, 500);
      assert.ok(!warns.some((w) => w.obj.reason === "rpc_forbidden"), `${route.name}: falha de infraestrutura tratada como negação`);
      assert.ok(errors.some((e) => e.msg.endsWith(".persist_failure")), `${route.name}: falha de infraestrutura sem log de erro`);
    });
  }
});

describe("recusas de saída/devolução deixam rastro — handler real", () => {
  it("Registrar Saída recusada pela RPC (o incidente de 2026-09-24) → 409 e warn lending.batch_create.rejected", async () => {
    const actorId = "96666666-7777-7777-7777-777777777777";
    const militaryId = "96666666-2222-2222-2222-222222222222";
    const cookie = await sealSession({
      userId: actorId, role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: RESERVE_ID, supabaseAccessToken: "fake",
      sessionId: "sess-reject-3", issuedAt: Date.now(),
      pendingIdentity: {
        profile_id: militaryId, tenant_id: TENANT_ID, reserve_id: RESERVE_ID,
        identified_at: Date.now(), auth_mode: "totp",
        totp_claim_id: "96666666-8888-8888-8888-888888888888",
      },
    });

    const movementId = "96666666-9999-9999-9999-999999999999";
    const res = await app.request("/api/lendings/batch", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        military_id: militaryId, reserve_id: RESERVE_ID, movement_id: movementId, auth_mode: "totp",
        items: [{ material_type_id: "96666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa", quantidade: 1 }],
      }),
    });
    assert.equal(res.status, 409);

    const rejection = warns.find((w) => w.msg === "lending.batch_create.rejected");
    assert.ok(rejection, "a recusa da saída não deixou rastro no log — foi exatamente o que escondeu o incidente");
    assert.equal(rejection.obj.reason, "rpc_rejected");
    assert.equal(rejection.obj.detail, "LENDING_BIOMETRIC_PROOF_INVALID");
    assert.equal(rejection.obj.movementId, movementId);
    assertNoPii(rejection.obj);
  });

  it("devolução recusada pela RPC (P0001) → 409 e warn lending.bulk_return.rejected só com o código", async () => {
    const actorId = "96666666-1111-1111-1111-111111111111";
    const cookie = await sealSession({
      userId: actorId, role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: RESERVE_ID, supabaseAccessToken: "fake",
      sessionId: "sess-reject-1", issuedAt: Date.now(),
      pendingIdentity: {
        profile_id: "96666666-2222-2222-2222-222222222222",
        tenant_id: TENANT_ID, reserve_id: RESERVE_ID,
        identified_at: Date.now(), auth_mode: "totp",
        totp_claim_id: "96666666-3333-3333-3333-333333333333",
      },
    });

    const res = await app.request("/api/lendings/bulk-return", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ lending_ids: ["96666666-4444-4444-4444-444444444444"] }),
    });
    assert.equal(res.status, 409);

    const rejection = warns.find((w) => w.msg === "lending.bulk_return.rejected");
    assert.ok(rejection, "a recusa da RPC não deixou rastro no log");
    assert.equal(rejection.obj.reason, "rpc_rejected");
    assert.equal(rejection.obj.code, "P0001");
    assert.equal(rejection.obj.detail, "LENDING_BIOMETRIC_PROOF_INVALID");
    assert.equal(rejection.obj.actorId, actorId);
    assertNoPii(rejection.obj);
  });

  it("identificação por código bloqueada (força bruta) → 429 e warn com motivo totp_rate_limited", async () => {
    totpSecretRow = {
      id: "96666666-5555-5555-5555-555555555555", secret: "irrelevante",
      failure_count: 5, last_failure_at: new Date().toISOString(), last_used_token: null,
    };
    const actorId = "96666666-6666-6666-6666-666666666666";
    const cookie = await sealSession({
      userId: actorId, role: "admin_reserva",
      tenantId: TENANT_ID, reserveId: RESERVE_ID, supabaseAccessToken: "fake",
      sessionId: "sess-reject-2", issuedAt: Date.now(),
    });

    const res = await app.request("/api/lendings/identify", {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ mode: "totp", matricula: "960000", code: "123456", reserve_id: RESERVE_ID }),
    });
    assert.equal(res.status, 429);

    const rejection = warns.find((w) => w.msg === "lending.identify.rejected");
    assert.ok(rejection, "o bloqueio por força bruta não deixou rastro no log");
    assert.equal(rejection.obj.reason, "totp_rate_limited");
    assert.equal(rejection.obj.actorId, actorId);
    assertNoPii(rejection.obj);
  });
});
