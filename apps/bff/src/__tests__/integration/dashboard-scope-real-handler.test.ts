import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { dashboardRoutes } from "../../routes/dashboard.ts";
import { supabase } from "../../services/supabase.ts";
import { createFakePostgrest, type Row, type Tables } from "../helpers/fake-postgrest.ts";
import type { HonoVariables, Role } from "../../types/hono.ts";

// R-06 (docs/auditoria/EVIDENCE_R06.md): /api/dashboard/command e /stats rodam
// com service role (RLS não protege). Handler real contra um banco em memória
// que aplica os filtros de verdade. Cada escopo tem 1 (A1), 2 (A2) e 4 (B1)
// registros de cada tipo: qualquer vazamento vira soma reconhecível
// (3 = A1+A2, 5 = A1+B1, 7 = tudo). Ocorrências cobrem os 3 caminhos de
// reserva (lending, fallback por material_type, e órfã sem nenhum dos dois)
// e a precedência lending > material_type. Roda via bun (dashboard.ts usa
// imports sem extensão).

const T_A = "a0000000-0000-0000-0000-00000000000a";
const T_B = "b0000000-0000-0000-0000-00000000000b";
const R_A1 = "a1000000-0000-0000-0000-0000000000a1";
const R_A2 = "a2000000-0000-0000-0000-0000000000a2";
const R_B1 = "b1000000-0000-0000-0000-0000000000b1";
const SCOPES = [
  { tenant: T_A, reserve: R_A1, n: 1 },
  { tenant: T_A, reserve: R_A2, n: 2 },
  { tenant: T_B, reserve: R_B1, n: 4 },
];
const OLD = "2020-01-01T00:00:00.000Z";

function buildTables(): Tables {
  const rows: Record<string, Row[]> = {
    reserves: [], cautelamentos: [], material_items: [], lendings: [], ocorrencias: [],
    profiles: [], audit_events: [], service_handovers: [], reserve_memberships: [],
    material_availability: [], material_types: [],
  };
  const recent = new Date().toISOString();
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const mtOf: Record<string, string> = {};
  for (const s of SCOPES) {
    mtOf[s.reserve] = id("mt");
    rows.material_types.push({ id: mtOf[s.reserve], tenant_id: s.tenant, reserve_id: s.reserve });
  }
  for (const s of SCOPES) {
    rows.reserves.push({ id: s.reserve, tenant_id: s.tenant, status: "ativa" });
    const mt = mtOf[s.reserve];
    for (let i = 0; i < s.n; i++) {
      const base = { tenant_id: s.tenant, reserve_id: s.reserve };
      rows.cautelamentos.push({ id: id("cau"), ...base, status: "ativa", data_ultima_conferencia: null });
      rows.material_items.push({ id: id("mi"), ...base, status_operacional: "em_saida", identificador_principal: "X" });
      const lendingId = id("len");
      rows.lendings.push({ id: lendingId, ...base, status: "ativo", status_legacy: "ativo", issued_at: OLD, material_type_id: mt });
      rows.audit_events.push({ id: id("ae"), ...base, created_at: recent });
      rows.service_handovers.push({ id: id("sh"), ...base, status: "vencido", created_at: OLD });
      const userId = id("usr");
      rows.profiles.push({ id: userId, default_tenant_id: s.tenant, role: "usuario", totp_configured: false, registration_status: "pending_biometric" });
      rows.reserve_memberships.push({ id: id("rm"), reserve_id: s.reserve, user_id: userId, role: "usuario" });
      // i par: reserva pela lending; i ímpar: sem lending → fallback pelo material_type.
      // A lending de A2 aponta para um material_type de A1: tem de contar em A2 (precedência).
      const viaLending = i % 2 === 0;
      rows.ocorrencias.push({
        id: id("oc"), status: "aberta", military_id: userId,
        lending_id: viaLending ? lendingId : null,
        material_type_id: viaLending ? (s.reserve === R_A2 ? mtOf[R_A1] : null) : mt,
      });
      rows.material_availability.push({ id: id("ma"), nome: `mat-${s.reserve}-${i}`, ...base, quantidade_disponivel: 1 });
    }
  }
  // Ocorrência órfã (sem lending e sem material_type) de um militar do tenant A:
  // entra na contagem de matriz, nunca numa reserva (fail-closed).
  const orphanUser = id("usr");
  rows.profiles.push({ id: orphanUser, default_tenant_id: T_A, role: "admin_reserva", totp_configured: true, registration_status: "complete" });
  rows.ocorrencias.push({ id: id("oc"), status: "aberta", military_id: orphanUser, lending_id: null, material_type_id: null });
  // Esquema: só estas colunas existem (coluna fora da lista = erro, como no PostgREST).
  const columns: Record<string, string[]> = {
    reserves: ["id", "tenant_id", "status"],
    cautelamentos: ["id", "tenant_id", "reserve_id", "status", "data_ultima_conferencia"],
    material_items: ["id", "tenant_id", "reserve_id", "status_operacional", "identificador_principal"],
    lendings: ["id", "tenant_id", "reserve_id", "status", "status_legacy", "issued_at", "material_type_id"],
    ocorrencias: ["id", "status", "military_id", "lending_id", "material_type_id"],
    profiles: ["id", "default_tenant_id", "role", "totp_configured", "registration_status"],
    audit_events: ["id", "tenant_id", "reserve_id", "created_at"],
    service_handovers: ["id", "tenant_id", "reserve_id", "status", "created_at"],
    reserve_memberships: ["id", "reserve_id", "user_id", "role"],
    material_availability: ["id", "nome", "tenant_id", "reserve_id", "quantidade_disponivel"],
    material_types: ["id", "tenant_id", "reserve_id"],
  };
  return Object.fromEntries(Object.keys(rows).map((t) => [t, { columns: columns[t], rows: rows[t] }]));
}

