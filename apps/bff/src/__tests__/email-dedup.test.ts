import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import pino from "pino";
import { loggerOptions } from "../lib/logger.ts";
import { dedupKey, claimDedup, type DedupDeps } from "../lib/email-dedup.ts";

let savedPepper: string | undefined;
beforeEach(() => {
  savedPepper = process.env.EMAIL_DEDUP_PEPPER;
  process.env.EMAIL_DEDUP_PEPPER = "pepper-de-teste-com-entropia-suficiente";
});
afterEach(() => {
  if (savedPepper === undefined) delete process.env.EMAIL_DEDUP_PEPPER;
  else process.env.EMAIL_DEDUP_PEPPER = savedPepper;
});

function testLogger() {
  const lines: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { lines.push(c.toString()); cb(); } });
  return { log: pino(loggerOptions, stream), lines };
}
const deps = (upsert: DedupDeps["upsert"]): DedupDeps => ({ upsert });

describe("dedupKey", () => {
  it("determinística para as mesmas entradas", () => {
    assert.equal(
      dedupKey("password_changed", "u1", "202609081200"),
      dedupKey("password_changed", "u1", "202609081200"),
    );
  });

  it("muda com pepper diferente", () => {
    const a = dedupKey("welcome", "u1", "x");
    process.env.EMAIL_DEDUP_PEPPER = "outro-pepper";
    assert.notEqual(a, dedupKey("welcome", "u1", "x"));
  });

  it("não contém o recipient_id em claro", () => {
    assert.doesNotMatch(dedupKey("welcome", "user-abc-123", "janela"), /user-abc-123/);
  });

  it("sem pepper → lança", () => {
    delete process.env.EMAIL_DEDUP_PEPPER;
    assert.throws(() => dedupKey("welcome", "u1", "x"));
  });
});

describe("claimDedup", () => {
  it("primeira reivindicação → true", async () => {
    assert.equal(await claimDedup("k", undefined, deps(async () => ({ inserted: true }))), true);
  });

  it("reivindicação repetida → false", async () => {
    assert.equal(await claimDedup("k", undefined, deps(async () => ({ inserted: false }))), false);
  });

  it("erro no banco → true (falha em direção ao envio) + loga email.dedup.error", async () => {
    const { log, lines } = testLogger();
    const r = await claimDedup("k", log, deps(async () => ({ inserted: false, error: "boom" })));
    assert.equal(r, true);
    assert.match(lines.join(""), /email\.dedup\.error/);
  });
});
