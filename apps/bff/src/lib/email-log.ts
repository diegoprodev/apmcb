import { supabase } from "../services/supabase.ts";
import { baseLogger, type Logger } from "./logger.ts";
import type { EmailLogRow } from "./email-orchestrator.ts";

// Persistência da trilha de e-mail (plano §2.5 / §3.6, tabela `email_log` +
// `audit_logs action="email.send_failed"`). Extraído de routes/internal.ts para
// que TODO envio — o orquestrador do endpoint interno E os `sendEmail` diretos
// do BFF (ex.: admin.ts `enviar-acesso`) — deixe o mesmo rastro. Sem isso, um
// e-mail que falha no caminho direto some do `GET /api/nexus/errors`.
//
// Best-effort: nunca lança. Falha de persistência vira log de pino.

export async function persistEmailLog(row: EmailLogRow, log: Logger = baseLogger): Promise<void> {
  const { error } = await supabase.from("email_log").insert(row);
  if (error) {
    log.warn(
      { err: error.message, status: row.status, template: row.template },
      "email.log.persist_failure",
    );
  }
}

export async function persistEmailFailureAudit(
  row: {
    template: string;
    category: EmailLogRow["category"];
    error_code: string | null;
    actor_id?: string | null;
    resource_id?: string | null;
  },
  log: Logger = baseLogger,
): Promise<void> {
  const { error } = await supabase.from("audit_logs").insert({
    actor_id: row.actor_id ?? null,
    action: "email.send_failed",
    resource_type: "email",
    resource_id: row.resource_id ?? null,
    metadata: { template: row.template, category: row.category, error_code: row.error_code },
  });
  if (error) {
    log.error({ err: error.message, template: row.template }, "email.audit.persist_failure");
  }
}
