import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../lib/validated-json.ts";
import { supabase } from "../services/supabase.ts";
import { sendEmail } from "../services/email.ts";
import { claimDedup, releaseDedup } from "../lib/email-dedup.ts";
import { persistEmailLog, persistEmailFailureAudit } from "../lib/email-log.ts";
import { templateCategory, type EmailCategory } from "../lib/email-templates/index.ts";
import { RESET_TOMBSTONE_HASH } from "../lib/login-device.ts";
import {
  handleEmailRequest,
  defaultBucket,
  type OrchestratorDeps,
} from "../lib/email-orchestrator.ts";
import type { HonoVariables } from "../types/hono.ts";

// Wrapper HTTP fino (plano §3.6). O guard internalSecretGuard("INTERNAL_EMAIL_SECRET")
// é aplicado em index.ts. Toda a lógica está em lib/email-orchestrator.ts
// (testada isolada). Aqui só injetamos Supabase + sendEmail e devolvemos 200
// (D16 — nunca sinaliza enumeração de conta ao caller).

const internal = new Hono<{ Variables: HonoVariables }>();

const bodySchema = z.object({
  template: z.string().min(1).max(64),
  recipient_id: z.string().uuid(),
  data: z.record(z.unknown()).default({}),
  category: z.enum(["security", "lifecycle"]).optional(),
});

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function buildDeps(log: HonoVariables["log"]): OrchestratorDeps {
  return {
    lookupRecipient: async (id) => {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, nome_completo, role, default_tenant_id")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      if (data.email) return data;
      // profiles.email pode ser NULL na coorte de convite do BFF — fallback auth.users.
      const { data: authUser } = await supabase.auth.admin.getUserById(id);
      return { ...data, email: authUser?.user?.email ?? null };
    },
    lookupOrgao: async (tenantId) => {
      if (!tenantId) return null;
      const { data } = await supabase.from("tenants").select("nome").eq("id", tenantId).maybeSingle();
      return data?.nome ?? null;
    },
    claimDedup: (key) => claimDedup(key),
    releaseDedup: (key) => releaseDedup(key),
    checkBucket: (category) => defaultBucket(category),
    dailyCount: async () => {
      const since = new Date(Date.now() - DAY_MS).toISOString();
      const { count } = await supabase
        .from("email_log")
        .select("id", { count: "exact", head: true })
        .eq("status", "sent")
        .gte("created_at", since);
      return count ?? 0;
    },
    recipientHourCount: async (recipientId) => {
      const since = new Date(Date.now() - HOUR_MS).toISOString();
      const { count } = await supabase
        .from("email_log")
        .select("id", { count: "exact", head: true })
        .eq("recipient_id", recipientId)
        .in("status", ["sent", "failed"])
        .gte("created_at", since);
      return count ?? 0;
    },
    resetLoginDevices: async (userId) => {
      // Zera os devices reais e planta um tombstone — assim a conta não é
      // confundida com conta nova (count 0 → TOFU, sem alerta) no próximo login:
      // com o tombstone count >= 1 e o re-alerta pretendido dispara.
      const del = await supabase
        .from("known_login_devices")
        .delete()
        .eq("user_id", userId)
        .neq("device_hash", RESET_TOMBSTONE_HASH);
      if (del.error) {
        log.warn({ err: del.error.message, userId }, "email.reset_login_devices.db_failure");
        return;
      }
      const ins = await supabase.from("known_login_devices").upsert(
        { user_id: userId, device_hash: RESET_TOMBSTONE_HASH, ua_family: "(reset)", ip_prefix: null },
        { onConflict: "user_id,device_hash", ignoreDuplicates: true },
      );
      if (ins.error) log.warn({ err: ins.error.message, userId }, "email.reset_login_devices.tombstone_failure");
    },
    send: (args) => sendEmail(args),
    logEmail: (row) => persistEmailLog(row, log),
    logFailure: (row) => persistEmailFailureAudit(
      { template: row.template, category: row.category, error_code: row.error_code },
      log,
    ),
    logException: async (row) => {
      const { error } = await supabase.from("audit_logs").insert({
        actor_id: null,
        action: "email.orchestrator.exception",
        resource_type: "email",
        resource_id: null,
        metadata: { template: row.template, error: row.message.slice(0, 300) },
      });
      if (error) log.error({ err: error.message, template: row.template }, "email.audit.persist_failure");
    },
  };
}

internal.post("/email", zValidator("json", bodySchema), async (c) => {
  const body = c.req.valid("json");
  const category: EmailCategory =
    templateCategory(body.template) ?? body.category ?? "lifecycle";

  const log = c.get("log");
  const result = await handleEmailRequest(
    { template: body.template, recipient_id: body.recipient_id, data: body.data, category },
    buildDeps(log),
    log,
  );

  return c.json(result.body, result.status);
});

export { internal as internalRoutes };
