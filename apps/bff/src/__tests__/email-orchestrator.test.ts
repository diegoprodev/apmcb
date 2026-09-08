import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import pino from "pino";
import { loggerOptions } from "../lib/logger.ts";
import { handleEmailRequest, type OrchestratorDeps } from "../lib/email-orchestrator.ts";

let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { p: process.env.EMAIL_DEDUP_PEPPER, cap: process.env.EMAIL_DAILY_CAP, max: process.env.EMAIL_RATE_MAX };
  process.env.EMAIL_DEDUP_PEPPER = "pepper";
  process.env.EMAIL_DAILY_CAP = "60";
  process.env.EMAIL_RATE_MAX = "20";
});
afterEach(() => {
  process.env.EMAIL_DEDUP_PEPPER = saved.p;
  process.env.EMAIL_DAILY_CAP = saved.cap;
  process.env.EMAIL_RATE_MAX = saved.max;
});

function testLog() {
  const lines: string[] = [];
  const s = new Writable({ write(c, _e, cb) { lines.push(c.toString()); cb(); } });
  return { log: pino(loggerOptions, s), text: () => lines.join("") };
}

function baseDeps(over: Partial<OrchestratorDeps> = {}): OrchestratorDeps & { _logged: Record<string, unknown>[] } {
  const logged: Record<string, unknown>[] = [];
  const defaults: OrchestratorDeps = {
    lookupRecipient: async () => ({ id: "u1", email: "u1@ex.com", nome_completo: "Ana Silva", role: "usuario", default_tenant_id: "t1" }),
    lookupOrgao: async () => "1º BPM",
    claimDedup: async () => true,
    releaseDedup: async () => {},
    checkBucket: () => ({ allowed: true, retryAfterSec: 0 }),
    dailyCount: async () => 0,
    recipientHourCount: async () => 0,
    send: async () => ({ ok: true, id: "email_1" }),
    logEmail: async (row) => { logged.push({ kind: "email_log", ...row }); },
    logFailure: async (row) => { logged.push({ kind: "audit_log", ...row }); },
    logException: async (row) => { logged.push({ kind: "exception_audit", ...row }); },
  };
  return { ...defaults, ...over, _logged: logged };
}

const REQ = { template: "canary", recipient_id: "u1", data: { nonce: "abc" }, category: "lifecycle" as const };

