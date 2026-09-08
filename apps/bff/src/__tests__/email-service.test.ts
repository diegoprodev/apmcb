import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import pino from "pino";
import { loggerOptions } from "../lib/logger.ts";
import { emailConfigured, sendEmail } from "../services/email.ts";

const REAL_FETCH = globalThis.fetch;
const ENV_KEYS = ["EMAIL_ENABLED", "RESEND_API_KEY", "FROM_EMAIL", "FROM_NAME", "EMAIL_SEND_TIMEOUT_MS"];
let savedEnv: Record<string, string | undefined>;

function testLogger() {
  const lines: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { lines.push(c.toString()); cb(); } });
  return { log: pino(loggerOptions, stream), lines };
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.EMAIL_ENABLED = "true";
  process.env.RESEND_API_KEY = "re_secret_KEY_do_not_log";
  process.env.FROM_EMAIL = "alertas@pmpb.online";
  process.env.FROM_NAME = "Andrômeda";
});

afterEach(() => {
  globalThis.fetch = REAL_FETCH;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const OK_BODY = { subject: "s", html: "<p>h</p>", text: "t", category: "lifecycle" as const };

describe("emailConfigured", () => {
  it("true com key + from + enabled", () => {
    assert.equal(emailConfigured(), true);
  });
  it("false com EMAIL_ENABLED=false", () => {
    process.env.EMAIL_ENABLED = "false";
    assert.equal(emailConfigured(), false);
  });
  it("false sem RESEND_API_KEY", () => {
    delete process.env.RESEND_API_KEY;
    assert.equal(emailConfigured(), false);
  });
});

describe("sendEmail", () => {
  it("não configurado → não chama fetch, retorna not_configured, loga email.skipped", async () => {
    process.env.EMAIL_ENABLED = "false";
    let called = false;
    globalThis.fetch = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
    const { log, lines } = testLogger();
    const r = await sendEmail({ to: "a@b.com", ...OK_BODY, log });
    assert.equal(called, false);
    assert.deepEqual(r, { ok: false, error: "not_configured", retryable: false });
    assert.match(lines.join(""), /email\.skipped/);
  });

  it("sucesso → POST para resend, Authorization Bearer, Idempotency-Key; retorna id", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sendEmail({ to: "a@b.com", ...OK_BODY });
    assert.deepEqual(r, { ok: true, id: "email_123" });
    assert.match(seen!.url, /api\.resend\.com\/emails/);
    const h = new Headers(seen!.init.headers);
    assert.equal(h.get("authorization"), "Bearer re_secret_KEY_do_not_log");
    assert.ok(h.get("idempotency-key"));
  });

  it("a chave da API NUNCA aparece no log", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })) as unknown as typeof fetch;
    const { log, lines } = testLogger();
    await sendEmail({ to: "a@b.com", ...OK_BODY, log });
    assert.doesNotMatch(lines.join(""), /re_secret_KEY_do_not_log/);
  });

  it("429 → retryable:true", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    const r = await sendEmail({ to: "a@b.com", ...OK_BODY });
    assert.equal(r.ok, false);
    assert.equal((r as { retryable: boolean }).retryable, true);
  });

  it("422 (erro de validação Resend) → retryable:false", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ name: "validation_error" }), { status: 422 })) as unknown as typeof fetch;
    const r = await sendEmail({ to: "a@b.com", ...OK_BODY });
    assert.equal(r.ok, false);
    assert.equal((r as { retryable: boolean }).retryable, false);
  });

  it("timeout REAL (AbortSignal.timeout dispara) → error timeout, retryable:true", async () => {
    process.env.EMAIL_SEND_TIMEOUT_MS = "15";
    // fetch respeita o AbortSignal de verdade: só resolve após 200ms, mas o
    // signal de 15ms aborta antes. Exercita o name real que o Node 24 lança
    // ("TimeoutError"), não um AbortError fabricado.
    globalThis.fetch = ((_u: string, init: RequestInit) =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => resolve(new Response("{}", { status: 200 })), 200);
        init.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject((init.signal as AbortSignal).reason ?? new Error("aborted"));
        });
      })) as unknown as typeof fetch;
    const r = await sendEmail({ to: "a@b.com", ...OK_BODY });
    assert.equal(r.ok, false);
    assert.equal((r as { error: string }).error, "timeout");
    assert.equal((r as { retryable: boolean }).retryable, true);
  });

  it("destinatário logado é mascarado (não aparece cru)", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: "x" }), { status: 200 })) as unknown as typeof fetch;
    const { log, lines } = testLogger();
    await sendEmail({ to: "fulano@exemplo.com", ...OK_BODY, log });
    assert.doesNotMatch(lines.join(""), /fulano@exemplo\.com/);
  });
});
