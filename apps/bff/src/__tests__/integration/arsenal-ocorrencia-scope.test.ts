import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { createFakePostgrest, type Row } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-48 (docs/auditoria/EVIDENCE_R48.md): PATCH /api/arsenal/items/:id/ocorrencia
// carregava o item só por id+tenant_id e atualizava só por id+status: armeiro ou
// admin_reserva da reserva A (com turno ativo) alterava item da reserva B do mesmo
// tenant, só conhecendo o UUID (sem depender de GET /items/disponiveis, R-46).
// Handler REAL; contexto de sessão (papel EFETIVO, tenant, reserva ativa) injetado
// como o authMiddleware entrega. Modo Usuário/Bearer: mode-user-auth-paths
// (/api/arsenal/* está atrás do mesmo authMiddleware).

const { arsenalRoutes } = await import("../../routes/arsenal.ts");

const T_A = "c1a00000-0000-0000-0000-00000000000a";
const T_B = "c1b00000-0000-0000-0000-00000000000b";
const R_A = "c1a10000-0000-0000-0000-0000000000a1";
const R_B = "c1a20000-0000-0000-0000-0000000000a2";
const R_TB = "c1b10000-0000-0000-0000-0000000000b1";
const ARM = "c1000000-0000-0000-0000-0000000000a0";       // armeiro, turno ativo em A
const ARM_NOSHIFT = "c1000000-0000-0000-0000-0000000000a1";
const ADM_R = "c1000000-0000-0000-0000-0000000000a2";
const ADM_G = "c1000000-0000-0000-0000-0000000000a3";

const mkItems = (): Row[] => [
  { id: "ia", tenant_id: T_A, reserve_id: R_A, current_unit_id: R_A, status_operacional: "disponivel", identificador_principal: "SN-IA", descricao_adicional: null },
  { id: "ib", tenant_id: T_A, reserve_id: R_B, current_unit_id: R_B, status_operacional: "disponivel", identificador_principal: "SN-IB", descricao_adicional: null },
  { id: "itb", tenant_id: T_B, reserve_id: R_TB, current_unit_id: R_TB, status_operacional: "disponivel", identificador_principal: "SN-ITB", descricao_adicional: null },
  { id: "ia-cautelado", tenant_id: T_A, reserve_id: R_A, current_unit_id: R_A, status_operacional: "cautelado", identificador_principal: "SN-IAC", descricao_adicional: null },
];
const ICOLS = ["id", "tenant_id", "reserve_id", "current_unit_id", "status_operacional", "identificador_principal", "descricao_adicional", "ocorrencia_foto_url", "ocorrencia_usuario_associado_id", "ocorrencia_registrada_por", "ocorrencia_registrada_em", "last_movement_at"];
const tables = {
  material_items: { columns: ICOLS, rows: mkItems() },
  service_shifts: { columns: ["id", "armeiro_id", "status", "reserve_id"], rows: [
    { id: "s1", armeiro_id: ARM, status: "ativo", reserve_id: R_A },
  ] as Row[] },
  profiles: { columns: ["id", "default_tenant_id"], rows: [] as Row[] },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_RPC = supabase.rpc.bind(supabase);
let fake: ReturnType<typeof createFakePostgrest>;
let rpcCalls = 0;
let beforeUpdate: (() => void) | null = null; // simula mudança concorrente entre a leitura e o UPDATE
let failOn: { table: string; op: "select" | "update" } | null = null;
let missingColumnOnce = false; // 1º UPDATE falha como coluna ausente (PGRST204) para exercitar o fallback
let updateCalls = 0;
before(() => {
  fake = createFakePostgrest(tables);
  supabase.from = ((t: string) => {
    const b = fake.from(t) as Record<string, unknown>;
    const failing = (): unknown => new Proxy({}, { get: (_t, k) => k === "then"
      ? (res: (x: unknown) => void) => res({ data: null, error: { code: "XX000", message: `relation secret_${t} exploded` } })
      : () => failing() });
    if (failOn?.table === t && failOn.op === "select") return failing();
    if (t === "material_items") {
      const upd = b.update as (v: Row) => unknown;
      b.update = (v: Row) => {
        updateCalls++;
        if (missingColumnOnce && updateCalls === 1) {
          const missing: unknown = new Proxy({}, { get: (_t, k) => k === "then"
            ? (res: (x: unknown) => void) => res({ data: null, error: { code: "PGRST204", message: "Could not find the 'ocorrencia_foto_url' column of 'material_items' in the schema cache" } })
            : () => missing });
          return missing;
        }
        beforeUpdate?.();
        if (failOn?.table === t && failOn.op === "update") return failing();
        return upd(v);
      };
    }
    return b;
  }) as unknown as typeof supabase.from;
  supabase.rpc = ((..._a: unknown[]) => { rpcCalls++; return Promise.resolve({ data: null, error: null }); }) as unknown as typeof supabase.rpc;
});
after(() => { supabase.from = ORIGINAL_FROM; supabase.rpc = ORIGINAL_RPC; });
beforeEach(() => {
  tables.material_items.rows.splice(0, tables.material_items.rows.length, ...mkItems());
  fake.calls.length = 0; rpcCalls = 0; beforeUpdate = null; failOn = null; missingColumnOnce = false; updateCalls = 0;
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
  app.route("/api/arsenal", arsenalRoutes);
  return app;
}
async function patch(ctx: Ctx, id: string) {
  const r = await appFor(ctx).request(`/api/arsenal/items/${id}/ocorrencia`, {
    method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ novo_status: "avariado", motivo: "cano empenado na conferência" }),
  });
  const text = await r.text();
  return { status: r.status, text, body: (r.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null) as Record<string, unknown> | null };
}
const item = (id: string) => tables.material_items.rows.find((r) => r.id === id)!;
const writes = () => fake.calls.filter((c) => c.select === "insert" || c.select === "update").length;
const noEffects = () => { assert.equal(writes(), 0, "nenhum INSERT/UPDATE (item, auditoria, notificação)"); assert.equal(rpcCalls, 0, "nenhuma RPC (evento de turno)"); };

