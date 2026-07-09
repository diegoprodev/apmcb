import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import pino from "pino";
import { Hono } from "hono";
import { loggerOptions } from "../lib/logger.ts";
import { accessLogMiddleware } from "../middleware/access-log.ts";
import type { HonoVariables } from "../types/hono.ts";

function makeApp() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { lines.push(chunk.toString()); cb(); },
  });
  const testLogger = pino(loggerOptions, stream);

  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "test-request-id");
    c.set("log", testLogger);
    await next();
  });
  app.use("*", accessLogMiddleware);
  app.get("/ok", (c) => c.json({ ok: true }));
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/boom", (c) => c.json({ error: "nope" }, 500));

  return { app, lastLine: () => JSON.parse(lines[lines.length - 1]) as Record<string, unknown>, lineCount: () => lines.length };
}

describe("accessLogMiddleware", () => {
  it("loga método, path, status e duration_ms", async () => {
    const { app, lastLine } = makeApp();
    await app.request("/ok");
    const line = lastLine();
    assert.equal(line.method, "GET");
    assert.equal(line.path, "/ok");
    assert.equal(line.status, 200);
    assert.equal(typeof line.duration_ms, "number");
    assert.equal(line.msg, "http.request.completed");
  });

  it("loga userId/tenantId null quando não autenticado", async () => {
    const { app, lastLine } = makeApp();
    await app.request("/ok");
    const line = lastLine();
    assert.equal(line.userId, null);
    assert.equal(line.tenantId, null);
  });

  it("não loga requisições a /health", async () => {
    const { app, lineCount } = makeApp();
    await app.request("/health");
    assert.equal(lineCount(), 0);
  });

  it("loga status 500 corretamente para respostas de erro", async () => {
    const { app, lastLine } = makeApp();
    await app.request("/boom");
    assert.equal(lastLine().status, 500);
  });
});
