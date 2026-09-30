import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-39: POST /api/ocorrencias notificava o staff da plataforma inteira. Agora
// só quem pode ver a ocorrência (regra do GET): staff do tenant com reserva
// ativa = reserva derivada, e admin_global em matriz do tenant. lending_id e
// material_type_id do cliente só valem se forem do tenant (e a lending, do
// próprio militar). Contexto de sessão injetado; a autenticação é coberta por
// ocorrencias-scope-real-handler.test.ts.

const { ocorrenciasRoutes } = await import("../../routes/ocorrencias.ts");

const T_A = "39a00000-0000-0000-0000-00000000000a";
const T_B = "39b00000-0000-0000-0000-00000000000b";
const R_A1 = "39a10000-0000-0000-0000-0000000000a1";
const R_A2 = "39a20000-0000-0000-0000-0000000000a2";
const R_B1 = "39b10000-0000-0000-0000-0000000000b1";
const MIL_A = "39000000-0000-0000-0000-0000000000d1";
const MIL_A2 = "39000000-0000-0000-0000-0000000000d2";

const P = (id: string, role: string, tenant: string, reserve: string | null, status = "complete"): Row =>
  ({ id, role, default_tenant_id: tenant, active_reserve_id: reserve, registration_status: status });
const PROFILES = [
  P("arm-a1", "armeiro", T_A, R_A1),
  P("adm-res-a1", "admin_reserva", T_A, R_A1),
  P("arm-a2", "armeiro", T_A, R_A2),
  P("glob-a-matriz", "admin_global", T_A, null),
  P("glob-a-filial-a2", "admin_global", T_A, R_A2),
  P("arm-a1-pendente", "armeiro", T_A, R_A1, "pending"),
  P("arm-b1", "armeiro", T_B, R_B1),
  P("glob-b-matriz", "admin_global", T_B, null),
  P(MIL_A, "usuario", T_A, R_A1),
  // Cache desatualizado: default_tenant_id = A, mas a membership é do tenant B.
  P("arm-cache-a-membro-b", "armeiro", T_A, R_A1),
  // Cache desatualizado no sentido inverso: membership A, default_tenant_id = B.
  P("arm-membro-a-cache-b", "armeiro", T_B, R_A1),
  // Staff em Modo Usuário reportando: armeiro da própria reserva A1.
  P("arm-a1-reporter", "armeiro", T_A, R_A1),
];
const MEMBERSHIP = (id: string) =>
  id === "arm-cache-a-membro-b" ? T_B : id === "arm-membro-a-cache-b" ? T_A : String(PROFILES.find((p) => p.id === id)?.default_tenant_id);
const L_A1_OWN = "39e00000-0000-0000-0000-0000000000a1";
const L_A1_OTHER_MIL = "39e00000-0000-0000-0000-0000000000a2";
const L_B1 = "39e00000-0000-0000-0000-0000000000b1";
const L_A1_REPORTER = "39e00000-0000-0000-0000-0000000000a3";
const MT_A2 = "39f00000-0000-0000-0000-0000000000a2";
const MT_B1 = "39f00000-0000-0000-0000-0000000000b1";

let notifications: Row[];
let ocorrencias: Row[];
function buildTables() {
  notifications = [];
  ocorrencias = [];
  return {
    profiles: { columns: ["id", "role", "default_tenant_id", "active_reserve_id", "registration_status"], rows: PROFILES },
    tenant_memberships: { columns: ["user_id", "tenant_id"], rows: PROFILES.map((p) => ({ user_id: p.id, tenant_id: MEMBERSHIP(String(p.id)) })) },
    lendings: {
      columns: ["id", "reserve_id", "tenant_id", "military_id"],
      rows: [
        { id: L_A1_OWN, reserve_id: R_A1, tenant_id: T_A, military_id: MIL_A },
        { id: L_A1_REPORTER, reserve_id: R_A1, tenant_id: T_A, military_id: "arm-a1-reporter" },
        { id: L_A1_OTHER_MIL, reserve_id: R_A1, tenant_id: T_A, military_id: MIL_A2 },
        { id: L_B1, reserve_id: R_B1, tenant_id: T_B, military_id: MIL_A },
      ],
    },
    material_types: {
      columns: ["id", "reserve_id", "tenant_id"],
      rows: [{ id: MT_A2, reserve_id: R_A2, tenant_id: T_A }, { id: MT_B1, reserve_id: R_B1, tenant_id: T_B }],
    },
    ocorrencias: {
      columns: ["id", "military_id", "lending_id", "material_type_id", "material_nome_snapshot", "titulo", "descricao"],
      rows: ocorrencias,
    },
    notifications: { columns: ["id", "user_id", "type", "title", "body", "metadata"], rows: notifications },
  };
}
const ORIGINAL_FROM = supabase.from.bind(supabase);
beforeEach(() => {
  const fake = createFakePostgrest(buildTables(), { reverseFk: { tenant_memberships: "user_id" } });
  supabase.from = ((t: string) => fake.from(t)) as unknown as typeof supabase.from;
});
after(() => { supabase.from = ORIGINAL_FROM; });

