import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { supabase } from "../services/supabase.ts";
import { internalRoutes } from "../routes/internal.ts";
import { internalSecretGuard } from "../middleware/internal-secret.ts";
import { __resetEmailBuckets } from "../lib/email-rate.ts";
import type { HonoVariables } from "../types/hono.ts";

// Handler real de POST /api/internal/email montado num app Hono, igual a
// src/index.ts. Só troca o que o Supabase / Resend responderiam (monkey-patch
// do singleton `supabase` e de `globalThis.fetch`).
//
// Só usa imports `.ts` explícitos → roda tanto em `node --test` (com as env
// vars de banco setadas — o CI seta valores dummy) quanto em `bun test`.
// (Os outros *-real-handler.test.ts em integration/ importam módulos com
// import sem extensão e por isso ficam restritos ao bun.)

const SECRET = "test-internal-email-secret-32-chars!!";
const ORIGINAL_FROM = supabase.from.bind(supabase);
const REAL_FETCH = globalThis.fetch;

const rows: Record<string, unknown[]> = { email_log: [], email_dedup: [], audit_logs: [] };
let resendCalls = 0;
let resendStatus = 200;
let insertError = false;

const PROFILE = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "u@ex.com", nome_completo: "Ana Silva", role: "usuario", default_tenant_id: null,
};

function fakeTable(name: string) {
  // builder encadeável: eq/in/gte retornam o próprio builder; maybeSingle e o
  // await final resolvem. count queries (email_log) → { count: 0 }.
  const builder: Record<string, unknown> = {
    eq: () => builder,
    in: () => builder,
    gte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: name === "profiles" ? PROFILE : null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => void) => resolve({ count: 0, data: [], error: null }),
  };
  return {
    select: () => builder,
    insert: async (row: unknown) => {
      rows[name]?.push(row);
      return { error: insertError && name === "email_log" ? { message: "insert failed" } : null };
    },
    upsert: () => ({ select: async () => ({ data: [{ dedup_key: "k" }], error: null }) }),
    delete: () => ({ eq: async () => ({ error: null }) }),
  };
}

const ENV_KEYS = ["INTERNAL_EMAIL_SECRET", "EMAIL_ENABLED", "RESEND_API_KEY", "FROM_EMAIL", "EMAIL_DEDUP_PEPPER"] as const;
const savedEnv: Record<string, string | undefined> = {};

before(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.INTERNAL_EMAIL_SECRET = SECRET;
  process.env.EMAIL_ENABLED = "true";
  process.env.RESEND_API_KEY = "re_fake";
  process.env.FROM_EMAIL = "nao-responda@alertas.pmpb.online";
  process.env.EMAIL_DEDUP_PEPPER = "pepper";
  // @ts-expect-error monkey-patch intencional do singleton
  supabase.from = (t: string) => fakeTable(t);
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes("api.resend.com")) {
      resendCalls++;
      return new Response(JSON.stringify({ id: "email_x" }), { status: resendStatus });
    }
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
});

after(() => {
  supabase.from = ORIGINAL_FROM;
  globalThis.fetch = REAL_FETCH;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  rows.email_log = []; rows.email_dedup = []; rows.audit_logs = [];
  resendCalls = 0; resendStatus = 200; insertError = false;
  __resetEmailBuckets();
});

function app() {
  const a = new Hono<{ Variables: HonoVariables }>();
  a.use("*", async (c, next) => { c.set("log", console as never); await next(); });
  a.use("/api/internal/*", internalSecretGuard("INTERNAL_EMAIL_SECRET", "x-internal-email-secret"));
  a.route("/api/internal", internalRoutes);
  return a;
}

const H = { "content-type": "application/json", "x-internal-email-secret": SECRET };
const body = (over = {}) => JSON.stringify({ template: "canary", recipient_id: "11111111-1111-1111-1111-111111111111", data: { nonce: "abc" }, category: "lifecycle", ...over });

describe("POST /api/internal/email — handler real", () => {
  it("secret ausente → 403", async () => {
    const res = await app().request("/api/internal/email", { method: "POST", headers: { "content-type": "application/json" }, body: body() });
    assert.equal(res.status, 403);
  });

  it("password_changed (security) → 200 + envia; categoria vem do registry mesmo se o body mentir", async () => {
    const bodyReq = JSON.stringify({
      template: "password_changed",
      recipient_id: "11111111-1111-1111-1111-111111111111",
      data: { quando: "08/09/2026 19:40" },
      category: "lifecycle", // caller tenta rebaixar — o registry diz security
    });
    const res = await app().request("/api/internal/email", { method: "POST", headers: H, body: bodyReq });
    assert.equal(res.status, 200);
    assert.equal(resendCalls, 1);
    const row = rows.email_log[0] as { status: string; category: string; template: string };
    assert.equal(row.status, "sent");
    assert.equal(row.category, "security");
    assert.equal(row.template, "password_changed");
  });

  it("password_changed sem `quando` → 400 (schema .strict)", async () => {
    const bodyReq = JSON.stringify({
      template: "password_changed",
      recipient_id: "11111111-1111-1111-1111-111111111111",
      data: {},
      category: "security",
    });
    const res = await app().request("/api/internal/email", { method: "POST", headers: H, body: bodyReq });
    assert.equal(res.status, 400);
    assert.equal(resendCalls, 0);
  });

  it("payload válido → 200 + Resend chamado 1x + email_log status=sent", async () => {
    const res = await app().request("/api/internal/email", { method: "POST", headers: H, body: body() });
    assert.equal(res.status, 200);
    assert.equal(resendCalls, 1);
    assert.equal((rows.email_log[0] as { status: string }).status, "sent");
  });

  it("template desconhecido → 400, Resend não chamado", async () => {
    const res = await app().request("/api/internal/email", { method: "POST", headers: H, body: body({ template: "xxx" }) });
    assert.equal(res.status, 400);
    assert.equal(resendCalls, 0);
  });

  it("recipient_id não-uuid → 400 (zValidator)", async () => {
    const res = await app().request("/api/internal/email", { method: "POST", headers: H, body: body({ recipient_id: "nope" }) });
    assert.equal(res.status, 400);
  });

  it("Resend 500 → resposta ainda 200 + email_log failed + audit_logs", async () => {
    resendStatus = 500;
    const res = await app().request("/api/internal/email", { method: "POST", headers: H, body: body() });
    assert.equal(res.status, 200);
    assert.ok(rows.email_log.some((r) => (r as { status: string }).status === "failed"));
    assert.equal(rows.audit_logs.length, 1);
  });

  it("insert de email_log falhando → 200 + log email.log.persist_failure (não trava)", async () => {
    insertError = true;
    const res = await app().request("/api/internal/email", { method: "POST", headers: H, body: body() });
    assert.equal(res.status, 200);
    // o envio ao Resend acontece mesmo assim
    assert.equal(resendCalls, 1);
  });
});
