import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import type { HonoVariables } from "../../types/hono.ts";

// D-03 (docs/auditoria/EVIDENCE_D03_ADMIN_GLOBAL_READONLY.md): admin_global é
// SOMENTE LEITURA sobre material e movimentação de reserva. Handlers REAIS; o
// banco é um stub que conta acessos — a negação tem que vir do roleGuard, antes
// de qualquer consulta, e deixar rastro (role_guard.denied) no log.

const { lendingRoutes } = await import("../../routes/lendings.ts");
const { ssaRoutes } = await import("../../routes/ssa.ts");
const { arsenalRoutes } = await import("../../routes/arsenal.ts");
const { categoriesRoutes } = await import("../../routes/categories.ts");
const { handoversRoutes } = await import("../../routes/handovers.ts");
const { inventoryRoutes } = await import("../../routes/inventory.ts");
const { ocorrenciasRoutes } = await import("../../routes/ocorrencias.ts");

const ID = "d3000000-0000-0000-0000-000000000001";
const ROUTES: Array<[string, string, string]> = [
  // [método, prefixo, caminho]
  ["PATCH", "/api/arsenal", `/requests/${ID}/approve`],
  ["PATCH", "/api/arsenal", `/requests/${ID}/reject`],
  ["PATCH", "/api/arsenal", `/items/${ID}/ocorrencia`],
  ["POST", "/api/categories", "/request"],
  ["POST", "/api/categories", `/requests/${ID}/approve`],
  ["POST", "/api/categories", `/requests/${ID}/reject`],
  ["PATCH", "/api/ssa", `/requests/${ID}/approve`],
  ["PATCH", "/api/ssa", `/requests/${ID}/reject`],
  ["PATCH", "/api/ssa", `/requests/${ID}/deliver`],
  ["POST", "/api/ssa", "/modo-a"],
  ["POST", "/api/lendings", "/identify"],
  ["POST", "/api/lendings", "/batch"],
  ["POST", "/api/lendings", "/"],
  ["POST", "/api/lendings", "/bulk-return"],
  ["PATCH", "/api/lendings", `/${ID}/return`],
  ["POST", "/api/handovers", "/"],
  ["POST", "/api/handovers", `/${ID}/sign-exit`],
  ["POST", "/api/handovers", `/${ID}/assign-entry`],
  ["POST", "/api/handovers", `/${ID}/sign-entry`],
  ["POST", "/api/handovers", `/${ID}/report-divergence`],
  ["POST", "/api/inventory", `/reserve-checks/${ID}/items/${ID}/check`],
  ["PATCH", "/api/inventory", `/reserve-checks/${ID}/assign`],
  ["POST", "/api/inventory", `/reserve-checks/${ID}/sign`],
  ["PATCH", "/api/ocorrencias", `/${ID}`],
];
// Rotas que o admin_global MANTÉM (D-03: cria inventário/estrutura): o roleGuard não pode negá-lo.
const KEPT: Array<[string, string, string]> = [
  ["POST", "/api/inventory", "/campaigns"],
  ["POST", "/api/inventory", `/campaigns/${ID}/start`],
  ["POST", "/api/inventory", `/campaigns/${ID}/close`],
];

const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_RPC = supabase.rpc.bind(supabase);
let dbCalls = 0;
before(() => {
  supabase.from = ((_t: string) => { dbCalls++; throw new Error("stub: acesso ao banco"); }) as unknown as typeof supabase.from;
  supabase.rpc = ((..._a: unknown[]) => { dbCalls++; throw new Error("stub: rpc"); }) as unknown as typeof supabase.rpc;
});
after(() => { supabase.from = ORIGINAL_FROM; supabase.rpc = ORIGINAL_RPC; });

function appFor(role: string, logs: Array<{ obj: Record<string, unknown>; msg: string }>) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    c.set("userId", "d3000000-0000-0000-0000-0000000000aa");
    c.set("role", role as HonoVariables["role"]);
    c.set("tenantId", "d3000000-0000-0000-0000-0000000000bb");
    c.set("reserveId", null);
    const log = { warn: (obj: Record<string, unknown>, msg: string) => { logs.push({ obj, msg }); }, info() {}, error() {}, debug() {} };
    c.set("log", log as unknown as HonoVariables["log"]);
    await next();
  });
  app.route("/api/lendings", lendingRoutes);
  app.route("/api/ssa", ssaRoutes);
  app.route("/api/arsenal", arsenalRoutes);
  app.route("/api/categories", categoriesRoutes);
  app.route("/api/handovers", handoversRoutes);
  app.route("/api/inventory", inventoryRoutes);
  app.route("/api/ocorrencias", ocorrenciasRoutes);
  app.onError((err, c) => (err instanceof HTTPException ? c.json({ error: err.message }, err.status) : c.json({ error: "erro" }, 500)));
  return app;
}
const hit = (app: ReturnType<typeof appFor>, [m, prefix, path]: [string, string, string]) =>
  app.request(`${prefix}${path === "/" ? "" : path}`, { method: m, headers: { "content-type": "application/json" }, body: "{}" });

describe("D-03 — admin_global é somente leitura sobre material e movimentação", () => {
  it(`admin_global: 403 em ${ROUTES.length} rotas, sem tocar no banco e com rastro role_guard.denied`, async () => {
    for (const r of ROUTES) {
      const logs: Array<{ obj: Record<string, unknown>; msg: string }> = [];
      dbCalls = 0;
      const res = await hit(appFor("admin_global", logs), r);
      assert.equal(res.status, 403, `${r[0]} ${r[1]}${r[2]}`);
      assert.equal(dbCalls, 0, `${r[0]} ${r[1]}${r[2]}: sem acesso ao banco`);
      assert.ok(logs.some((l) => l.msg === "role_guard.denied" && l.obj.role === "admin_global"), `${r[0]} ${r[1]}${r[2]}: rastro`);
    }
  });

  it("controle positivo: admin_reserva NÃO é negado pelo roleGuard nas mesmas rotas (a negação é específica do admin_global)", async () => {
    for (const r of ROUTES) {
      const logs: Array<{ obj: Record<string, unknown>; msg: string }> = [];
      // Rotas só de armeiro/etc. podem ainda falhar por outros motivos (400/500), nunca por role_guard.
      await hit(appFor("admin_reserva", logs), r);
      assert.ok(!logs.some((l) => l.msg === "role_guard.denied"), `${r[0]} ${r[1]}${r[2]}`);
    }
  });

  it("superadmin e auditor continuam fora (nada mudou) e usuario/Modo Usuário também", async () => {
    for (const role of ["superadmin", "usuario"]) {
      const res = await hit(appFor(role, []), ROUTES[2]);
      assert.equal(res.status, 403, role);
    }
  });

  it("admin_global MANTÉM criar/iniciar/fechar campanha de inventário (não é negado pelo roleGuard)", async () => {
    for (const r of KEPT) {
      const logs: Array<{ obj: Record<string, unknown>; msg: string }> = [];
      await hit(appFor("admin_global", logs), r);
      assert.ok(!logs.some((l) => l.msg === "role_guard.denied"), `${r[0]} ${r[1]}${r[2]}`);
    }
  });
});
