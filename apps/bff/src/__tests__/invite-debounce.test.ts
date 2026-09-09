import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isInviteDebounced, INVITE_DEBOUNCE_MS } from "../lib/invite-debounce.ts";

describe("isInviteDebounced", () => {
  const NOW = 1_000_000_000_000;

  it("não barra quando nunca houve envio", () => {
    assert.equal(isInviteDebounced(null, NOW), false);
    assert.equal(isInviteDebounced(undefined, NOW), false);
    assert.equal(isInviteDebounced("", NOW), false);
  });

  it("barra dentro da janela de 30s", () => {
    assert.equal(isInviteDebounced(new Date(NOW - 1_000).toISOString(), NOW), true);
    assert.equal(isInviteDebounced(new Date(NOW - 29_999).toISOString(), NOW), true);
  });

  it("libera a partir de 30s", () => {
    assert.equal(isInviteDebounced(new Date(NOW - INVITE_DEBOUNCE_MS).toISOString(), NOW), false);
    assert.equal(isInviteDebounced(new Date(NOW - 60_000).toISOString(), NOW), false);
  });

  it("timestamp inválido não barra (fail-open — não trava o admin)", () => {
    assert.equal(isInviteDebounced("não é data", NOW), false);
  });

  it("timestamp no futuro (clock skew) não barra", () => {
    assert.equal(isInviteDebounced(new Date(NOW + 10_000).toISOString(), NOW), false);
  });

  it("janela customizável", () => {
    assert.equal(isInviteDebounced(new Date(NOW - 5_000).toISOString(), NOW, 10_000), true);
    assert.equal(isInviteDebounced(new Date(NOW - 5_000).toISOString(), NOW, 2_000), false);
  });
});
