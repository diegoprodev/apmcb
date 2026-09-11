import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 Task 8 (MÉDIO-3, F11) — DELETE /api/admin/reserves/:id:
//  1. status='inativa' ANTES do pre-check (fecha a race de entrada mid-delete)
//  2. pre-check só bloqueia por STAFF_RESERVE_ROLES, não qualquer membership
//     (militar comum role='usuario' não deve travar a exclusão)
//  3. reverte o status se achar staff/materiais (não deixa "meio deletada")
//  4. checa o `error` do DELETE final (antes: 200 mentiroso)
const admin = readFileSync(resolve(process.cwd(), "src", "routes", "admin.ts"), "utf8").replace(/\r\n/g, "\n");

const handler = admin.slice(
  admin.indexOf("DELETE /api/admin/reserves/:id"),
  admin.indexOf("GET /api/admin/branding"),
);

describe("DELETE /api/admin/reserves/:id — MÉDIO-3 (SP2)", () => {
  it("marca status='inativa' antes do pre-check", () => {
    assert.ok(handler.includes('.update({ status: "inativa" })'));
    const setInativa = handler.indexOf('.update({ status: "inativa" })');
    const preCheck = handler.indexOf("material_types");
    assert.ok(setInativa < preCheck, "status inativa roda ANTES do pre-check de materiais/staff");
  });

  it("pre-check de membros filtra por STAFF_RESERVE_ROLES, não conta usuario", () => {
    assert.ok(handler.includes('.in("role", STAFF_RESERVE_ROLES)'));
  });

  it("reverte pro status ativa quando acha staff/materiais (409)", () => {
    assert.ok(handler.includes('.update({ status: "ativa" }).eq("id", id)'));
    assert.ok(handler.includes("409"));
  });

  it("limpa active_reserve_id e reserve_memberships antes do DELETE final", () => {
    assert.ok(handler.includes('.update({ active_reserve_id: null })'));
    assert.ok(handler.includes('.from("reserve_memberships")\n      .delete()'));
  });

  it("checa o error do DELETE final — não é mais um 200 mentiroso", () => {
    const deleteChain = handler.slice(handler.indexOf('supabase.from("reserves").delete()'));
    assert.ok(deleteChain.includes("deleteErr"), "captura o error do delete");
    assert.ok(deleteChain.slice(0, 300).includes("if (deleteErr)"), "checa deleteErr logo em seguida");
  });

  it("loga cada falha com evento nomeado", () => {
    for (const evt of [
      "admin.reserve.delete_status_failure",
      "admin.reserve.delete_revert_failure",
      "admin.reserve.delete_clear_active_failure",
      "admin.reserve.delete_clear_memberships_failure",
      "admin.reserve.delete_failure",
    ]) {
      assert.ok(handler.includes(`"${evt}"`), `deve logar ${evt}`);
    }
  });
});