const ORIGINAL_FROM = supabase.from.bind(supabase);
const FAKE_OPTS = { reverseFk: { reserve_memberships: "user_id" } };
let fake = createFakePostgrest(buildTables(), FAKE_OPTS);
before(() => {
  fake = createFakePostgrest(buildTables(), FAKE_OPTS);
  supabase.from = ((t: string) => fake.from(t)) as unknown as typeof supabase.from;
});
after(() => { supabase.from = ORIGINAL_FROM; });

interface Ctx { role: Role; tenantId: string | null; reserveId: string | null; activeMode?: "usuario" }
async function get(path: string, ctx: Ctx) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    c.set("userId", "99999999-0000-0000-0000-000000000001");
    c.set("role", ctx.role);
    c.set("tenantId", ctx.tenantId);
    c.set("reserveId", ctx.reserveId);
    if (ctx.activeMode) c.set("activeMode", ctx.activeMode);
    await next();
  });
  app.route("/api/dashboard", dashboardRoutes);
  const res = await app.request(path);
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : null;
  return { status: res.status, body: body as Record<string, unknown> };
}

// Métricas que dependem de filtro por reserva (cada uma deve valer o total do escopo).
const COMMAND_METRICS = [
  "cautelas_ativas", "cautelas_sem_conferencia_90d", "saidas_ativas", "saidas_com_atraso",
  "usuarios_sem_totp", "movimentacoes_24h", "passagens_em_atraso",
];
// `ocorrencias` tem valor próprio porque a órfã do tenant A só entra em matriz.
function assertCommand(body: Record<string, unknown>, expected: number, ocorrencias = expected) {
  for (const m of COMMAND_METRICS) assert.equal(body[m], expected, `${m} deveria ser ${expected}, veio ${String(body[m])}`);
  assert.equal(body.ocorrencias_abertas, ocorrencias, `ocorrencias_abertas deveria ser ${ocorrencias}, veio ${String(body.ocorrencias_abertas)}`);
}

const ADMIN_RESERVA_A1: Ctx = { role: "admin_reserva", tenantId: T_A, reserveId: R_A1 };
const ADMIN_GLOBAL_MATRIZ_A: Ctx = { role: "admin_global", tenantId: T_A, reserveId: null };

