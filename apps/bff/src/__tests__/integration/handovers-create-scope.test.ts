import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-40 (docs/auditoria/EVIDENCE_R40.md): POST /api/handovers tratava
// `body.reserve_id` (input do cliente) como autoridade: admin_global pulava a
// checagem de membership, a reserva era buscada só por id (snapshot) e nada a
// confrontava com o tenant da SESSÃO. Handler REAL da rota; contexto de sessão
// (papel EFETIVO, tenant, reserva ativa) injetado como o authMiddleware entrega.
// A resolução da sessão (Modo Usuário, Bearer, identidade mista) é coberta por
// mode-user-auth-paths: /api/handovers/* está atrás do mesmo authMiddleware.
// Modelo: a passagem não tem itens próprios (só report_snapshot); os efeitos
// materiais do POST são o INSERT em service_handovers e o evento de auditoria.

const { handoversRoutes } = await import("../../routes/handovers.ts");

const T_A = "61a00000-0000-0000-0000-00000000000a";
const T_B = "61b00000-0000-0000-0000-00000000000b";
const R_A1 = "61a10000-0000-0000-0000-0000000000a1";
const R_A2 = "61a20000-0000-0000-0000-0000000000a2";
const R_B1 = "61b10000-0000-0000-0000-0000000000b1";
const R_NONE = "61ff0000-0000-0000-0000-0000000000ff";
const ADMIN_G = "61000000-0000-0000-0000-0000000000a0";
const ADMIN_R = "61000000-0000-0000-0000-0000000000a1";
const ARM = "61000000-0000-0000-0000-0000000000a2";
const ARM_STRAY = "61000000-0000-0000-0000-0000000000a3"; // membership "perdida" numa reserva do tenant B
const NOBODY = "61000000-0000-0000-0000-0000000000a4";
const SECRET_NAME = "Reserva B1 (segredo do tenant B)";

const tables = {
  reserves: {
    columns: ["id", "nome", "acronym", "tenant_id"],
    rows: [
      { id: R_A1, nome: "Reserva A1", acronym: "A1", tenant_id: T_A },
      { id: R_A2, nome: "Reserva A2", acronym: "A2", tenant_id: T_A },
      { id: R_B1, nome: SECRET_NAME, acronym: "B1", tenant_id: T_B },
    ],
  },
  reserve_memberships: {
    columns: ["id", "user_id", "reserve_id", "role"],
    rows: [
      { id: "m1", user_id: ADMIN_R, reserve_id: R_A1, role: "admin_reserva" },
      { id: "m2", user_id: ARM, reserve_id: R_A1, role: "armeiro" },
      { id: "m3", user_id: ARM_STRAY, reserve_id: R_B1, role: "armeiro" },
      { id: "m4", user_id: ADMIN_R, reserve_id: R_B1, role: "admin_reserva" },
    ],
  },
  service_handovers: { columns: ["id", "tenant_id", "reserve_id", "saindo_id", "observacao_saindo", "prazo_assumcao", "report_snapshot", "document_hash", "status", "created_at"], rows: [] as Row[] },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_RPC = supabase.rpc.bind(supabase);
let fake: ReturnType<typeof createFakePostgrest>;
let rpcCalls = 0;
before(() => {
  fake = createFakePostgrest(tables);
  supabase.from = ((t: string) => fake.from(t)) as unknown as typeof supabase.from;
  supabase.rpc = ((..._a: unknown[]) => { rpcCalls++; return Promise.resolve({ data: null, error: null }); }) as unknown as typeof supabase.rpc;
});
after(() => { supabase.from = ORIGINAL_FROM; supabase.rpc = ORIGINAL_RPC; });
beforeEach(() => { tables.service_handovers.rows.length = 0; fake.calls.length = 0; rpcCalls = 0; });

type Ctx = { userId: string; role: string; tenantId: string | null; reserveId: string | null };
function appFor(ctx: Ctx) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    c.set("userId", ctx.userId);
    c.set("role", ctx.role as HonoVariables["role"]);
    c.set("tenantId", ctx.tenantId);
    c.set("reserveId", ctx.reserveId);
    await next();
  });
  app.route("/api/handovers", handoversRoutes);
  return app;
}
async function create(ctx: Ctx, reserve_id: string) {
  const r = await appFor(ctx).request("/api/handovers", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reserve_id }),
  });
  const body = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  return { status: r.status, body: body as Record<string, unknown> | null };
}
const inserts = () => fake.calls.filter((c) => c.select === "insert").length;
const noWrites = () => {
  assert.equal(tables.service_handovers.rows.length, 0, "nenhum service_handover");
  assert.equal(inserts(), 0, "nenhum INSERT em nenhuma tabela (handover, auditoria etc.)");
  assert.equal(rpcCalls, 0, "nenhuma RPC");
};

