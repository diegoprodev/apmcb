import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { internalSecretGuard } from "../middleware/internal-secret.ts";

const ENV = "TEST_INTERNAL_SECRET";
const HEADER = "x-test-secret";

function app() {
  const a = new Hono();
  a.use("/protegido/*", internalSecretGuard(ENV, HEADER));
  a.get("/protegido/ok", (c) => c.json({ ok: true }));
  return a;
}

let saved: string | undefined;
beforeEach(() => { saved = process.env[ENV]; process.env[ENV] = "s3cr3t-com-32-bytes-de-entropia!!"; });
afterEach(() => { if (saved === undefined) delete process.env[ENV]; else process.env[ENV] = saved; });

describe("internalSecretGuard", () => {
  it("secret correto → passa", async () => {
    const res = await app().request("/protegido/ok", { headers: { [HEADER]: "s3cr3t-com-32-bytes-de-entropia!!" } });
    assert.equal(res.status, 200);
  });

  it("secret ausente → 403", async () => {
    const res = await app().request("/protegido/ok");
    assert.equal(res.status, 403);
  });

  it("secret errado (mesmo comprimento) → 403", async () => {
    const res = await app().request("/protegido/ok", { headers: { [HEADER]: "X3cr3t-com-32-bytes-de-entropia!!" } });
    assert.equal(res.status, 403);
  });

  it("secret errado (comprimento diferente) → 403 sem lançar", async () => {
    const res = await app().request("/protegido/ok", { headers: { [HEADER]: "curto" } });
    assert.equal(res.status, 403);
  });

  it("env não configurada no servidor → 403", async () => {
    delete process.env[ENV];
    const res = await app().request("/protegido/ok", { headers: { [HEADER]: "qualquer" } });
    assert.equal(res.status, 403);
  });
});
