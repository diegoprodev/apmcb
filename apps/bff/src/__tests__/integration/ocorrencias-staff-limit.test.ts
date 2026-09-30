import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { supabase } from "../../services/supabase.ts";
import { createFakePostgrest } from "../helpers/fake-postgrest.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-37 lote 1 (code review, ALTO): o staff de uma reserva perdia ocorrências
// da própria reserva quando o tenant tinha mais de 100 ocorrências abertas —
// o filtro de reserva rodava em JS depois do .limit(100) do tenant inteiro.
// Aqui o contexto de sessão já resolvido é injetado direto (a autenticação é
// coberta por ocorrencias-scope-real-handler.test.ts); o foco é o limite.

const { ocorrenciasRoutes } = await import("../../routes/ocorrencias.ts");

const TENANT = "38a00000-0000-0000-0000-00000000000a";
const R_1 = "38a10000-0000-0000-0000-0000000000a1";
const R_2 = "38a20000-0000-0000-0000-0000000000a2";
const MIL = "38000000-0000-0000-0000-0000000000d1";
const L_1 = "38e00000-0000-0000-0000-0000000000a1";
const L_2 = "38e00000-0000-0000-0000-0000000000a2";
const MT_1 = "38f00000-0000-0000-0000-0000000000a1";

// 150 ocorrências recentes da reserva 2 e 3 mais antigas da reserva 1.
const rows = [
  ...Array.from({ length: 150 }, (_, i) => ({
    id: `r2-${String(i).padStart(3, "0")}`, lending_id: L_2, created_at: `2026-09-30T10:${String(i % 60).padStart(2, "0")}:00Z`,
  })),
  ...["r1-a", "r1-b", "r1-c"].map((id) => ({ id, lending_id: L_1, created_at: "2026-01-01T00:00:00Z" })),
].map((r) => ({ ...r, military_id: MIL, material_type_id: null as string | null, status: "aberta" }));
// Precedência: lending na reserva 2 + material_type da reserva 1 → é da reserva 2.
rows.push({ id: "mixed-l2-mt1", lending_id: L_2, material_type_id: MT_1, created_at: "2025-12-31T00:00:00Z", military_id: MIL, status: "aberta" });

const tables = {
  profiles: { columns: ["id", "default_tenant_id"], rows: [{ id: MIL, default_tenant_id: TENANT }] },
  reserves: { columns: ["id", "tenant_id"], rows: [{ id: R_1, tenant_id: TENANT }, { id: R_2, tenant_id: TENANT }] },
  lendings: { columns: ["id", "reserve_id"], rows: [{ id: L_1, reserve_id: R_1 }, { id: L_2, reserve_id: R_2 }] },
  material_types: { columns: ["id", "reserve_id"], rows: [{ id: MT_1, reserve_id: R_1 }] },
  ocorrencias: { columns: ["id", "military_id", "lending_id", "material_type_id", "status", "created_at"], rows },
};
const ORIGINAL_FROM = supabase.from.bind(supabase);
before(() => { const fake = createFakePostgrest(tables); supabase.from = ((t: string) => fake.from(t)) as unknown as typeof supabase.from; });
after(() => { supabase.from = ORIGINAL_FROM; });

function appFor(reserveId: string | null, role = "armeiro") {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", async (c, next) => {
    c.set("userId", "38000000-0000-0000-0000-00000000005a");
    c.set("role", role as HonoVariables["role"]);
    c.set("tenantId", TENANT);
    c.set("reserveId", reserveId);
    await next();
  });
  app.route("/api/ocorrencias", ocorrenciasRoutes);
  return app;
}
async function ids(app: Hono<{ Variables: HonoVariables }>) {
  const r = await app.request("/api/ocorrencias");
  assert.equal(r.status, 200);
  return ((await r.json()) as Array<{ id: string }>).map((o) => o.id).sort();
}

describe("R-37 lote 1 — GET /api/ocorrencias: limite aplicado depois do escopo de reserva", () => {
  it("staff da reserva 1 recebe as 3 ocorrências dela mesmo com 150 mais recentes da reserva 2", async () => {
    assert.deepEqual(await ids(appFor(R_1)), ["r1-a", "r1-b", "r1-c"]);
  });

  it("staff da reserva 2 recebe no máximo 100, todas da reserva 2", async () => {
    const got = await ids(appFor(R_2));
    assert.equal(got.length, 100);
    assert.ok(got.every((id) => id.startsWith("r2-")));
  });

  it("precedência da lending: ocorrência com lending da reserva 2 e material_type da reserva 1 não aparece para a reserva 1", async () => {
    const got = await ids(appFor(R_1));
    assert.ok(!got.includes("mixed-l2-mt1"), "vazou pela consulta via material_type");
    assert.equal(new Set(got).size, got.length, "ids duplicados no merge");
  });
});
