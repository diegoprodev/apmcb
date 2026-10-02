import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-42 / R-43 (docs/auditoria/EVIDENCE_R42_R43.md): handlers /:id de handovers.
// R-42: `if (tenantId && …)` pulava a checagem com tenant ausente na sessão.
// R-43: A) só tenant, sem reserva; B) entrando_id sem validação; C) UPDATE sem
// condição de status; D) resultado do UPDATE ignorado. Handler REAL; contexto de
// sessão (papel efetivo, tenant, reserva ativa) injetado como o authMiddleware
// entrega; Modo Usuário/Bearer são cobertos por mode-user-auth-paths
// (/api/handovers/* está atrás do mesmo authMiddleware).

const { handoversRoutes } = await import("../../routes/handovers.ts");

const T_A = "81a00000-0000-0000-0000-00000000000a";
const T_B = "81b00000-0000-0000-0000-00000000000b";
const R_A1 = "81a10000-0000-0000-0000-0000000000a1";
const R_A2 = "81a20000-0000-0000-0000-0000000000a2";
const R_B1 = "81b10000-0000-0000-0000-0000000000b1";
const ADMIN_A1 = "81000000-0000-0000-0000-0000000000a1"; // admin_reserva ativo em A1
const ADMIN_G = "81000000-0000-0000-0000-0000000000a0"; // admin_global do tenant A
const SAIDA = "81000000-0000-0000-0000-0000000000a5";   // armeiro saindo (membership A1)
const ENTRA_OK = "81000000-0000-0000-0000-0000000000a6"; // armeiro, tenant A, membership A1
const ENTRA_NO_MEMBER = "81000000-0000-0000-0000-0000000000a7"; // armeiro tenant A sem membership em A1
const ENTRA_TENANT_B = "81000000-0000-0000-0000-0000000000b6"; // armeiro do tenant B
const ENTRA_USUARIO = "81000000-0000-0000-0000-0000000000a8"; // role usuario
const ENTRA_GLOBAL = "81000000-0000-0000-0000-0000000000a9"; // admin_global do tenant A
const ENTRA_USER_WITH_STAFF_MEMBERSHIP = "81000000-0000-0000-0000-0000000000aa"; // role usuario, mas com membership armeiro em A1
const GHOST = "81000000-0000-0000-0000-0000000000ff";