const GLOBAL_A: Ctx = { userId: ADMIN_G, role: "admin_global", tenantId: T_A, reserveId: null };
const ADMIN_R_A1: Ctx = { userId: ADMIN_R, role: "admin_reserva", tenantId: T_A, reserveId: R_A1 };
const ARM_A1: Ctx = { userId: ARM, role: "armeiro", tenantId: T_A, reserveId: R_A1 };

describe("R-40 — POST /api/handovers: reserva validada contra o tenant da SESSÃO", () => {
  it("TENANT. admin_global do tenant A com reserva do tenant B: negado, sem escrita e sem vazar a reserva (R40_BEFORE_CROSS_TENANT)", async () => {
    const r = await create(GLOBAL_A, R_B1);
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.ok(!JSON.stringify(r.body).includes("segredo"));
    noWrites();
  });

  it("A. admin_global no PRÓPRIO tenant (reserva A2, sem membership): permitido; linha no tenant e na reserva certos", async () => {
    const r = await create(GLOBAL_A, R_A2);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(tables.service_handovers.rows.length, 1);
    const row = tables.service_handovers.rows[0];
    assert.equal(row.tenant_id, T_A);
    assert.equal(row.reserve_id, R_A2);
    assert.equal((row.report_snapshot as { reserve: { nome: string } }).reserve.nome, "Reserva A2");
  });

  it("TENANT. o snapshot nunca carrega dados da reserva de outro tenant", async () => {
    await create(GLOBAL_A, R_B1);
    assert.ok(!JSON.stringify(tables.service_handovers.rows).includes(SECRET_NAME));
  });

  it("D. reserva inexistente: 404 e sem escrita (mesma resposta da cross-tenant: sem enumeração)", async () => {
    const r = await create(GLOBAL_A, R_NONE);
    assert.equal(r.status, 404);
    noWrites();
    const cross = await create(GLOBAL_A, R_B1);
    assert.deepEqual(cross.body, r.body);
  });

  it("C. mesma reserve_id, tenant da sessão diferente: a reserva é do tenant B, então o staff do tenant B pode e o do A não", async () => {
    const asB = await create({ userId: NOBODY, role: "admin_global", tenantId: T_B, reserveId: null }, R_B1);
    assert.equal(asB.status, 201);
    assert.equal(tables.service_handovers.rows[0].tenant_id, T_B);
    tables.service_handovers.rows.length = 0; fake.calls.length = 0;
    assert.equal((await create(GLOBAL_A, R_B1)).status, 404);
    noWrites();
  });

  it("E. erro de banco ao validar a reserva: 500 genérico, fail-closed, sem escrita", async () => {
    const realFrom = supabase.from;
    supabase.from = ((t: string) => {
      if (t !== "reserves") return realFrom(t);
      const failing: unknown = new Proxy({}, {
        get: (_t, k) => k === "then"
          ? (res: (v: unknown) => void) => res({ data: null, error: { code: "XX000", message: "relation secret_table exploded" } })
          : () => failing,
      });
      return failing;
    }) as unknown as typeof supabase.from;
    try {
      const r = await create(GLOBAL_A, R_A1);
      assert.equal(r.status, 500);
      assert.ok(!JSON.stringify(r.body).includes("secret_table"));
      noWrites();
    } finally { supabase.from = realFrom; }
  });

  it("erro de banco ao validar a membership: 500 fail-closed (não 403 mascarando a causa), sem escrita", async () => {
    const realFrom = supabase.from;
    supabase.from = ((t: string) => {
      if (t !== "reserve_memberships") return realFrom(t);
      const failing: unknown = new Proxy({}, {
        get: (_t, k) => k === "then"
          ? (res: (v: unknown) => void) => res({ data: null, error: { code: "XX000", message: "membership exploded" } })
          : () => failing,
      });
      return failing;
    }) as unknown as typeof supabase.from;
    try {
      assert.equal((await create(ADMIN_R_A1, R_A1)).status, 500);
      noWrites();
    } finally { supabase.from = realFrom; }
  });

  it("sem tenant na sessão: negado (403), sem escrita", async () => {
    assert.equal((await create({ ...GLOBAL_A, tenantId: null }, R_A1)).status, 403);
    noWrites();
  });

  it("reserve_id inválido (não-UUID): 400, sem escrita", async () => {
    assert.equal((await create(GLOBAL_A, "not-a-uuid")).status, 400);
    noWrites();
  });
});