function appFor(tenantId: string | null, userId = MIL_A) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    c.set("userId", userId);
    c.set("role", "usuario");
    c.set("tenantId", tenantId);
    c.set("reserveId", R_A1);
    await next();
  });
  app.route("/api/ocorrencias", ocorrenciasRoutes);
  return app;
}
async function report(extra: Record<string, string>, tenantId: string | null = T_A, userId = MIL_A) {
  const r = await appFor(tenantId, userId).request("/api/ocorrencias", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ titulo: "Defeito no material", descricao: "Descrição com mais de dez caracteres", ...extra }),
  });
  return r.status;
}
const notified = () => notifications.map((n) => String(n.user_id)).sort();

describe("R-39 — POST /api/ocorrencias: destinatários e referências escopados", () => {
  it("lending própria da reserva A1: só staff ativo em A1 e admin_global em matriz do tenant A", async () => {
    assert.equal(await report({ lending_id: L_A1_OWN }), 201);
    assert.deepEqual(notified(), ["adm-res-a1", "arm-a1", "arm-a1-reporter", "glob-a-matriz"]);
  });

  it("nunca notifica outro tenant, outra reserva, admin_global em filial alheia, cadastro pendente nem cache de tenant desatualizado", async () => {
    await report({ lending_id: L_A1_OWN });
    for (const id of ["arm-b1", "glob-b-matriz", "arm-a2", "glob-a-filial-a2", "arm-a1-pendente", "arm-cache-a-membro-b", "arm-membro-a-cache-b"]) {
      assert.ok(!notified().includes(id), `notificou ${id}`);
    }
  });

  it("material_type da reserva A2 (sem lending): staff de A2 e matriz A", async () => {
    assert.equal(await report({ material_type_id: MT_A2 }), 201);
    assert.deepEqual(notified(), ["arm-a2", "glob-a-filial-a2", "glob-a-matriz"]);
  });

  it("sem lending nem material: só a matriz do tenant", async () => {
    assert.equal(await report({}), 201);
    assert.deepEqual(notified(), ["glob-a-matriz"]);
  });

  it("lending de outro militar → 400, nada gravado, ninguém notificado", async () => {
    assert.equal(await report({ lending_id: L_A1_OTHER_MIL }), 400);
    assert.equal(ocorrencias.length, 0);
    assert.deepEqual(notified(), []);
  });

  it("lending de outro tenant → 400 (não direciona notificação para o tenant B)", async () => {
    assert.equal(await report({ lending_id: L_B1 }), 400);
    assert.equal(ocorrencias.length, 0);
    assert.deepEqual(notified(), []);
  });

  it("material_type de outro tenant → 400", async () => {
    assert.equal(await report({ material_type_id: MT_B1 }), 400);
    assert.equal(ocorrencias.length, 0);
    assert.deepEqual(notified(), []);
  });

  it("sem tenant na sessão: registra a ocorrência, não notifica ninguém", async () => {
    assert.equal(await report({}, null), 201);
    assert.equal(ocorrencias.length, 1);
    assert.deepEqual(notified(), []);
  });

  it("staff em Modo Usuário que reporta não notifica a si mesmo", async () => {
    assert.equal(await report({ lending_id: L_A1_REPORTER }, T_A, "arm-a1-reporter"), 201);
    assert.ok(!notified().includes("arm-a1-reporter"));
    assert.deepEqual(notified(), ["adm-res-a1", "arm-a1", "glob-a-matriz"]);
  });

  it("ID de lending inexistente → 400", async () => {
    assert.equal(await report({ lending_id: "39e00000-0000-0000-0000-0000000000ff" }), 400);
    assert.equal(ocorrencias.length, 0);
  });
});
