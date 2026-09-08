import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkEmailBucket, __resetEmailBuckets } from "../lib/email-rate.ts";

describe("checkEmailBucket", () => {
  beforeEach(() => __resetEmailBuckets());

  it("permite até EMAIL_RATE_MAX por janela, depois nega", () => {
    const max = 20;
    for (let i = 0; i < max; i++) {
      assert.equal(checkEmailBucket("lifecycle", max, 60_000).allowed, true, `req ${i}`);
    }
    const denied = checkEmailBucket("lifecycle", max, 60_000);
    assert.equal(denied.allowed, false);
    assert.ok(denied.retryAfterSec >= 1);
  });

  it("buckets security e lifecycle são independentes", () => {
    for (let i = 0; i < 3; i++) checkEmailBucket("security", 3, 60_000);
    assert.equal(checkEmailBucket("security", 3, 60_000).allowed, false);
    assert.equal(checkEmailBucket("lifecycle", 3, 60_000).allowed, true);
  });

  it("janela deslizante: entradas antigas expiram", () => {
    const now = Date.now();
    checkEmailBucket("lifecycle", 1, 1000, now - 2000);
    assert.equal(checkEmailBucket("lifecycle", 1, 1000, now).allowed, true);
  });
});
