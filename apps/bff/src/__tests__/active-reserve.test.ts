import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDefaultActiveReserve } from "../lib/active-reserve.ts";

const M = (id: string, created: string) => ({ reserve_id: id, created_at: created });

describe("resolveDefaultActiveReserve", () => {
  it("admin_global sem valor salvo → matriz (NULL)", () => {
    const r = resolveDefaultActiveReserve({ role: "admin_global", current: null, memberships: [], preferences: [] });
    assert.deepEqual(r, { active: null, reason: "matriz" });
  });

  it("admin_global com valor salvo → mantém", () => {
    const r = resolveDefaultActiveReserve({ role: "admin_global", current: "res-1", memberships: [], preferences: [] });
    assert.deepEqual(r, { active: "res-1", reason: "kept" });
  });

  it("armeiro com valor salvo AINDA membro → mantém", () => {
    const r = resolveDefaultActiveReserve({
      role: "armeiro", current: "res-1",
      memberships: [M("res-1", "2026-01-01"), M("res-2", "2026-02-01")], preferences: [],
    });
    assert.deepEqual(r, { active: "res-1", reason: "kept" });
  });

  it("armeiro com valor salvo que NÃO é mais membership → cai no fallback (membership mais antiga)", () => {
    const r = resolveDefaultActiveReserve({
      role: "armeiro", current: "res-9",
      memberships: [M("res-2", "2026-02-01"), M("res-1", "2026-01-01")], preferences: [],
    });
    assert.equal(r.active, "res-1");
    assert.equal(r.reason, "oldest_membership");
  });

  it("armeiro sem valor salvo, com preferência → a mais usada (restrita às memberships)", () => {
    const r = resolveDefaultActiveReserve({
      role: "armeiro", current: null,
      memberships: [M("res-1", "2026-01-01"), M("res-2", "2026-02-01")],
      preferences: [
        { reserve_id: "res-2", selection_count: 10, last_selected_at: "2026-03-01" },
        { reserve_id: "res-1", selection_count: 2, last_selected_at: "2026-02-01" },
      ],
    });
    assert.deepEqual(r, { active: "res-2", reason: "preference" });
  });

  it("preferência que não é mais membership é ignorada", () => {
    const r = resolveDefaultActiveReserve({
      role: "armeiro", current: null,
      memberships: [M("res-1", "2026-01-01")],
      preferences: [{ reserve_id: "res-9", selection_count: 99, last_selected_at: "2026-03-01" }],
    });
    assert.deepEqual(r, { active: "res-1", reason: "oldest_membership" });
  });

  it("armeiro sem valor, sem preferência → membership mais antiga", () => {
    const r = resolveDefaultActiveReserve({
      role: "armeiro", current: null,
      memberships: [M("res-2", "2026-02-01"), M("res-1", "2026-01-01")], preferences: [],
    });
    assert.deepEqual(r, { active: "res-1", reason: "oldest_membership" });
  });

  it("armeiro sem membership nenhuma → none (NULL)", () => {
    const r = resolveDefaultActiveReserve({ role: "armeiro", current: null, memberships: [], preferences: [] });
    assert.deepEqual(r, { active: null, reason: "none" });
  });

  it("usuario segue a mesma lógica de armeiro", () => {
    const r = resolveDefaultActiveReserve({
      role: "usuario", current: null,
      memberships: [M("res-1", "2026-01-01")], preferences: [],
    });
    assert.deepEqual(r, { active: "res-1", reason: "oldest_membership" });
  });

  it("auditor é tratado como matriz", () => {
    const r = resolveDefaultActiveReserve({ role: "auditor", current: null, memberships: [], preferences: [] });
    assert.deepEqual(r, { active: null, reason: "matriz" });
  });
});