describe("GET /api/dashboard/command — escopo tenant/reserva", () => {
  it("CROSS_RESERVE: admin_reserva de A1 vê só A1 (nem A2 nem B1)", async () => {
    const r = await get("/api/dashboard/command", ADMIN_RESERVA_A1);
    assert.equal(r.status, 200);
    assertCommand(r.body, 1);
    assert.equal(r.body.reserve_id, R_A1);
  });

  it("CLIENT_SUPPLIED_RESERVE: admin_reserva de A1 pedindo ?reserve_id=A2 → 403", async () => {
    const r = await get(`/api/dashboard/command?reserve_id=${R_A2}`, ADMIN_RESERVA_A1);
    assert.equal(r.status, 403);
  });

  it("CLIENT_SUPPLIED_RESERVE + CROSS_TENANT: admin_reserva de A1 pedindo reserva de B → 403", async () => {
    const r = await get(`/api/dashboard/command?reserve_id=${R_B1}`, ADMIN_RESERVA_A1);
    assert.equal(r.status, 403);
  });

  it("CLIENT_SUPPLIED_TENANT: ?tenant_id= do cliente é ignorado (escopo vem da sessão)", async () => {
    const r = await get(`/api/dashboard/command?tenant_id=${T_B}`, ADMIN_RESERVA_A1);
    assert.equal(r.status, 200);
    assertCommand(r.body, 1);
  });

  it("CROSS_TENANT: admin_global em matriz de A vê A1+A2 e nada de B", async () => {
    const r = await get("/api/dashboard/command", ADMIN_GLOBAL_MATRIZ_A);
    assert.equal(r.status, 200);
    assertCommand(r.body, 3, 4); // 3 ocorrências de reserva + 1 órfã do tenant A
    assert.equal(r.body.reserve_id, null);
  });

  it("admin_global em matriz filtrando ?reserve_id=A2 recebe só A2", async () => {
    const r = await get(`/api/dashboard/command?reserve_id=${R_A2}`, ADMIN_GLOBAL_MATRIZ_A);
    assert.equal(r.status, 200);
    assertCommand(r.body, 2); // inclui a ocorrência com lending de A2 e material_type de A1
    assert.equal(r.body.reserve_id, R_A2);
  });

  it("CLIENT_SUPPLIED_RESERVE + CROSS_TENANT: admin_global de A pedindo reserva de B → 403", async () => {
    const r = await get(`/api/dashboard/command?reserve_id=${R_B1}`, ADMIN_GLOBAL_MATRIZ_A);
    assert.equal(r.status, 403);
  });

  it("admin_global em modo filial (reserva ativa A1) fica confinado a A1", async () => {
    const r = await get("/api/dashboard/command", { role: "admin_global", tenantId: T_A, reserveId: R_A1 });
    assert.equal(r.status, 200);
    assertCommand(r.body, 1);
  });

  it("MISSING_SCOPE: sessão sem tenant → 403 (nunca agregado vazio/global)", async () => {
    const r = await get("/api/dashboard/command", { role: "admin_global", tenantId: null, reserveId: null });
    assert.equal(r.status, 403);
  });

  it("?reserve_id= vazio é tratado como sem seleção (não 403)", async () => {
    const r = await get("/api/dashboard/command?reserve_id=", ADMIN_RESERVA_A1);
    assert.equal(r.status, 200);
    assertCommand(r.body, 1);
  });

  it("MISSING_SCOPE: admin_reserva sem reserva ativa → 403 (nunca tenant inteiro)", async () => {
    const r = await get("/api/dashboard/command", { role: "admin_reserva", tenantId: T_A, reserveId: null });
    assert.equal(r.status, 403);
  });

  it("MODE_USER_PRIVILEGE: admin em Modo Usuário (papel efetivo usuario) → 403", async () => {
    const r = await get("/api/dashboard/command", { role: "usuario", tenantId: T_A, reserveId: R_A1, activeMode: "usuario" });
    assert.equal(r.status, 403);
  });
});

