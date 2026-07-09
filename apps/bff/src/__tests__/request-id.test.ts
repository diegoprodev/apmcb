import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { requestIdMiddleware } from "../middleware/request-id.ts";
import type { HonoVariables } from "../types/hono.ts";

function makeApp() {
  const app = new Hono<{ Variables: HonoVariables }>();
  app.use("*", requestIdMiddleware);
  app.get("/", (c) => c.json({ requestId: c.get("requestId"), hasLog: typeof c.get("log")?.info === "function" }));
  return app;
}

describe("requestIdMiddleware", () => {
  it("gera um UUID quando o cliente não envia X-Request-Id", async () => {
    const res = await makeApp().request("/");
    const body = await res.json() as { requestId: string };
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.ok(UUID_RE.test(body.requestId), `esperava UUID, recebeu: ${body.requestId}`);
  });

  it("expõe o requestId no header X-Request-Id da resposta", async () => {
    const res = await makeApp().request("/");
    const body = await res.json() as { requestId: string };
    assert.equal(res.headers.get("X-Request-Id"), body.requestId);
  });

  it("reaproveita um UUID válido enviado pelo cliente", async () => {
    const clientId = "12345678-1234-1234-1234-123456789abc";
    const res = await makeApp().request("/", { headers: { "x-request-id": clientId } });
    const body = await res.json() as { requestId: string };
    assert.equal(body.requestId, clientId);
    assert.equal(res.headers.get("X-Request-Id"), clientId);
  });

  it("ignora requestId de entrada malformado e gera um novo UUID", async () => {
    const res = await makeApp().request("/", { headers: { "x-request-id": "não-é-um-uuid" } });
    const body = await res.json() as { requestId: string };
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.ok(UUID_RE.test(body.requestId));
  });

  it("rejeita string com formato de UUID + sufixo malicioso (anti log-injection)", async () => {
    // Newline literal é bloqueado pela própria Headers API do fetch antes de chegar
    // aqui — o vetor realista é um valor "quase-UUID" com lixo anexado, que a regex
    // ancorada (^...$) deve rejeitar por completo, não truncar/aceitar parcialmente.
    const res = await makeApp().request("/", {
      headers: { "x-request-id": '12345678-1234-1234-1234-123456789abc","level":"fatal' },
    });
    const body = await res.json() as { requestId: string };
    assert.notEqual(body.requestId, '12345678-1234-1234-1234-123456789abc","level":"fatal');
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert.ok(UUID_RE.test(body.requestId));
  });

  it("popula c.get('log') como um child logger utilizável", async () => {
    const res = await makeApp().request("/");
    const body = await res.json() as { hasLog: boolean };
    assert.equal(body.hasLog, true);
  });
});
