import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeEventHash } from "../lib/audit-hash";

const baseParams = {
  seq: 1,
  actor_id: "actor-uuid",
  action: "create",
  resource_type: "material_item",
  resource_id: "item-uuid",
  before_snapshot: null,
  after_snapshot: { status: "disponivel" },
  created_at: "2026-01-01T00:00:00.000Z",
  previous_hash: null,
};

describe("computeEventHash", () => {
  it("retorna string hex de 64 chars (SHA-256)", () => {
    const hash = computeEventHash(baseParams);
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("é determinístico — mesmos inputs → mesmo hash", () => {
    assert.equal(computeEventHash(baseParams), computeEventHash(baseParams));
  });

  it("hash muda ao alterar seq", () => {
    const h1 = computeEventHash(baseParams);
    const h2 = computeEventHash({ ...baseParams, seq: 2 });
    assert.notEqual(h1, h2);
  });

  it("hash muda ao alterar actor_id", () => {
    const h1 = computeEventHash(baseParams);
    const h2 = computeEventHash({ ...baseParams, actor_id: "outro-uuid" });
    assert.notEqual(h1, h2);
  });

  it("hash muda ao alterar previous_hash (encadeamento)", () => {
    const h1 = computeEventHash(baseParams);
    const h2 = computeEventHash({ ...baseParams, previous_hash: h1 });
    assert.notEqual(h1, h2);
  });

  it("é independente da ordem dos campos (JSON canônico)", () => {
    const reordered = {
      previous_hash: null,
      created_at: "2026-01-01T00:00:00.000Z",
      after_snapshot: { status: "disponivel" },
      before_snapshot: null,
      resource_id: "item-uuid",
      resource_type: "material_item",
      action: "create",
      actor_id: "actor-uuid",
      seq: 1,
    };
    assert.equal(
      computeEventHash(reordered as Parameters<typeof computeEventHash>[0]),
      computeEventHash(baseParams)
    );
  });

  it("chain: tamper em evento N quebra hash de evento N+1", () => {
    const h1 = computeEventHash(baseParams);
    const h2 = computeEventHash({ ...baseParams, seq: 2, previous_hash: h1 });
    const h1Tampered = computeEventHash({ ...baseParams, action: "delete" });
    const h2WithTampered = computeEventHash({ ...baseParams, seq: 2, previous_hash: h1Tampered });
    assert.notEqual(h2, h2WithTampered);
  });

  it("null e string vazia produzem hashes distintos", () => {
    const withNull  = computeEventHash({ ...baseParams, resource_id: null });
    const withEmpty = computeEventHash({ ...baseParams, resource_id: "" });
    assert.notEqual(withNull, withEmpty);
  });
});
