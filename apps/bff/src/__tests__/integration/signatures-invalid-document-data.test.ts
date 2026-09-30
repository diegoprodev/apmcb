import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { requestIdMiddleware } from "../../middleware/request-id.ts";
import { signatureRoutes } from "../../routes/signatures.ts";
import { baseLogger } from "../../lib/logger.ts";
import { supabase } from "../../services/supabase.ts";
import type { HonoVariables } from "../../types/hono.ts";

// R-01A: hashDocument passou a percorrer document_data e rejeita entradas não
// canonicalizáveis. POST /api/signatures precisa recusar ANTES de ler/consumir
// o TOTP do signatário (senão o código é gasto e a resposta vira 500).
// Handler real; roda via bun (signatures.ts usa imports sem extensão).

const ORIGINAL_FROM = supabase.from.bind(supabase);
const ORIGINAL_CHILD = baseLogger.child.bind(baseLogger);
let tablesTouched: string[] = [];
let warns: Array<{ obj: Record<string, unknown>; msg: string }> = [];

before(() => {
  // monkey-patch intencional do singleton: qualquer consulta é falha do teste
  supabase.from = ((table: string) => {
    tablesTouched.push(table);
    throw new Error(`não deveria consultar ${table}`);
  }) as typeof supabase.from;
  baseLogger.child = ((bindings: Record<string, unknown>) => {
    const child = ORIGINAL_CHILD(bindings);
    child.warn = ((obj: Record<string, unknown>, msg: string) => { warns.push({ obj, msg }); }) as typeof child.warn;
    return child;
  }) as unknown as typeof baseLogger.child;
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  baseLogger.child = ORIGINAL_CHILD;
});

beforeEach(() => { tablesTouched = []; warns = []; });

const app = new Hono<{ Variables: HonoVariables }>();
app.use("*", requestIdMiddleware);
app.use("*", async (c, next) => {
  c.set("userId", "95555555-1111-1111-1111-111111111111");
  c.set("role", "armeiro");
  c.set("tenantId", "95555555-0000-0000-0000-000000000001");
  c.set("reserveId", "95555555-2222-2222-2222-222222222222");
  await next();
});
app.route("/api/signatures", signatureRoutes);

function post(documentDataJson: string) {
  const body = `{"document_type":"lending","document_id":"95555555-3333-3333-3333-333333333333","totp_token":"123456","document_data":${documentDataJson}}`;
  return app.request("/api/signatures", { method: "POST", headers: { "Content-Type": "application/json" }, body });
}

describe("POST /api/signatures — document_data não canonicalizável", () => {
  it("aninhamento profundo → 400, loga, e não toca em totp_secrets", async () => {
    const res = await post(`{"a":${"[".repeat(5000)}1${"]".repeat(5000)}}`);
    assert.equal(res.status, 400);
    assert.deepEqual(tablesTouched, []);
    assert.ok(warns.some((w) => w.msg === "signature.create.invalid_document_data"));
  });

  it("número que o JSON.parse vira Infinity (1e999) → 400 sem tocar em totp_secrets", async () => {
    const res = await post('{"x":1e999}');
    assert.equal(res.status, 400);
    assert.deepEqual(tablesTouched, []);
  });
});
