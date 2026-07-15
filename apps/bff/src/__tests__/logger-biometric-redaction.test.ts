import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import pino from "pino";
import { loggerOptions } from "../lib/logger.ts";

function makeTestLogger(): { logger: pino.Logger; lastLine: () => Record<string, unknown> } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const logger = pino(loggerOptions, stream);
  return { logger, lastLine: () => JSON.parse(lines[lines.length - 1]) };
}

describe("logger biometric redaction", () => {
  it("redacts biometric secrets and artifacts", () => {
    const { logger, lastLine } = makeTestLogger();
    logger.info(
      {
        bridge_signature: "sig",
        public_key: "pub",
        raw_fingerprint: "raw",
        template_hash: "hash",
        payload: {
          encrypted_template_data: "cipher",
          private_key: "priv",
        },
      },
      "biometric.test",
    );

    const line = lastLine();
    assert.equal(line.bridge_signature, "[REDACTED]");
    assert.equal(line.public_key, "[REDACTED]");
    assert.equal(line.raw_fingerprint, "[REDACTED]");
    assert.equal(line.template_hash, "[REDACTED]");
    const payload = line.payload as Record<string, unknown>;
    assert.equal(payload.encrypted_template_data, "[REDACTED]");
    assert.equal(payload.private_key, "[REDACTED]");
  });
});
