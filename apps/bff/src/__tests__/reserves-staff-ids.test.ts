import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 review achado A3 — GET /api/reserves/:id/staff-ids: usa service_role
// pra devolver os STAFF de uma reserva, contornando a RLS de
// reserve_memberships_select que não cobre admin_global (a exclusão do
// autocomplete de promoção virava no-op silencioso pra ele via query direta
// no client RLS-bound do web).
const src = readFileSync(resolve(process.cwd(), "src", "routes", "reserves.ts"), "utf8").replace(/\r\n/g, "\n");
const handler = src.slice(src.indexOf('"/:id/staff-ids"'), src.indexOf('"/:id/staff-ids"') + 1500);

describe("GET /api/reserves/:id/staff-ids (SP2 review)", () => {
  it("exige role staff/admin pra chamar", () => {
    assert.ok(handler.includes('roleGuard("admin_global", "admin_reserva", "armeiro", "auditor")'));
  });

  it("escopa a reserva pelo tenant do caller", () => {
    assert.ok(handler.includes('.eq("tenant_id", tenantId)'));
  });

  it("filtra por STAFF_RESERVE_ROLES — nunca devolve usuario", () => {
    assert.ok(handler.includes('.in("role", STAFF_RESERVE_ROLES)'));
  });

  it("loga falha da query", () => {
    assert.ok(handler.includes('"reserves.staff_ids.failure"'));
  });
});