const ARM_A: Ctx = { userId: ARM, role: "armeiro", tenantId: T_A, reserveId: R_A };
const ADM_R_A: Ctx = { userId: ADM_R, role: "admin_reserva", tenantId: T_A, reserveId: R_A };

describe("R-48 — PATCH /api/arsenal/items/:id/ocorrencia: escrita confinada ao escopo da sessão", () => {
  it("A. armeiro A → item de A: ocorrência legítima gravada (e auditoria/turno disparados)", async () => {
    const r = await patch(ARM_A, "ia");
    assert.equal(r.status, 200, r.text);
    assert.equal(item("ia").status_operacional, "avariado");
    assert.ok(rpcCalls >= 1, "evento de turno legítimo preservado");
  });

  it("R48. armeiro A, turno ativo, UUID direto do item da reserva B: negado, item B intacto e nenhum efeito", async () => {
    const r = await patch(ARM_A, "ib");
    assert.equal(r.status, 404, r.text);
    assert.equal(item("ib").status_operacional, "disponivel");
    noEffects();
  });

  it("R48. admin_reserva A → item de B: negado e intacto; → item de A: permitido", async () => {
    assert.equal((await patch(ADM_R_A, "ib")).status, 404);
    assert.equal(item("ib").status_operacional, "disponivel");
    noEffects();
    assert.equal((await patch(ADM_R_A, "ia")).status, 200);
  });

  it("a reserva ATIVA da sessão é a autoridade (memberships em A e B não alargam): sessão em A → só A; sessão trocada para B → só B", async () => {
    assert.equal((await patch({ ...ARM_A, reserveId: R_A }, "ib")).status, 404);
    assert.equal((await patch({ ...ARM_A, reserveId: R_B }, "ia")).status, 404);
    noEffects();
    assert.equal((await patch({ ...ARM_A, reserveId: R_B }, "ib")).status, 200); // o gate de turno atual não é alterado (R-50)
  });

  it("fallback de coluna ausente (PGRST204): o 2º UPDATE também é confinado — item muda de reserva antes dele → 409, intacto", async () => {
    missingColumnOnce = true;
    beforeUpdate = () => { item("ia").reserve_id = R_B; };
    const r = await patch(ARM_A, "ia");
    assert.equal(r.status, 409, r.text);
    assert.equal(item("ia").status_operacional, "disponivel");
    assert.equal(updateCalls, 2);
  });

  it("fallback de coluna ausente, caminho feliz: grava com o confinamento e responde 200", async () => {
    missingColumnOnce = true;
    assert.equal((await patch(ARM_A, "ia")).status, 200);
    assert.equal(item("ia").status_operacional, "avariado");
  });

  it("T. cross-tenant: sessão do tenant A → item do tenant B: 404 e intacto (já protegido, regressão)", async () => {
    const r = await patch(ADM_R_A, "itb");
    assert.equal(r.status, 404);
    assert.equal(item("itb").status_operacional, "disponivel");
    noEffects();
  });

  it("admin_global (matriz e filial): escrita tenant-wide preservada (convenção de escrita do BFF); nunca o tenant B", async () => {
    assert.equal((await patch({ userId: ADM_G, role: "admin_global", tenantId: T_A, reserveId: null }, "ib")).status, 200);
    tables.material_items.rows.splice(0, tables.material_items.rows.length, ...mkItems());
    assert.equal((await patch({ userId: ADM_G, role: "admin_global", tenantId: T_A, reserveId: R_A }, "ib")).status, 200);
    assert.equal((await patch({ userId: ADM_G, role: "admin_global", tenantId: T_A, reserveId: null }, "itb")).status, 404);
    assert.equal(item("itb").status_operacional, "disponivel");
  });

  it("não-admin_global sem reserva ativa: negado (fail-closed), sem efeito", async () => {
    assert.equal((await patch({ ...ADM_R_A, reserveId: null }, "ia")).status, 404);
    noEffects();
  });

  it("B/C. papel efetivo usuario (Modo Usuário ou militar comum): 403 e intacto", async () => {
    const r = await patch({ ...ARM_A, role: "usuario" }, "ia");
    assert.equal(r.status, 403);
    assert.equal(item("ia").status_operacional, "disponivel");
    noEffects();
  });

  it("turno continua obrigatório: armeiro sem turno ativo → 403 SHIFT_REQUIRED, sem efeito", async () => {
    const r = await patch({ ...ARM_A, userId: ARM_NOSHIFT }, "ia");
    assert.equal(r.status, 403);
    assert.equal((r.body as { error?: string }).error, "SHIFT_REQUIRED");
    noEffects();
  });

  it("item inexistente: 404 (nunca sucesso)", async () => {
    assert.equal((await patch(ARM_A, "00000000-0000-0000-0000-000000000000")).status, 404);
    noEffects();
  });

  it("sem tenant na sessão: 400, sem efeito", async () => {
    assert.equal((await patch({ ...ARM_A, tenantId: null }, "ia")).status, 400);
    noEffects();
  });

  it("status de origem não permitido (cautelado): 409, intacto (regra de domínio preservada)", async () => {
    assert.equal((await patch(ARM_A, "ia-cautelado")).status, 409);
    assert.equal(item("ia-cautelado").status_operacional, "cautelado");
  });

  it("TOCTOU: o item muda de reserva entre a leitura e o UPDATE → UPDATE confinado afeta 0 linhas: 409, item NÃO alterado (antes: gravava)", async () => {
    beforeUpdate = () => { item("ia").reserve_id = R_B; };
    const r = await patch(ARM_A, "ia");
    assert.equal(r.status, 409, r.text);
    assert.equal(item("ia").status_operacional, "disponivel");
  });

  it("TOCTOU (admin_global, sem filtro de reserva): o item muda de TENANT entre a leitura e o UPDATE → 409, item não alterado", async () => {
    beforeUpdate = () => { item("ia").tenant_id = T_B; };
    const r = await patch({ userId: ADM_G, role: "admin_global", tenantId: T_A, reserveId: null }, "ia");
    assert.equal(r.status, 409, r.text);
    assert.equal(item("ia").status_operacional, "disponivel");
  });

  it("concorrência de status: o status muda entre a leitura e o UPDATE → 409, sem sobrescrever", async () => {
    beforeUpdate = () => { item("ia").status_operacional = "bloqueado"; };
    const r = await patch(ARM_A, "ia");
    assert.equal(r.status, 409);
    assert.equal(item("ia").status_operacional, "bloqueado");
  });

  it("zero linhas (item sumiu antes do UPDATE): não reporta sucesso", async () => {
    beforeUpdate = () => { tables.material_items.rows.splice(tables.material_items.rows.findIndex((x) => x.id === "ia"), 1); };
    assert.notEqual((await patch(ARM_A, "ia")).status, 200);
  });

  it("erro de banco no UPDATE: 500 genérico sem vazar; erro no SELECT do item: 500 (não vira 404)", async () => {
    failOn = { table: "material_items", op: "update" };
    const u = await patch(ARM_A, "ia");
    assert.equal(u.status, 500);
    assert.ok(!u.text.includes("secret_"));
    failOn = { table: "material_items", op: "select" };
    const s = await patch(ARM_A, "ia");
    assert.equal(s.status, 500);
    assert.ok(!s.text.includes("secret_"));
  });

  it("guarda estática: o UPDATE final (principal e fallback) leva id + tenant + reserva (fora do admin_global) + status; logFailure no erro", () => {
    const src = readFileSync(new URL("../../routes/arsenal.ts", import.meta.url), "utf8");
    const chunk = src.slice(src.indexOf('"/items/:id/ocorrencia"'), src.indexOf("// ─── POST /api/arsenal/material-photo"));
    assert.equal(chunk.split("confineUpdate(supabase").length - 1, 2, "UPDATE principal e fallback passam pelo confinamento");
    assert.match(chunk, /out = q\.eq\("tenant_id", tenantId\);[\s\S]*out = out\.eq\("reserve_id", writeReserveScope\)/);
    assert.ok(chunk.includes('.eq("tenant_id", tenantId)\n      .maybeSingle()'), "lookup com tenant");
    assert.equal(chunk.split('.eq("status_operacional", item.status_operacional))').length - 1, 2, "os dois UPDATEs condicionam o status de origem (o fallback não é coberto dinamicamente: o fake não emite 42703/PGRST204)");
    assert.ok(chunk.includes('"arsenal.ocorrencia.update_failure"') && chunk.includes('"arsenal.ocorrencia.lookup_failure"'));
    assert.ok(!/c\.get\("log"\)\.error\(\{ code: updErr/.test(chunk), "erro operacional via logFailure");
  });
});
