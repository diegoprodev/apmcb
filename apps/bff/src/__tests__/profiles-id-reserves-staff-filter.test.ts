import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 Task 6 (audit C2) — GET /api/profiles/:id/reserves alimenta o dialog de
// edição (pré-marca "onde a pessoa já é armeiro/admin_reserva"). Sem filtrar
// por role, a linha 'usuario' do militar comum (SP2 Task 3/4) marcaria
// reservas onde ele é só efetivo, não staff.
const src = readFileSync(resolve(process.cwd(), "src", "routes", "profiles.ts"), "utf8").replace(/\r\n/g, "\n");

const handler = src.slice(src.indexOf('"/:id/reserves"'), src.indexOf('"/:id/reserves"') + 2000);

describe("GET /api/profiles/:id/reserves — filtro de staff (SP2)", () => {
  it("filtra reserve_memberships por STAFF_RESERVE_ROLES", () => {
    assert.ok(handler.includes('.in("role", STAFF_RESERVE_ROLES)'), "deve filtrar por role staff");
  });
  it("importa STAFF_RESERVE_ROLES de lib/reserve-staff", () => {
    assert.ok(src.includes('import { STAFF_RESERVE_ROLES } from "../lib/reserve-staff"'));
  });
});