describe("R-40 — membership (autorização da reserva) continua separada da validação de tenant", () => {
  it("F. admin_reserva com membership na reserva do seu tenant: permitido", async () => {
    const r = await create(ADMIN_R_A1, R_A1);
    assert.equal(r.status, 201);
    assert.equal(tables.service_handovers.rows[0].tenant_id, T_A);
  });

  it("G/MEMBERSHIP. admin_reserva SEM membership numa reserva do PRÓPRIO tenant: 403 (tenant certo, sem autorização)", async () => {
    const r = await create(ADMIN_R_A1, R_A2);
    assert.equal(r.status, 403);
    noWrites();
  });

  it("H. armeiro com membership: permitido", async () => {
    assert.equal((await create(ARM_A1, R_A1)).status, 201);
  });

  it("I. armeiro sem membership na reserva: 403", async () => {
    assert.equal((await create(ARM_A1, R_A2)).status, 403);
    noWrites();
  });

  it("TENANT≠MEMBERSHIP. membership existente numa reserva de OUTRO tenant não autoriza: 404 (admin_reserva e armeiro)", async () => {
    assert.equal((await create({ ...ADMIN_R_A1 }, R_B1)).status, 404);
    assert.equal((await create({ userId: ARM_STRAY, role: "armeiro", tenantId: T_A, reserveId: null }, R_B1)).status, 404);
    noWrites();
  });

  it("J/K. usuario comum e staff em Modo Usuário (papel efetivo usuario): 403, sem escrita", async () => {
    assert.equal((await create({ ...ADMIN_R_A1, role: "usuario" }, R_A1)).status, 403);
    assert.equal((await create({ ...GLOBAL_A, role: "usuario" }, R_A2)).status, 403);
    noWrites();
  });

  it("P. fluxo legítimo: 201 com handover_id e hash; estado inicial aguardando_assinatura_saida", async () => {
    const r = await create(ADMIN_R_A1, R_A1);
    assert.equal(r.status, 201);
    assert.ok(typeof r.body?.handover_id === "string" && typeof r.body?.document_hash === "string");
    assert.equal(tables.service_handovers.rows[0].status, "aguardando_assinatura_saida");
    assert.equal(tables.service_handovers.rows[0].saindo_id, ADMIN_R);
  });

  it("guarda estática: a reserva é buscada com o tenant da sessão e a falha usa logFailure", () => {
    const src = readFileSync(new URL("../../routes/handovers.ts", import.meta.url), "utf8");
    const start = src.indexOf('handoversRoutes.post(\n  "/",');
    const chunk = src.slice(start, src.indexOf("handover.created", start));
    assert.match(chunk, /from\("reserves"\)[\s\S]*\.eq\("id", body\.reserve_id\)[\s\S]*\.eq\("tenant_id", tenantId\)/);
    assert.ok(chunk.includes('"handovers.create.reserve_lookup_failure"'));
  });
});
