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
  // M8 (achado do review): MATRIX_ROLES virou SSOT em lib/reserve-staff.ts —
  // era duplicado aqui e em lib/active-reserve.ts.
  it("importa MATRIX_ROLES de lib/reserve-staff (SSOT, achado M8)", () => {
    assert.ok(src.includes('import { STAFF_RESERVE_ROLES, MATRIX_ROLES } from "../lib/reserve-staff"'));
    assert.ok(!src.includes('const MATRIX_ROLES = new Set('), "não duplica a definição localmente");
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

  // M3 (achado do review): role-change corrigia só active_reserve_id — as
  // linhas de STAFF em reserve_memberships ficavam presas ao papel antigo.
  describe("M3 — reconcilia reserve_memberships no role-change", () => {
    const block = src.slice(src.indexOf("if (roleIsChanging) {\n        const newRole = body.role!;"));

    it("papel de matriz: remove TODAS as memberships do alvo", () => {
      assert.ok(block.slice(0, 600).includes('.from("reserve_memberships").delete().eq("user_id", targetId)'));
      assert.ok(block.includes('"profiles.role_change.memberships_wipe_failure"'));
    });

    it("novo papel 'usuario': rebaixa memberships de STAFF pra 'usuario' (não deleta o vínculo)", () => {
      assert.ok(block.includes('.from("reserve_memberships").update({ role: "usuario" })'));
      assert.ok(block.includes('.in("role", STAFF_RESERVE_ROLES)'));
      assert.ok(block.includes('"profiles.role_change.memberships_downgrade_failure"'));
    });

    it("best-effort: não retorna erro HTTP se a reconciliação falhar (role-change já foi commitado)", () => {
      const wipeIdx = block.indexOf("memberships_wipe_failure");
      const nearby = block.slice(Math.max(0, wipeIdx - 200), wipeIdx + 50);
      assert.ok(!nearby.includes("return c.json"), "só loga, não aborta a resposta");
    });
  });
});