const mkRows = (): Row[] => [
  { id: "h-a1", tenant_id: T_A, reserve_id: R_A1, status: "aguardando_atribuicao", saindo_id: SAIDA, entrando_id: null, saindo_signature_id: null, entrada_signature_id: null, document_hash: "h1", observacao_saindo: null },
  { id: "h-a2", tenant_id: T_A, reserve_id: R_A2, status: "aguardando_atribuicao", saindo_id: SAIDA, entrando_id: null, saindo_signature_id: null, entrada_signature_id: null, document_hash: "h2", observacao_saindo: null },
  { id: "h-b1", tenant_id: T_B, reserve_id: R_B1, status: "aguardando_atribuicao", saindo_id: SAIDA, entrando_id: null, saindo_signature_id: null, entrada_signature_id: null, document_hash: "h3", observacao_saindo: null },
  { id: "h-a1-sign", tenant_id: T_A, reserve_id: R_A1, status: "aguardando_assinatura_entrada", saindo_id: SAIDA, entrando_id: ENTRA_OK, saindo_signature_id: "s", entrada_signature_id: null, document_hash: "h4", observacao_saindo: null },
  { id: "h-a2-sign", tenant_id: T_A, reserve_id: R_A2, status: "aguardando_assinatura_entrada", saindo_id: SAIDA, entrando_id: ENTRA_OK, saindo_signature_id: "s", entrada_signature_id: null, document_hash: "h5", observacao_saindo: null },
];
const HCOLS = ["id", "tenant_id", "reserve_id", "status", "saindo_id", "entrando_id", "saindo_signature_id", "entrada_signature_id", "document_hash", "observacao_saindo", "prazo_assumcao", "divergencia_descricao", "report_snapshot", "created_at", "updated_at", "observacao_entrada", "pdf_storage_path"];
const tables = {
  service_handovers: { columns: HCOLS, rows: mkRows() },
  profiles: {
    columns: ["id", "default_tenant_id", "role", "nome_completo", "matricula"],
    rows: [
      { id: SAIDA, default_tenant_id: T_A, role: "armeiro" },
      { id: ENTRA_OK, default_tenant_id: T_A, role: "armeiro" },
      { id: ENTRA_NO_MEMBER, default_tenant_id: T_A, role: "armeiro" },
      { id: ENTRA_TENANT_B, default_tenant_id: T_B, role: "armeiro" },
      { id: ENTRA_USUARIO, default_tenant_id: T_A, role: "usuario" },
      { id: ENTRA_GLOBAL, default_tenant_id: T_A, role: "admin_global" },
      { id: ENTRA_USER_WITH_STAFF_MEMBERSHIP, default_tenant_id: T_A, role: "usuario" },
    ] as Row[],
  },
  reserves: { columns: ["id", "nome", "acronym", "tenant_id"], rows: [
    { id: R_A1, nome: "A1", acronym: "A1", tenant_id: T_A }, { id: R_A2, nome: "A2", acronym: "A2", tenant_id: T_A }, { id: R_B1, nome: "B1", acronym: "B1", tenant_id: T_B },
  ] as Row[] },
  reserve_memberships: { columns: ["id", "user_id", "reserve_id", "role"], rows: [
    { id: "m1", user_id: SAIDA, reserve_id: R_A1, role: "armeiro" },
    { id: "m2", user_id: ENTRA_OK, reserve_id: R_A1, role: "armeiro" },
    { id: "m3", user_id: ENTRA_TENANT_B, reserve_id: R_A1, role: "armeiro" }, // membership "perdida" cruzando tenant
    { id: "m4", user_id: ENTRA_USUARIO, reserve_id: R_A1, role: "usuario" },
    { id: "m5", user_id: ENTRA_USER_WITH_STAFF_MEMBERSHIP, reserve_id: R_A1, role: "armeiro" },
  ] as Row[] },
  document_signatures: { columns: ["id", "signed_at"], rows: [] as Row[] },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_RPC = supabase.rpc.bind(supabase);
let fake: ReturnType<typeof createFakePostgrest>;
let rpcCalls = 0;
let beforeUpdate: (() => void) | null = null; // simula transição concorrente entre a leitura e o UPDATE
let updateError: { code?: string; message: string } | null = null;
before(() => {
  fake = createFakePostgrest(tables);
  supabase.from = ((t: string) => {
    const b = fake.from(t) as Record<string, unknown>;
    if (t !== "service_handovers") return b;
    const upd = b.update as (v: Row) => unknown;
    b.update = (v: Row) => {
      beforeUpdate?.();
      if (updateError) {
        const failing: unknown = new Proxy({}, { get: (_t, k) => k === "then" ? (res: (x: unknown) => void) => res({ data: null, error: updateError }) : () => failing });
        return failing;
      }
      return upd(v);
    };
    return b;
  }) as unknown as typeof supabase.from;
  supabase.rpc = ((..._a: unknown[]) => { rpcCalls++; return Promise.resolve({ data: null, error: null }); }) as unknown as typeof supabase.rpc;
});
after(() => { supabase.from = ORIGINAL_FROM; supabase.rpc = ORIGINAL_RPC; });
beforeEach(() => {
  tables.service_handovers.rows.splice(0, tables.service_handovers.rows.length, ...mkRows());
  fake.calls.length = 0; rpcCalls = 0; beforeUpdate = null; updateError = null;
});

type Ctx = { userId: string; role: string; tenantId: string | null; reserveId: string | null };
function appFor(ctx: Ctx) {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.use("*", async (c, next) => {
    c.set("userId", ctx.userId); c.set("role", ctx.role as HonoVariables["role"]);
    c.set("tenantId", ctx.tenantId); c.set("reserveId", ctx.reserveId);
    await next();
  });
  app.route("/api/handovers", handoversRoutes);
  return app;
}
async function call(ctx: Ctx, method: string, path: string, body?: unknown) {
  const r = await appFor(ctx).request(`/api/handovers${path}`, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: Record<string, unknown> | null = null;
  try { json = JSON.parse(text); } catch { /* binário (pdf) */ }
  return { status: r.status, text, body: json };
}
const row = (id: string) => tables.service_handovers.rows.find((r) => r.id === id)!;
const writes = () => fake.calls.filter((c) => c.select === "insert" || c.select === "update").length;
const noWrites = () => { assert.equal(writes(), 0, "nenhum INSERT/UPDATE"); assert.equal(rpcCalls, 0, "nenhuma RPC"); };

const ADMIN_R_A1: Ctx = { userId: ADMIN_A1, role: "admin_reserva", tenantId: T_A, reserveId: R_A1 };
const GLOBAL_MATRIZ: Ctx = { userId: ADMIN_G, role: "admin_global", tenantId: T_A, reserveId: null };
const NO_TENANT: Ctx = { userId: ADMIN_A1, role: "admin_reserva", tenantId: null, reserveId: R_A1 };

describe("R-42 — tenant ausente na sessão: fail-closed em todo handler /:id", () => {
  it("T1. GET /:id com tenant nulo: negado, não devolve passagem de outro tenant", async () => {
    const r = await call(NO_TENANT, "GET", "/h-b1");
    assert.equal(r.status, 403, r.text);
    assert.ok(!r.text.includes("h-b1"));
  });
  it("T1. GET /:id/pdf com tenant nulo: negado", async () => {
    assert.equal((await call(NO_TENANT, "GET", "/h-b1/pdf")).status, 403);
  });
  it("T1. assign-entry, report-divergence, sign-exit e sign-entry com tenant nulo: negados, sem escrita nem RPC", async () => {
    assert.equal((await call(NO_TENANT, "POST", "/h-b1/assign-entry", { entrando_id: ENTRA_OK })).status, 403);
    assert.equal((await call({ ...NO_TENANT, role: "armeiro" }, "POST", "/h-b1/report-divergence", { descricao: "descricao longa o bastante" })).status, 403);
    assert.equal((await call({ ...NO_TENANT, userId: SAIDA, role: "armeiro" }, "POST", "/h-b1/sign-exit", { totp_token: "123456" })).status, 403);
    assert.equal((await call({ ...NO_TENANT, userId: ENTRA_OK, role: "armeiro" }, "POST", "/h-b1/sign-entry", { totp_token: "123456" })).status, 403);
    noWrites();
    assert.equal(row("h-b1").status, "aguardando_atribuicao");
  });
  it("T2. tenant diferente (sessão A, passagem de B): 404 em GET e sem escrita nos POST", async () => {
    assert.equal((await call(GLOBAL_MATRIZ, "GET", "/h-b1")).status, 404);
    assert.equal((await call(ADMIN_R_A1, "POST", "/h-b1/assign-entry", { entrando_id: ENTRA_OK })).status, 404);
    noWrites();
  });
});

describe("R-43A — mesmo tenant, outra reserva: escopo de reserva nos handlers /:id", () => {
  it("T3. admin_reserva ativo em A1 não lê passagem de A2 (GET /:id e /pdf): 404", async () => {
    assert.equal((await call(ADMIN_R_A1, "GET", "/h-a2")).status, 404);
    assert.equal((await call(ADMIN_R_A1, "GET", "/h-a2/pdf")).status, 404);
  });
  it("T3. admin_reserva A1 não atribui entrante nem reporta divergência em passagem de A2: 404 sem escrita", async () => {
    assert.equal((await call(ADMIN_R_A1, "POST", "/h-a2/assign-entry", { entrando_id: ENTRA_OK })).status, 404);
    assert.equal((await call(ADMIN_R_A1, "POST", "/h-a2-sign/report-divergence", { descricao: "descricao longa o bastante" })).status, 404);
    noWrites();
  });
  it("T3. admin_global EM filial A1 também fica confinado a A1", async () => {
    const inFilial: Ctx = { ...GLOBAL_MATRIZ, reserveId: R_A1 };
    assert.equal((await call(inFilial, "GET", "/h-a2")).status, 404);
    assert.equal((await call(inFilial, "GET", "/h-a1")).status, 200);
  });
  it("T9. admin_global/matriz (sem reserva ativa): tenant inteiro, preservado", async () => {
    assert.equal((await call(GLOBAL_MATRIZ, "GET", "/h-a2")).status, 200);
    assert.equal((await call(GLOBAL_MATRIZ, "GET", "/h-a1")).status, 200);
    // D-03: admin_global é somente leitura — não atribui entrante.
    assert.equal((await call(GLOBAL_MATRIZ, "POST", "/h-a2/assign-entry", { entrando_id: ENTRA_GLOBAL })).status, 403);
    noWrites();
  });
  it("T10. admin_reserva na reserva da passagem: leitura e atribuição preservadas", async () => {
    assert.equal((await call(ADMIN_R_A1, "GET", "/h-a1")).status, 200);
    const r = await call(ADMIN_R_A1, "POST", "/h-a1/assign-entry", { entrando_id: ENTRA_OK });
    assert.equal(r.status, 200, r.text);
    assert.equal(row("h-a1").entrando_id, ENTRA_OK);
    assert.equal(row("h-a1").status, "aguardando_assinatura_entrada");
  });
  it("armeiro não participante continua negado (regra de participação, inalterada; o fake não resolve embeds, então o caso positivo fica fora)", async () => {
    assert.equal((await call({ userId: ENTRA_NO_MEMBER, role: "armeiro", tenantId: T_A, reserveId: R_A1 }, "GET", "/h-a1")).status, 403);
  });
  it("entrante participante reporta divergência sem depender da reserva ativa (identidade, como o sign-entry)", async () => {
    const r = await call({ userId: ENTRA_OK, role: "armeiro", tenantId: T_A, reserveId: R_A2 }, "POST", "/h-a1-sign/report-divergence", { descricao: "descricao longa o bastante" });
    assert.equal(r.status, 200, r.text);
  });
});

describe("R-43B — entrando_id é input não confiável (validado antes da escrita)", () => {
  const assign = (entrando_id: string) => call(ADMIN_R_A1, "POST", "/h-a1/assign-entry", { entrando_id });
  it("T4. inexistente: negado, sem escrita", async () => { assert.equal((await assign(GHOST)).status, 422); noWrites(); });
  it("T5. perfil de OUTRO tenant (mesmo com membership na reserva): negado, sem escrita", async () => { assert.equal((await assign(ENTRA_TENANT_B)).status, 422); noWrites(); });
  it("T6. staff do tenant SEM membership na reserva da passagem: negado", async () => { assert.equal((await assign(ENTRA_NO_MEMBER)).status, 422); noWrites(); });
  it("perfil sem papel de staff (usuario): negado", async () => { assert.equal((await assign(ENTRA_USUARIO)).status, 422); noWrites(); });
  it("papel do perfil sem staff, mesmo com membership de staff na reserva: negado (elegibilidade pelo papel)", async () => { assert.equal((await assign(ENTRA_USER_WITH_STAFF_MEMBERSHIP)).status, 422); noWrites(); });
  it("o mesmo armeiro que sai continua negado", async () => { assert.equal((await assign(SAIDA)).status, 422); noWrites(); });
  it("válido: armeiro do tenant com membership na reserva; admin_global como entrante é inelegível (D-03)", async () => {
    assert.equal((await assign(ENTRA_OK)).status, 200);
    tables.service_handovers.rows.splice(0, tables.service_handovers.rows.length, ...mkRows());
    assert.equal((await assign(ENTRA_GLOBAL)).status, 422);
    assert.equal(row("h-a1").entrando_id, null);
  });
});

describe("R-43C/D — transição condicionada ao status e resultado do UPDATE verificado", () => {
  it("T7. status inválido: 422 e sem escrita", async () => {
    const r = await call(ADMIN_R_A1, "POST", "/h-a1-sign/assign-entry", { entrando_id: ENTRA_OK });
    assert.equal(r.status, 422); noWrites();
  });
  it("C. transição concorrente entre a leitura e o UPDATE: não sobrescreve, 409 (antes: 200 e status regredido)", async () => {
    beforeUpdate = () => { row("h-a1").status = "concluido"; };
    const r = await call(ADMIN_R_A1, "POST", "/h-a1/assign-entry", { entrando_id: ENTRA_OK });
    assert.equal(r.status, 409, r.text);
    assert.equal(row("h-a1").status, "concluido");
    assert.equal(row("h-a1").entrando_id, null);
  });
  it("C. report-divergence com status mudado no meio: 409, status preservado", async () => {
    beforeUpdate = () => { row("h-a1-sign").status = "concluido"; };
    const r = await call({ ...ADMIN_R_A1 }, "POST", "/h-a1-sign/report-divergence", { descricao: "descricao longa o bastante" });
    assert.equal(r.status, 409, r.text);
    assert.equal(row("h-a1-sign").status, "concluido");
  });
  it("T8/D. UPDATE afeta zero linhas (passagem sumiu): não reporta sucesso", async () => {
    beforeUpdate = () => { tables.service_handovers.rows.splice(tables.service_handovers.rows.findIndex((x) => x.id === "h-a1"), 1); };
    const r = await call(ADMIN_R_A1, "POST", "/h-a1/assign-entry", { entrando_id: ENTRA_OK });
    assert.notEqual(r.status, 200, r.text);
    assert.equal(r.status, 409);
  });
  it("D. erro do UPDATE: 500 genérico, sem vazar o erro do banco", async () => {
    updateError = { code: "XX000", message: "relation secret_table exploded" };
    const r = await call(ADMIN_R_A1, "POST", "/h-a1/assign-entry", { entrando_id: ENTRA_OK });
    assert.equal(r.status, 500);
    assert.ok(!r.text.includes("secret_table"));
  });
  it("guarda estática: todo UPDATE de passagem condiciona status+tenant e confere as linhas afetadas", () => {
    const src = readFileSync(new URL("../../routes/handovers.ts", import.meta.url), "utf8");
    const updates = src.match(/\.from\("service_handovers"\)\s*\.update\(/g) ?? [];
    assert.equal(updates.length, 4, "assign-entry, report-divergence, sign-exit e sign-entry");
    assert.equal((src.match(/\.eq\("tenant_id", tenantId\)\s*\.eq\("status"/g) ?? []).length, 4);
    assert.equal((src.match(/transitionFailure\(c,/g) ?? []).length, 4);
  });
});
