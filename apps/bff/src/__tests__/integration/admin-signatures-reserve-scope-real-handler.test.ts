import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { getIronSession } from "iron-session";
import { authMiddleware } from "../../middleware/auth.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { adminRoutes } from "../../routes/admin.ts";
import { signatureRoutes } from "../../routes/signatures.ts";
import { sessionOptions, type SessionData } from "../../lib/session.ts";
import { baseLogger } from "../../lib/logger.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// Revisão da spec da Ficha Operacional (2026-09-30), brechas vivas fora dos
// "arquivos de custódia":
// - POST /api/admin/users/invite gravava reserve_memberships com o reserve_id
//   do corpo, sem conferir tenant nem autoridade: um admin_reserva de B
//   convidava alguém como armeiro da reserva A (ou de outro tenant).
// - POST /api/admin/users/enviar-acesso conferia só o tenant: um armeiro de B
//   gravava o próprio e-mail num militar de A e recebia o link da conta.
// - POST /api/signatures e /:id/revoke não conferiam a reserva do documento.
// Handler real (bun). Ids prefixo "92".

const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_AUTH_ADMIN = { ...supabase.auth.admin };
const ORIGINAL_CHILD = baseLogger.child.bind(baseLogger);
const TENANT_ID = "92222222-0000-0000-0000-000000000001";
const RESERVE_B = "92222222-0000-0000-0000-00000000000b";
const RESERVE_A = "92222222-0000-0000-0000-00000000000a";
const ACTOR_IDS = {
  armeiro: "92222222-1111-1111-1111-111111111111",
  admin_reserva: "92222222-1111-1111-1111-111111111112",
  admin_global: "92222222-1111-1111-1111-111111111113",
} as const;
const TARGET_ID = "92222222-2222-2222-2222-222222222222";
const SIG_ID = "92222222-3333-3333-3333-333333333333";
const DOC_ID = "92222222-4444-4444-4444-444444444444";

let actorRole: keyof typeof ACTOR_IDS = "admin_reserva";
let reserveInTenant = true;
let actorStaffInReserve = true;
let targetInActorReserve = true;
let resourceReserveId: string = RESERVE_B;
let authAdminCalls: string[] = [];
let tablesTouched: string[] = [];
let inserts: string[] = [];
let warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];

function builder(data: unknown, extra: Record<string, unknown> = {}, listData?: unknown): unknown {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: listData ?? data, error: null, ...extra });
      if (prop === "single" || prop === "maybeSingle") return async () => ({ data, error: null, ...extra });
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

// Nomeado e reatribuído em beforeEach() — os testes de "reaproveitamento" e
// "revogação dupla" sobrescrevem supabase.from localmente; sem restaurar em
// beforeEach, o teste seguinte herdaria esse mock em silêncio (mesmo achado
// já corrigido em profiles-status-reserve-scope-real-handler.test.ts).
function defaultFromMock(table: string) {
    tablesTouched.push(table);
    const writes = {
      insert: () => { inserts.push(table); return builder({ id: "novo" }); },
      upsert: () => { inserts.push(table); return builder(null); },
      update: () => builder(null),
    };
    if (table === "revoked_sessions") return builder(null);
    if (table === "profiles") {
      return {
        select: (cols: string) => {
          if (cols.includes("sessions_invalidated_at")) return builder({ role: actorRole, sessions_invalidated_at: null });
          // POST /users/invite: checagem de profile já existente para o id
          // devolvido pelo GoTrue — por padrão não existe (caminho feliz).
          if (cols === "id, default_tenant_id") return builder(null);
          return builder({
            id: TARGET_ID, role: "usuario", default_tenant_id: TENANT_ID, nome_completo: "Militar",
            registration_status: "pending_biometric", invite_sent_at: null, email: null,
          });
        },
        ...writes,
      };
    }
    if (table === "reserves") return { select: () => builder(reserveInTenant ? { id: RESERVE_A, tenant_id: TENANT_ID } : null), ...writes };
    if (table === "reserve_memberships") {
      // Mesmo mock serve à autoridade do ATOR na reserva do convite e ao
      // vínculo do ALVO com a reserva ativa do ator.
      return {
        select: (cols: string) => builder(
          cols.includes("reserves!inner") ? (targetInActorReserve ? { reserve_id: RESERVE_B } : null) : (actorStaffInReserve ? { reserve_id: RESERVE_A } : null),
        ),
        ...writes,
      };
    }
    if (table === "document_signatures") {
      return {
        select: () => builder({ id: SIG_ID, revoked_at: null, document_type: "lending", document_id: DOC_ID, reserve_id: resourceReserveId, tenant_id: TENANT_ID }),
        ...writes,
      };
    }
    if (table === "lendings" || table === "service_handovers" || table === "cautelamentos" || table === "inventory_reserve_checks") {
      return { select: () => builder({ id: DOC_ID, reserve_id: resourceReserveId }), ...writes };
    }
    if (table === "totp_secrets") return { select: () => builder(null), ...writes };
    return { select: () => builder(null), ...writes };
}