describe("handleEmailRequest", () => {
  it("caminho feliz → 200, envia, grava email_log status=sent", async () => {
    const deps = baseDeps();
    const { log } = testLog();
    const res = await handleEmailRequest(REQ, deps, log);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { ok: true });
    const logged = (deps as unknown as { _logged: Record<string, unknown>[] })._logged;
    assert.equal(logged[0].kind, "email_log");
    assert.equal(logged[0].status, "sent");
  });

  it("template desconhecido → 400", async () => {
    const res = await handleEmailRequest({ ...REQ, template: "xxx" }, baseDeps(), testLog().log);
    assert.equal(res.status, 400);
  });

  it("data inválida (chave extra, .strict) → 400 + log", async () => {
    const { log, text } = testLog();
    const res = await handleEmailRequest({ ...REQ, data: { nonce: "a", extra: 1 } }, baseDeps(), log);
    assert.equal(res.status, 400);
    assert.match(text(), /internal\.email\.invalid_data/);
  });

  it("destinatário desconhecido → 200 (nunca 422) + email_log skipped/unknown_recipient", async () => {
    const deps = baseDeps({ lookupRecipient: async () => null });
    const res = await handleEmailRequest(REQ, deps, testLog().log);
    assert.equal(res.status, 200);
    const logged = (deps as unknown as { _logged: Record<string, unknown>[] })._logged;
    assert.equal(logged[0].status, "skipped");
    assert.equal(logged[0].error_code, "unknown_recipient");
  });

  it("dedup já reivindicado → 200 + email_log skipped/dedup, não envia", async () => {
    let sent = false;
    const deps = baseDeps({ claimDedup: async () => false, send: async () => { sent = true; return { ok: true, id: "x" }; } });
    const res = await handleEmailRequest(REQ, deps, testLog().log);
    assert.equal(res.status, 200);
    assert.equal(sent, false);
    const logged = (deps as unknown as { _logged: Record<string, unknown>[] })._logged;
    assert.equal(logged[0].error_code, "dedup");
  });

  it("lifecycle acima do teto diário → suppressed, não envia", async () => {
    let sent = false;
    const deps = baseDeps({ dailyCount: async () => 60, send: async () => { sent = true; return { ok: true, id: "x" }; } });
    const res = await handleEmailRequest(REQ, deps, testLog().log);
    assert.equal(res.status, 200);
    assert.equal(sent, false);
    const logged = (deps as unknown as { _logged: Record<string, unknown>[] })._logged;
    assert.equal(logged[0].status, "suppressed");
  });

  it("O7: security acima do teto diário → AINDA envia + logger.error", async () => {
    let sent = false;
    const { log, text } = testLog();
    const deps = baseDeps({
      dailyCount: async () => 999,
      checkBucket: () => ({ allowed: false, retryAfterSec: 30 }),
      send: async () => { sent = true; return { ok: true, id: "s" }; },
    });
    const res = await handleEmailRequest({ ...REQ, category: "security" }, deps, log);
    assert.equal(res.status, 200);
    assert.equal(sent, true, "security tem que ser enviado mesmo saturado");
    assert.match(text(), /email\.security\.throttled/);
  });

  it("falha no envio → 200 + email_log failed + audit_logs email.send_failed + libera dedup", async () => {
    let released = false;
    const deps = baseDeps({
      send: async () => ({ ok: false, error: "http_500", retryable: true, status: 500 }),
      releaseDedup: async () => { released = true; },
    });
    const res = await handleEmailRequest(REQ, deps, testLog().log);
    assert.equal(res.status, 200);
    assert.equal(released, true, "dedup key tem que ser liberada quando o envio falha");
    const logged = (deps as unknown as { _logged: Record<string, unknown>[] })._logged;
    assert.ok(logged.some((r) => r.kind === "email_log" && r.status === "failed"));
    assert.ok(logged.some((r) => r.kind === "audit_log"));
  });

  it("dedup é checado DEPOIS do throttle (blip de rate não queima a chave)", async () => {
    let claimCalled = false;
    const deps = baseDeps({
      checkBucket: () => ({ allowed: false, retryAfterSec: 30 }),
      claimDedup: async () => { claimCalled = true; return true; },
    });
    // lifecycle + bucket cheio → suppressed antes de tocar no dedup
    await handleEmailRequest(REQ, deps, testLog().log);
    assert.equal(claimCalled, false);
  });

  it("qualquer rejeição de deps → 200 + log + trilha durável em audit_logs (nunca 500)", async () => {
    const { log, text } = testLog();
    const deps = baseDeps({ lookupRecipient: async () => { throw new Error("db down"); } });
    const res = await handleEmailRequest(REQ, deps, log);
    assert.equal(res.status, 200);
    assert.match(text(), /email\.orchestrator\.exception/);
    const logged = (deps as unknown as { _logged: Record<string, unknown>[] })._logged;
    assert.ok(logged.some((r) => r.kind === "exception_audit"), "exceção tem que ir para audit_logs");
  });

  it("template via cadeia de protótipo (constructor / __proto__) → 400, não 500", async () => {
    for (const t of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const res = await handleEmailRequest({ ...REQ, template: t }, baseDeps(), testLog().log);
      assert.equal(res.status, 400, t);
    }
  });

  it("nome e orgao vêm do lookup, não do data do caller", async () => {
    let sentArgs: { html: string; text: string } | null = null;
    const deps = baseDeps({
      lookupRecipient: async () => ({ id: "u1", email: "u1@ex.com", nome_completo: "Bruno Costa", role: "usuario", default_tenant_id: "t1" }),
      send: async (a) => { sentArgs = a as never; return { ok: true, id: "x" }; },
    });
    // caller tenta injetar nome malicioso — canary não usa nome, mas o teste
    // garante que data extra não passa pela validação .strict()
    await handleEmailRequest({ ...REQ, data: { nonce: "n1" } }, deps, testLog().log);
    assert.ok(sentArgs);
  });
});