describe("GET /api/dashboard/stats — escopo tenant/reserva", () => {
  const ARMEIRO_A1: Ctx = { role: "armeiro", tenantId: T_A, reserveId: R_A1 };

  it("CROSS_TENANT + CROSS_RESERVE: armeiro de A1 vê só A1", async () => {
    const r = await get("/api/dashboard/stats", ARMEIRO_A1);
    assert.equal(r.status, 200);
    assert.equal(r.body.total_armados, 1);
    assert.equal(r.body.cadastros_pendentes, 1);
    assert.equal(r.body.total_militares, 1);
    const mats = r.body.materiais as Row[];
    assert.equal(mats.length, 1);
    assert.ok(mats.every((m) => m.reserve_id === R_A1 && m.tenant_id === T_A));
  });

  it("CLIENT_SUPPLIED_SCOPE: ?tenant_id / ?reserve_id do cliente não ampliam o escopo", async () => {
    const r = await get(`/api/dashboard/stats?tenant_id=${T_B}&reserve_id=${R_B1}`, ARMEIRO_A1);
    assert.equal(r.status, 200);
    assert.equal(r.body.total_armados, 1);
    assert.ok((r.body.materiais as Row[]).every((m) => m.reserve_id === R_A1));
  });

  it("CROSS_TENANT: admin_global em matriz de A vê A1+A2 e nada de B", async () => {
    const r = await get("/api/dashboard/stats", ADMIN_GLOBAL_MATRIZ_A);
    assert.equal(r.status, 200);
    assert.equal(r.body.total_armados, 3);
    assert.equal(r.body.total_militares, 3);
    assert.ok((r.body.materiais as Row[]).every((m) => m.tenant_id === T_A));
    assert.equal((r.body.materiais as Row[]).length, 3);
  });

  it("MISSING_SCOPE: sessão sem tenant → 403", async () => {
    const r = await get("/api/dashboard/stats", { role: "armeiro", tenantId: null, reserveId: null });
    assert.equal(r.status, 403);
  });

  it("MISSING_SCOPE: armeiro sem reserva ativa → 403", async () => {
    const r = await get("/api/dashboard/stats", { role: "armeiro", tenantId: T_A, reserveId: null });
    assert.equal(r.status, 403);
  });

  it("MODE_USER_PRIVILEGE: armeiro em Modo Usuário → 403", async () => {
    const r = await get("/api/dashboard/stats", { role: "usuario", tenantId: T_A, reserveId: R_A1, activeMode: "usuario" });
    assert.equal(r.status, 403);
  });
});

describe("Invariante: toda query com tenant/reserva sai filtrada", () => {
  const RESERVE_TABLES = ["cautelamentos", "material_items", "lendings", "audit_events", "service_handovers", "material_availability"];
  for (const path of ["/api/dashboard/command", "/api/dashboard/stats"]) {
    it(`${path} (admin_reserva A1): tenant e reserva em TODAS as queries`, async () => {
      const start = fake.calls.length;
      const r = await get(path, ADMIN_RESERVA_A1);
      assert.equal(r.status, 200);
      const calls = fake.calls.slice(start);
      const reserveCalls = calls.filter((q) => RESERVE_TABLES.includes(q.table));
      assert.ok(reserveCalls.length > 0);
      for (const q of reserveCalls) {
        assert.ok(q.filters.includes(`tenant_id=eq.${T_A}`), `${q.table} sem filtro de tenant: ${q.filters.join(" ")}`);
        assert.ok(q.filters.includes(`reserve_id=in.(${R_A1})`), `${q.table} sem filtro de reserva: ${q.filters.join(" ")}`);
      }
      for (const q of calls.filter((x) => x.table === "profiles")) {
        assert.ok(q.filters.includes(`default_tenant_id=eq.${T_A}`), `profiles sem tenant: ${q.filters.join(" ")}`);
        assert.ok(q.select.includes("reserve_memberships!inner") && q.filters.includes(`reserve_memberships.reserve_id=in.(${R_A1})`),
          `profiles sem filtro de reserva: ${q.select} ${q.filters.join(" ")}`);
      }
      for (const q of calls.filter((x) => x.table === "ocorrencias")) {
        assert.ok(q.filters.includes(`military.default_tenant_id=eq.${T_A}`), `ocorrencias sem tenant: ${q.filters.join(" ")}`);
        assert.ok(q.filters.includes(`lending.reserve_id=in.(${R_A1})`) || q.filters.includes(`material_type.reserve_id=in.(${R_A1})`),
          `ocorrencias sem reserva: ${q.filters.join(" ")}`);
      }
      const known = new Set([...RESERVE_TABLES, "profiles", "ocorrencias", "reserves"]);
      const unknown = calls.filter((q) => !known.has(q.table));
      assert.deepEqual(unknown.map((q) => q.table), [], "query em tabela não coberta pela invariante");
    });
  }
});
