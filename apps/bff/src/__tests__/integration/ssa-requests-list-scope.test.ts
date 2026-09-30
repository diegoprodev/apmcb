import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-37 lote 2 (docs/auditoria/EVIDENCE_R37_BATCH2.md): /reserva/solicitacoes
// passou a ler de GET /api/ssa/requests (routes/ssa.ts, NÃO alterado). Este
// teste fixa o escopo do endpoint com o handler REAL e o contexto de sessão
// já resolvido injetado (papel EFETIVO, tenant, reserva ativa — como o
// authMiddleware entrega; Modo Usuário = papel efetivo "usuario"). A
// resolução da sessão em si é coberta por mode-user-auth-paths e
// ocorrencias-scope-real-handler.

const { ssaRoutes } = await import("../../routes/ssa.ts");

const T_A = "40a00000-0000-0000-0000-00000000000a";
const T_B = "40b00000-0000-0000-0000-00000000000b";
const R_A1 = "40a10000-0000-0000-0000-0000000000a1";
const R_A2 = "40a20000-0000-0000-0000-0000000000a2";
const R_B1 = "40b10000-0000-0000-0000-0000000000b1";
const STAFF_A1 = "40000000-0000-0000-0000-00000000005a";
const MIL_A = "40000000-0000-0000-0000-0000000000d1";
const MIL_A_OTHER = "40000000-0000-0000-0000-0000000000d2";
const MIL_B = "40000000-0000-0000-0000-0000000000d3";

const req = (id: string, military: string, tenant: string, reserve: string, requestedAt = "2026-09-30T00:00:00Z"): Row =>
  ({ id, military_id: military, reserva_id: null, tenant_id: tenant, reserve_id: reserve, status: "pendente", requested_at: requestedAt });

// O fake não ordena: as linhas vêm na ordem do array, que aqui imita o
// `order(requested_at desc)` real — as 60 mais recentes (reserva A2) primeiro.
// Assim um filtro de reserva aplicado DEPOIS do limite perderia as de A1.
const REQUESTS: Row[] = [
  // Volume: 60 solicitações da reserva A2, mais recentes que tudo de A1.
  ...Array.from({ length: 60 }, (_, i) => req(`a2-bulk-${String(i).padStart(2, "0")}`, MIL_A_OTHER, T_A, R_A2, "2026-10-01T00:00:00Z")),
  req("a1-mil-a", MIL_A, T_A, R_A1),
  req("a1-mil-a-other", MIL_A_OTHER, T_A, R_A1),
  req("a1-staff-own", STAFF_A1, T_A, R_A1),
  req("a2-mil-a", MIL_A, T_A, R_A2),
  req("b1-mil-b", MIL_B, T_B, R_B1),
  // Inconsistência tenant×reserva: reserva A1 mas tenant B — o filtro de
  // tenant precisa barrar mesmo com a reserva batendo.
  req("a1-tenant-b", MIL_B, T_B, R_A1),
];

const tables = {
  material_requests: {
    columns: ["id", "military_id", "reserva_id", "tenant_id", "reserve_id", "status", "requested_at"],
    rows: REQUESTS,
  },
  profiles: { columns: ["id"], rows: [] },
  material_request_items: { columns: ["id"], rows: [] },
  reserves: { columns: ["id", "tenant_id"], rows: [{ id: R_A1, tenant_id: T_A }, { id: R_A2, tenant_id: T_A }, { id: R_B1, tenant_id: T_B }] },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_RPC = supabase.rpc.bind(supabase);
before(() => {
  const fake = createFakePostgrest(tables);
  supabase.from = ((t: string) => fake.from(t)) as unknown as typeof supabase.from;
  // GET /requests expira solicitações vencidas antes de listar (RPC): no-op aqui.
  supabase.rpc = (async () => ({ data: null, error: null })) as unknown as typeof supabase.rpc;
});
after(() => { supabase.from = ORIGINAL_FROM; supabase.rpc = ORIGINAL_RPC; });

function appFor(ctx: { userId: string; role: string; tenantId: string | null; reserveId: string | null }) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", ctx.userId);
    c.set("role", ctx.role as HonoVariables["role"]);
    c.set("tenantId", ctx.tenantId);
    c.set("reserveId", ctx.reserveId);
    await next();
  });
  app.route("/api/ssa", ssaRoutes);
  return app;
}
async function ids(ctx: Parameters<typeof appFor>[0]): Promise<string[]> {
  const r = await appFor(ctx).request("/api/ssa/requests");
  assert.equal(r.status, 200);
  return ((await r.json()) as Array<{ id: string }>).map((o) => o.id).sort();
}

const STAFF_A1_CTX = { userId: STAFF_A1, role: "armeiro", tenantId: T_A, reserveId: R_A1 };

describe("R-37 lote 2 — GET /api/ssa/requests: escopo por papel efetivo, tenant, reserva e dono", () => {
  it("A/E/J/K. staff A1: todas de A1 do tenant A, nada de A2 (mesmo com 60 mais recentes), nada do tenant B", async () => {
    assert.deepEqual(await ids(STAFF_A1_CTX), ["a1-mil-a", "a1-mil-a-other", "a1-staff-own"]);
  });

  it("B. mesmo staff com papel efetivo usuario (Modo Usuário): só as próprias", async () => {
    assert.deepEqual(await ids({ ...STAFF_A1_CTX, role: "usuario" }), ["a1-staff-own"]);
  });

  it("C/F. usuario comum: só as próprias (de qualquer reserva), nenhuma de outro militar do mesmo tenant", async () => {
    assert.deepEqual(await ids({ userId: MIL_A, role: "usuario", tenantId: T_A, reserveId: R_A1 }), ["a1-mil-a", "a2-mil-a"]);
  });

  it("D. staff do tenant B: nada do tenant A", async () => {
    const got = await ids({ userId: "40000000-0000-0000-0000-00000000005b", role: "armeiro", tenantId: T_B, reserveId: R_B1 });
    assert.deepEqual(got, ["b1-mil-b"]);
  });

  it("D2. filtro de tenant barra linha com a reserva certa mas tenant de outra instituição", async () => {
    assert.ok(!(await ids(STAFF_A1_CTX)).includes("a1-tenant-b"));
  });

  it("matriz (admin_global sem reserva ativa) do tenant A: A1 + A2 do tenant A, limitado a 50, nada de B", async () => {
    const got = await ids({ userId: "40000000-0000-0000-0000-00000000005c", role: "admin_global", tenantId: T_A, reserveId: null });
    assert.equal(got.length, 50);
    assert.ok(got.every((id) => !id.startsWith("b1") && id !== "a1-tenant-b"));
  });

  it("G. staff sem reserva ativa (não-matriz): lista vazia, nunca o tenant inteiro", async () => {
    assert.deepEqual(await ids({ userId: STAFF_A1, role: "armeiro", tenantId: T_A, reserveId: null }), []);
  });
});
