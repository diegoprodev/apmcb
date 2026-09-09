import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import pino from "pino";
import { loggerOptions } from "../lib/logger.ts";
import { supabase } from "../services/supabase.ts";
import { persistEmailLog, persistEmailFailureAudit } from "../lib/email-log.ts";

// Garante que o caminho de `sendEmail` direto (admin.ts enviar-acesso) deixa a
// MESMA trilha que o orquestrador: linha em `email_log` + `audit_logs
// action="email.send_failed"` na falha — sem isso o incidente some do
// GET /api/nexus/errors.

function testLogger() {
  const lines: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { lines.push(c.toString()); cb(); } });
  return { log: pino(loggerOptions, stream), lines };
}

const realFrom = supabase.from.bind(supabase);
let calls: Array<{ table: string; row: unknown }>;
let insertError: string | null;

beforeEach(() => {
  calls = [];
  insertError = null;
  // @ts-expect-error — monkey-patch do singleton para o teste
  supabase.from = (table: string) => ({
    insert: async (row: unknown) => {
      calls.push({ table, row });
      return { error: insertError ? { message: insertError } : null };
    },
  });
});

afterEach(() => {
  supabase.from = realFrom;
});

describe("persistEmailLog", () => {
  it("insere a linha em email_log como recebida", async () => {
    await persistEmailLog({
      template: "acesso", category: "lifecycle", recipient_id: "u1",
      status: "sent", resend_id: "re_123", error_code: null,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].table, "email_log");
    assert.deepEqual(calls[0].row, {
      template: "acesso", category: "lifecycle", recipient_id: "u1",
      status: "sent", resend_id: "re_123", error_code: null,
    });
  });

  it("falha de insert vira log de aviso, não lança", async () => {
    insertError = "permission denied";
    const { log, lines } = testLogger();
    await assert.doesNotReject(persistEmailLog(
      { template: "acesso", category: "lifecycle", recipient_id: "u1", status: "failed", resend_id: null, error_code: "timeout" },
      log,
    ));
    assert.ok(lines.join("\n").includes("email.log.persist_failure"));
  });
});

describe("persistEmailFailureAudit", () => {
  it("grava audit_logs action=email.send_failed com actor e resource opcionais", async () => {
    await persistEmailFailureAudit({
      template: "acesso", category: "lifecycle", error_code: "timeout",
      actor_id: "admin-1", resource_id: "u1",
    });
    assert.equal(calls[0].table, "audit_logs");
    const row = calls[0].row as Record<string, unknown>;
    assert.equal(row.action, "email.send_failed");
    assert.equal(row.actor_id, "admin-1");
    assert.equal(row.resource_id, "u1");
    assert.deepEqual(row.metadata, { template: "acesso", category: "lifecycle", error_code: "timeout" });
  });

  it("actor_id e resource_id são null quando omitidos (caminho do orquestrador)", async () => {
    await persistEmailFailureAudit({ template: "canary", category: "lifecycle", error_code: "daily_cap" });
    const row = calls[0].row as Record<string, unknown>;
    assert.equal(row.actor_id, null);
    assert.equal(row.resource_id, null);
  });

  it("falha de insert vira log de erro, não lança", async () => {
    insertError = "fk violation";
    const { log, lines } = testLogger();
    await assert.doesNotReject(persistEmailFailureAudit(
      { template: "acesso", category: "lifecycle", error_code: "x" },
      log,
    ));
    assert.ok(lines.join("\n").includes("email.audit.persist_failure"));
  });
});