before(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = defaultFromMock;
  const record = (name: string) => async () => { authAdminCalls.push(name); return { data: { user: { id: "convidado-1", email: null } }, error: null }; };
  supabase.auth.admin.inviteUserByEmail = record("inviteUserByEmail") as never;
  supabase.auth.admin.getUserById = record("getUserById") as never;
  supabase.auth.admin.updateUserById = record("updateUserById") as never;
  supabase.auth.admin.generateLink = record("generateLink") as never;
  supabase.auth.admin.deleteUser = record("deleteUser") as never;
  baseLogger.child = ((bindings: Record<string, unknown>) => {
    const child = ORIGINAL_CHILD(bindings);
    child.warn = ((obj: Record<string, unknown>, msg: string) => { warns.push({ obj, msg }); }) as typeof child.warn;
    return child;
  }) as unknown as typeof baseLogger.child;
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  Object.assign(supabase.auth.admin, ORIGINAL_AUTH_ADMIN);
  baseLogger.child = ORIGINAL_CHILD;
});

beforeEach(() => {
  // @ts-expect-error monkey-patch intencional do singleton pra teste de integração
  supabase.from = defaultFromMock;
  actorRole = "admin_reserva";
  reserveInTenant = true;
  actorStaffInReserve = true;
  targetInActorReserve = true;
  resourceReserveId = RESERVE_B;
  authAdminCalls = [];
  tablesTouched = [];
  inserts = [];
  warns = [];
});

const app = new Hono<{ Variables: HonoVariables }>();
app.use("*", requestIdMiddleware);
app.use("/api/*", authMiddleware);
app.route("/api/admin", adminRoutes);
app.route("/api/signatures", signatureRoutes);

