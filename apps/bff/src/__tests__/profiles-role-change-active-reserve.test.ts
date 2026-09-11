import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// SP2 Task 7 — PATCH /api/profiles/:id: se o role-change leva o alvo pra um
// papel de matriz (admin_global/auditor/superadmin), o active_reserve_id que
// ele tinha (de quando era armeiro/admin_reserva) fica inválido e precisa ser
// nulado NO MESMO UPDATE — o trigger profiles_validate_active_reserve só
// dispara em UPDATE OF active_reserve_id, não em UPDATE OF role.
const src = readFileSync(resolve(process.cwd(), "src", "routes", "profiles.ts"), "utf8").replace(/\r\n/g, "\n");

describe("PATCH /api/profiles/:id — role-change nula active_reserve_id (SP2)", () => {
  it("define MATRIX_ROLES com os 3 papéis de matriz", () => {
    assert.ok(src.includes('const MATRIX_ROLES = new Set(["admin_global", "auditor", "superadmin"])'));
  });

  it("seta active_reserve_id: null no updatePayload quando o novo papel é de matriz", () => {
    assert.ok(src.includes("if (roleIsChanging && MATRIX_ROLES.has(body.role!)) {"));
    assert.ok(src.includes("updatePayload.active_reserve_id = null;"));
  });

  it("loga o evento quando o clear acontece", () => {
    assert.ok(src.includes('"profiles.role_change.active_reserve_cleared"'));
  });

  it("o clear roda no MESMO UPDATE de profiles (updatePayload), não uma query separada", () => {
    const setLine = src.indexOf("if (roleIsChanging && MATRIX_ROLES.has(body.role!)) {");
    const updateCall = src.indexOf(".update(updatePayload)");
    assert.ok(setLine > 0 && updateCall > setLine, "o updatePayload é montado ANTES do .update(updatePayload)");
  });
});
