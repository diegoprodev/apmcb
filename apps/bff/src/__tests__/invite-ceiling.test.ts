import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canInvite, allowedRoles } from "../lib/invite-ceiling.ts";

// Teto de privilégio canônico (spec do usuário):
//   armeiro       → só usuario (efetivo)
//   admin_reserva → armeiro, usuario (+auditor, decisão de produto)
//   admin_global  → qualquer nível RBAC do sistema (NÃO superadmin)
//   superadmin    → não convida no fluxo de reserva (roleGuard já exclui)
describe("canInvite — teto de privilégio", () => {
  it("armeiro só pode usuario", () => {
    assert.equal(canInvite("armeiro", "usuario"), true);
    assert.equal(canInvite("armeiro", "armeiro"), false);
    assert.equal(canInvite("armeiro", "admin_reserva"), false);
    assert.equal(canInvite("armeiro", "admin_global"), false);
  });

  it("admin_reserva pode armeiro e usuario, não admin_reserva/admin_global", () => {
    assert.equal(canInvite("admin_reserva", "armeiro"), true);
    assert.equal(canInvite("admin_reserva", "usuario"), true);
    assert.equal(canInvite("admin_reserva", "admin_reserva"), false);
    assert.equal(canInvite("admin_reserva", "admin_global"), false);
  });

  it("admin_global pode qualquer papel do sistema, menos superadmin", () => {
    for (const r of ["admin_global", "admin_reserva", "armeiro", "usuario", "auditor"]) {
      assert.equal(canInvite("admin_global", r), true, r);
    }
    assert.equal(canInvite("admin_global", "superadmin"), false);
  });

  it("role desconhecido / vazio nunca pode", () => {
    assert.equal(canInvite("", "usuario"), false);
    assert.equal(canInvite("qualquer", "usuario"), false);
    assert.deepEqual(allowedRoles("qualquer"), []);
  });
});