async function request(method: string, path: string, body: unknown, reserveId: string | null = RESERVE_B) {
  const req = new Request("http://localhost/seal");
  const res = new Response(null);
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  Object.assign(session, {
    userId: ACTOR_IDS[actorRole], role: actorRole, tenantId: TENANT_ID, reserveId,
    supabaseAccessToken: "fake", sessionId: `sess-92-${actorRole}-${reserveId ?? "m"}`, issuedAt: Date.now(),
  } satisfies Partial<SessionData>);
  await session.save();
  const cookie = res.headers.getSetCookie().find((v) => v.startsWith(`${sessionOptions.cookieName}=`))!.split(";")[0];
  tablesTouched = [];
  return app.request(path, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
}

describe("POST /api/admin/users/invite — reserva do convite na autoridade do ator", () => {
  it("admin_reserva convidando armeiro para reserva onde NÃO é staff → recusado antes de convidar", async () => {
    actorStaffInReserve = false;
    const res = await request("POST", "/api/admin/users/invite", { email: "x@exemplo.com", role: "armeiro", reserve_id: RESERVE_A });
    assert.ok([403, 404].includes(res.status), `esperava 403/404, veio ${res.status}`);
    assert.deepEqual(authAdminCalls, [], "o convite foi disparado para reserva fora da autoridade do ator");
    assert.ok(!inserts.includes("reserve_memberships"));
    assert.ok(warns.some((x) => x.msg === "admin.invite.rejected" && x.obj.reason === "reserve_outside_authority"));
  });

  it("reserve_id de outro tenant → 404, nada criado", async () => {
    actorRole = "admin_global";
    reserveInTenant = false;
    const res = await request("POST", "/api/admin/users/invite", { email: "x@exemplo.com", role: "armeiro", reserve_id: RESERVE_A }, null);
    assert.equal(res.status, 404);
    assert.deepEqual(authAdminCalls, []);
    assert.ok(warns.some((x) => x.msg === "admin.invite.rejected" && x.obj.reason === "reserve_not_found"));
  });

  it("admin_reserva convidando armeiro para a própria reserva → 201", async () => {
    const res = await request("POST", "/api/admin/users/invite", { email: "x@exemplo.com", role: "armeiro", reserve_id: RESERVE_A });
    assert.equal(res.status, 201);
    assert.deepEqual(authAdminCalls, ["inviteUserByEmail"]);
    assert.ok(inserts.includes("reserve_memberships"));
  });

  it("admin_global em matriz convidando para qualquer reserva do tenant → 201", async () => {
    actorRole = "admin_global";
    actorStaffInReserve = false;
    const res = await request("POST", "/api/admin/users/invite", { email: "x@exemplo.com", role: "armeiro", reserve_id: RESERVE_A }, null);
    assert.equal(res.status, 201);
  });
});

describe("POST /api/admin/users/enviar-acesso — alvo na reserva do ator", () => {
  it("armeiro enviando acesso para militar de outra reserva → 404 antes de tocar na conta", async () => {
    actorRole = "armeiro";
    targetInActorReserve = false;
    const res = await request("POST", "/api/admin/users/enviar-acesso", { user_id: TARGET_ID, email: "atacante@exemplo.com" });
    assert.equal(res.status, 404);
    assert.deepEqual(authAdminCalls, [], "a conta de militar de outra reserva foi tocada");
    assert.ok(warns.some((x) => x.msg === "admin.acesso.rejected" && x.obj.reason === "target_outside_reserve"));
  });

  it("militar da própria reserva → passa da checagem de escopo e segue o fluxo de acesso", async () => {
    actorRole = "armeiro";
    await request("POST", "/api/admin/users/enviar-acesso", { user_id: TARGET_ID, email: "militar@exemplo.com" });
    assert.ok(authAdminCalls.includes("getUserById"), "o fluxo legítimo não chegou à conta do militar");
  });
});

describe("assinaturas — reserva do documento", () => {
  it("revogar assinatura de documento de outra reserva → 404, nada gravado", async () => {
    resourceReserveId = RESERVE_A;
    const res = await request("POST", `/api/signatures/${SIG_ID}/revoke`, { revocation_reason: "motivo qualquer" });
    assert.equal(res.status, 404);
    assert.ok(!inserts.includes("document_signatures"));
    assert.ok(warns.some((x) => x.msg === "signature.revoke.rejected" && x.obj.reason === "resource_outside_reserve"));
  });

  it("assinar documento de outra reserva → 404 antes de consumir o código dinâmico", async () => {
    resourceReserveId = RESERVE_A;
    const res = await request("POST", "/api/signatures", {
      document_type: "lending", document_id: DOC_ID, document_data: {}, totp_token: "123456",
    });
    assert.equal(res.status, 404);
    assert.ok(!tablesTouched.includes("totp_secrets"), "o código dinâmico foi consultado para documento de outra reserva");
    assert.ok(warns.some((x) => x.msg === "signature.create.rejected" && x.obj.reason === "resource_outside_reserve"));
  });

  it("assinar documento da própria reserva → segue para conferir o código dinâmico", async () => {
    await request("POST", "/api/signatures", {
      document_type: "lending", document_id: DOC_ID, document_data: {}, totp_token: "123456",
    });
    assert.ok(tablesTouched.includes("totp_secrets"));
  });
});

describe("teto de convite — auditor é papel de matriz (privilege escalation)", () => {
  it("admin_reserva NÃO pode convidar como auditor → 403, nenhum convite disparado", async () => {
    actorRole = "admin_reserva";
    const res = await request("POST", "/api/admin/users/invite", { email: "x@exemplo.com", role: "auditor" });
    assert.equal(res.status, 403);
    assert.deepEqual(authAdminCalls, []);
  });

  it("admin_global pode convidar como auditor → 201", async () => {
    actorRole = "admin_global";
    const res = await request("POST", "/api/admin/users/invite", { email: "x@exemplo.com", role: "auditor" }, null);
    assert.equal(res.status, 201);
  });
});

describe("POST /api/admin/users/invite — reaproveitamento de auth.users pendente por outro tenant", () => {
  it("e-mail já pertence a um profile de OUTRO tenant (convite pendente) → recusado, profile não sobrescrito", async () => {
    actorRole = "admin_global";
    let existingProfileLookup: unknown = { id: "convidado-1", default_tenant_id: "92222222-9999-9999-9999-999999999999" };
    const origFrom = supabase.from;
    supabase.from = ((table: string) => {
      if (table === "profiles") {
        return {
          select: (cols: string) => cols.includes("sessions_invalidated_at")
            ? builder({ role: actorRole, sessions_invalidated_at: null })
            : builder(existingProfileLookup),
          upsert: () => { inserts.push("profiles.upsert"); return builder(null); },
          update: () => builder(null),
        };
      }
      return (origFrom as (t: string) => unknown)(table);
    }) as typeof supabase.from;

    const res = await request("POST", "/api/admin/users/invite", { email: "reaproveitado@exemplo.com", role: "armeiro", reserve_id: RESERVE_A }, null);
    assert.ok([403, 409].includes(res.status), `esperava 403/409, veio ${res.status}`);
    assert.ok(!inserts.includes("profiles.upsert"), "o profile de outro tenant foi sobrescrito pelo convite");
  });
});

describe("POST /api/signatures/:id/revoke — não pode ser revogada duas vezes (RULE bloqueia UPDATE, existing.revoked_at nunca muda)", () => {
  it("assinatura já tem uma linha de substituição (replaced_by=id) → 409, nenhuma segunda linha inserida", async () => {
    const origFrom = supabase.from;
    let replacementInsertCount = 0;
    supabase.from = ((table: string) => {
      if (table === "document_signatures") {
        return {
          select: () => builder(
            { id: SIG_ID, revoked_at: null, document_type: "lending", document_id: DOC_ID, reserve_id: RESERVE_B, tenant_id: TENANT_ID },
            {},
            [{ id: "replacement-1", replaced_by: SIG_ID }],
          ),
          insert: () => { replacementInsertCount++; return builder({ id: "replacement-2" }); },
        };
      }
      return (origFrom as (t: string) => unknown)(table);
    }) as typeof supabase.from;

    const res = await request("POST", `/api/signatures/${SIG_ID}/revoke`, { revocation_reason: "motivo qualquer" });
    assert.equal(res.status, 409);
    assert.equal(replacementInsertCount, 0, "inseriu uma SEGUNDA linha de revogação para a mesma assinatura");
  });
});

describe("POST /api/admin/users/invite — corrida no reaproveitamento de auth.users pendente", () => {
  it("insert falha por 23505 (outra requisição venceu a corrida) → 409, NÃO apaga o auth.users que a outra requisição acabou de vincular", async () => {
    actorRole = "admin_global";
    const origFrom = supabase.from;
    supabase.from = ((table: string) => {
      if (table === "profiles") {
        return {
          select: (cols: string) => cols.includes("sessions_invalidated_at")
            ? builder({ role: actorRole, sessions_invalidated_at: null })
            : builder(null), // ninguém viu o profile ainda — os dois requests correm juntos
          insert: () => builder(null, { error: { code: "23505", message: "duplicate key value violates unique constraint" } }),
        };
      }
      return (origFrom as (t: string) => unknown)(table);
    }) as typeof supabase.from;

    const res = await request("POST", "/api/admin/users/invite", { email: "corrida@exemplo.com", role: "armeiro" }, null);
    assert.equal(res.status, 409, `esperava 409, veio ${res.status}`);
    assert.ok(!authAdminCalls.includes("deleteUser"), "apagou o auth.users que a outra requisição da corrida acabou de vincular com sucesso");
  });
});
