import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isStaffReserveRole, resolveCreationReserveId, STAFF_RESERVE_ROLES } from "../lib/reserve-staff.ts";

describe("isStaffReserveRole", () => {
  it("usuario não é staff", () => {
    assert.equal(isStaffReserveRole("usuario"), false);
  });
  it("armeiro / admin_reserva / auditor_reserva são staff", () => {
    assert.equal(isStaffReserveRole("armeiro"), true);
    assert.equal(isStaffReserveRole("admin_reserva"), true);
    assert.equal(isStaffReserveRole("auditor_reserva"), true);
  });
  it("null / undefined / lixo não é staff", () => {
    assert.equal(isStaffReserveRole(null), false);
    assert.equal(isStaffReserveRole(undefined), false);
    assert.equal(isStaffReserveRole("admin_global"), false);
  });
  it("STAFF_RESERVE_ROLES não inclui usuario", () => {
    assert.equal(STAFF_RESERVE_ROLES.includes("usuario" as never), false);
  });
});

describe("resolveCreationReserveId", () => {
  it("criador com reserva ativa usa ela", () => {
    assert.deepEqual(
      resolveCreationReserveId({ creatorRole: "armeiro", creatorActiveReserveId: "r1", explicitReserveId: null }),
      { reserveId: "r1", needsSelector: false },
    );
  });
  it("admin_global em matriz (ativa NULL) sem seletor → exige seletor", () => {
    assert.deepEqual(
      resolveCreationReserveId({ creatorRole: "admin_global", creatorActiveReserveId: null, explicitReserveId: null }),
      { reserveId: null, needsSelector: true },
    );
  });
  it("explicitReserveId vence a ativa", () => {
    assert.deepEqual(
      resolveCreationReserveId({ creatorRole: "admin_global", creatorActiveReserveId: null, explicitReserveId: "r2" }),
      { reserveId: "r2", needsSelector: false },
    );
  });
  it("armeiro sem reserva ativa e sem seletor → exige seletor (fail-closed)", () => {
    assert.deepEqual(
      resolveCreationReserveId({ creatorRole: "armeiro", creatorActiveReserveId: null, explicitReserveId: null }),
      { reserveId: null, needsSelector: true },
    );
  });
});
