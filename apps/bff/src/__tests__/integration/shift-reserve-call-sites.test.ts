import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-50 (docs/auditoria/EVIDENCE_R50.md), call sites restantes SEM a WIP_BIOMETRIA:
// requireActiveShift(role, userId) sem reserva alvo deixava o turno de A autorizar a
// operação com a sessão em B. Handlers REAIS; contexto de sessão injetado como o
// authMiddleware entrega. Cada handler agora passa a reserva ativa da sessão ao gate.

const { arsenalRoutes } = await import("../../routes/arsenal.ts");
const { categoriesRoutes } = await import("../../routes/categories.ts");
const { ocorrenciasRoutes } = await import("../../routes/ocorrencias.ts");

const T = "d1a00000-0000-0000-0000-00000000000a";
const R_A = "d1a10000-0000-0000-0000-0000000000a1";
const R_B = "d1a20000-0000-0000-0000-0000000000a2";
const ARM = "d1000000-0000-0000-0000-0000000000a0"; // turno ativo em A
const MT = "d1000000-0000-0000-0000-0000000000b0";
const OCC = "d1000000-0000-0000-0000-0000000000c0";

const tables = {
  service_shifts: { columns: ["id", "armeiro_id", "status", "reserve_id"], rows: [{ id: "s1", armeiro_id: ARM, status: "ativo", reserve_id: R_A }] as Row[] },
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
beforeEach(() => { fake.calls.length = 0; rpcCalls = 0; });

type Ctx = { userId: string; role: string; tenantId: string | null; reserveId: string | null };
function appFor(ctx: Ctx) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    c.set("userId", ctx.userId); c.set("role", ctx.role as HonoVariables["role"]);
    c.set("tenantId", ctx.tenantId); c.set("reserveId", ctx.reserveId);
    await next();
  });
  app.route("/api/arsenal", arsenalRoutes);
  app.route("/api/categories", categoriesRoutes);
  app.route("/api/ocorrencias", ocorrenciasRoutes);
  return app;
}
const CALLS: Array<{ name: string; method: string; path: string; body: unknown }> = [
  { name: "POST /api/arsenal/requests", method: "POST", path: "/api/arsenal/requests", body: { type: "stock_adjustment", material_type_id: MT, new_quantity: 1 } },
  { name: "POST /api/categories/request", method: "POST", path: "/api/categories/request", body: { nome: "Cat nova" } },
  { name: "POST /api/categories/:id/edit-request", method: "POST", path: `/api/categories/${MT}/edit-request`, body: { nome: "Cat editada" } },
  { name: "PATCH /api/ocorrencias/:id", method: "PATCH", path: `/api/ocorrencias/${OCC}`, body: { status: "resolvida" } },
];
async function call(ctx: Ctx, c: (typeof CALLS)[number]) {
  const r = await appFor(ctx).request(c.path, { method: c.method, headers: { "content-type": "application/json" }, body: JSON.stringify(c.body) });
  const text = await r.text();
  let error: string | undefined;
  try { error = (JSON.parse(text) as { error?: string }).error; } catch { /* sem json */ }
  return { status: r.status, error };
}
const ARM_A: Ctx = { userId: ARM, role: "armeiro", tenantId: T, reserveId: R_A };
const writes = () => fake.calls.filter((c) => c.select === "insert" || c.select === "update").length;

for (const c of CALLS) {
  describe(`R-50 — ${c.name}: o turno precisa ser da reserva ativa da sessão`, () => {
    it("turno em A e sessão trocada para B → 403 SHIFT_WRONG_RESERVE, sem nenhuma escrita (antes: seguia com o turno de A)", async () => {
      const r = await call({ ...ARM_A, reserveId: R_B }, c);
      assert.equal(r.status, 403);
      assert.equal(r.error, "SHIFT_WRONG_RESERVE");
      assert.equal(writes(), 0);
      assert.equal(rpcCalls, 0);
    });

    it("turno em A e sessão em A → o gate de turno passa (nunca SHIFT_*) e o handler segue para a própria lógica (resposta diferente do 403 de turno)", async () => {
      const r = await call(ARM_A, c);
      assert.ok(r.error !== "SHIFT_WRONG_RESERVE" && r.error !== "SHIFT_REQUIRED", `${r.status} ${r.error}`);
      assert.notEqual(r.status, 403, `${r.status} ${r.error}`);
    });

    it("admin_reserva/admin_global com a sessão em qualquer reserva: o gate de turno não se aplica (nunca SHIFT_*)", async () => {
      for (const role of ["admin_reserva", "admin_global"]) {
        const r = await call({ ...ARM_A, userId: "d1000000-0000-0000-0000-0000000000a9", role, reserveId: R_B }, c);
        assert.ok(r.error !== "SHIFT_WRONG_RESERVE" && r.error !== "SHIFT_REQUIRED", `${role}: ${r.status} ${r.error}`);
      }
    });
  });
}

describe("R-50 — POST /api/arsenal/requests: armeiro sem reserva ativa", () => {
  it("→ 400 antes do gate de turno (antes: qualquer turno de qualquer reserva passava), sem escrita", async () => {
    const r = await call({ ...ARM_A, reserveId: null }, CALLS[0]);
    assert.equal(r.status, 400);
    assert.equal(r.error, "reserva nao encontrada");
    assert.equal(writes(), 0);
  });
});

describe("R-50 — guarda estática dos 4 call sites", () => {
  it("cada um passa a reserva da sessão como alvo do turno; os pontos da WIP (cautelamentos.ts) não foram tocados", () => {
    const read = (f: string) => readFileSync(new URL(`../../routes/${f}`, import.meta.url), "utf8");
    assert.ok(read("arsenal.ts").includes("requireActiveShift(role, requestorId, reserveId ?? null)"));
    assert.equal(read("categories.ts").split("requireActiveShift(role, userId, reserveId ?? null)").length - 1, 2);
    assert.ok(read("ocorrencias.ts").includes('requireActiveShift(role, staffId, c.get("reserveId") ?? null)'));
  });
});
