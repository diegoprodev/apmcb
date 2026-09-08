import { baseLogger, maskEmail, type Logger } from "./logger.ts";
import {
  validateTemplateData,
  renderTemplate,
  type EmailCategory,
  type RecipientFields,
} from "./email-templates/index.ts";
import { primeiroNome } from "./primeiro-nome.ts";
import { dedupKey } from "./email-dedup.ts";
import { checkEmailBucket } from "./email-rate.ts";
import type { SendResult } from "../services/email.ts";

// Orquestração pura (plano §3.6). O Hono wrapper em routes/internal.ts só
// injeta as dependências reais (Supabase, sendEmail) e devolve a resposta.
// Tudo aqui é testável isolado.

export interface RecipientRow {
  id: string;
  email: string | null;
  nome_completo: string | null;
  role: string;
  default_tenant_id: string | null;
}

export interface EmailLogRow {
  template: string;
  category: EmailCategory;
  // null quando o destinatário não foi encontrado — `email_log.recipient_id`
  // tem FK para profiles(id), então gravar um id inexistente viola a
  // constraint (o registro do "unknown_recipient" ficava sem trilha).
  recipient_id: string | null;
  status: "sent" | "failed" | "skipped" | "suppressed";
  resend_id: string | null;
  error_code: string | null;
}

export interface OrchestratorDeps {
  lookupRecipient: (recipientId: string) => Promise<RecipientRow | null>;
  lookupOrgao: (tenantId: string | null) => Promise<string | null>;
  claimDedup: (key: string) => Promise<boolean>;
  /** Libera a chave (best-effort) quando o envio reivindicado falhou. */
  releaseDedup: (key: string) => Promise<void>;
  checkBucket: (category: EmailCategory) => { allowed: boolean; retryAfterSec: number };
  dailyCount: () => Promise<number>;
  recipientHourCount: (recipientId: string) => Promise<number>;
  send: (args: {
    to: string;
    subject: string;
    html: string;
    text: string;
    category: EmailCategory;
    log: Logger;
  }) => Promise<SendResult>;
  logEmail: (row: EmailLogRow) => Promise<void>;
  logFailure: (row: { template: string; category: EmailCategory; recipient_id: string; error_code: string }) => Promise<void>;
  /** Persiste uma exceção inesperada da orquestração em trilha durável
   *  (`audit_logs`) — `docker logs` some no deploy, então log de pino sozinho
   *  não basta (regra de debug do CLAUDE.md). */
  logException: (row: { template: string; recipient_id: string; message: string }) => Promise<void>;
  now?: () => number;
}

export interface EmailRequest {
  template: string;
  recipient_id: string;
  data: unknown;
  category: EmailCategory;
}

export interface HandlerResult {
  status: 200 | 400;
  body: Record<string, unknown>;
}

const OK: HandlerResult = { status: 200, body: { ok: true } };

// Janela de dedup. TODO (Fase 2): `welcome` precisa de dedup PERMANENTE via a
// coluna `profiles.welcome_email_sent_at` — a janela de 10 min aqui só evita
// double-submit de `password_changed` e re-alerta imediato de `new_login`. NÃO
// registrar `welcome` neste dedup de janela sem antes ter a coluna, ou dois
// gatilhos com > 10 min de intervalo mandam dois welcomes.
function windowTag(now: number): string {
  return String(Math.floor(now / 600_000));
}

export function defaultBucket(category: EmailCategory) {
  const max = Number(process.env.EMAIL_RATE_MAX) || 20;
  return checkEmailBucket(category, max, 60_000);
}

export async function handleEmailRequest(
  req: EmailRequest,
  deps: OrchestratorDeps,
  log: Logger = baseLogger,
): Promise<HandlerResult> {
  const now = deps.now?.() ?? Date.now();

  // 1. valida template + data (.strict)
  const validation = validateTemplateData(req.template, req.data);
  if (!validation.ok) {
    if (validation.error === "unknown_template") {
      log.warn({ template: req.template }, "internal.email.unknown_template");
      return { status: 400, body: { error: "unknown_template" } };
    }
    log.warn({ template: req.template, issues: validation.issues }, "internal.email.invalid_data");
    return { status: 400, body: { error: "invalid_data" } };
  }
  const cleanData = validation.data;

  // Passos 2–7 nunca propagam exceção ao caller: qualquer rejeição de `deps.*`
  // (DB fora, timeout PostgREST, rede) vira log + 200, preservando a
  // anti-enumeração (D16) e "toda falha deixa rastro".
  try {
    // 2. lookup do destinatário — sem match / sem e-mail → 200 (nunca 422)
    const recipient = await deps.lookupRecipient(req.recipient_id);
    if (!recipient || !recipient.email) {
      log.warn({ recipient_id: req.recipient_id }, "internal.email.unknown_recipient");
      await deps.logEmail({
        // recipient_id: null — o id do payload não existe em profiles (FK).
        template: req.template, category: req.category, recipient_id: null,
        status: "skipped", resend_id: null, error_code: "unknown_recipient",
      });
      return OK;
    }

    // 3. rate limit + teto diário + throttle por destinatário (ANTES do dedup —
    //    um blip de rate não pode "queimar" a dedup_key e perder o e-mail de vez)
    const bucket = deps.checkBucket(req.category);
    const daily = await deps.dailyCount();
    const dailyCap = Number(process.env.EMAIL_DAILY_CAP) || 60;
    const hourly = await deps.recipientHourCount(recipient.id);

    const overDaily = req.category === "lifecycle" && daily >= dailyCap;
    const overHourly = req.category !== "security" && hourly >= 5;
    const throttled = !bucket.allowed || overDaily || overHourly;

    if (throttled) {
      const reason = !bucket.allowed ? "rate" : overDaily ? "daily_cap" : "recipient_hourly";
      if (req.category === "security") {
        // O7: alerta de segurança NUNCA é silenciado — loga e segue enviando.
        log.error({ template: req.template, reason, retry_after: bucket.retryAfterSec }, "email.security.throttled");
      } else {
        await deps.logEmail({
          template: req.template, category: req.category, recipient_id: recipient.id,
          status: "suppressed", resend_id: null, error_code: reason,
        });
        return OK;
      }
    }

    // 4. dedup server-side — reivindica só quando de fato vai enviar
    const key = dedupKey(req.template, recipient.id, windowTag(now));
    const claimed = await deps.claimDedup(key);
    if (!claimed) {
      await deps.logEmail({
        template: req.template, category: req.category, recipient_id: recipient.id,
        status: "skipped", resend_id: null, error_code: "dedup",
      });
      return OK;
    }

    // 5. contexto do destinatário (nome/orgao do lookup, nunca do caller)
    const orgao = await deps.lookupOrgao(recipient.default_tenant_id);
    const recipientFields: RecipientFields = {
      nome: primeiroNome(recipient.nome_completo, "militar"),
      orgao,
    };

    // 6. render + envio
    const rendered = renderTemplate(
      req.template, cleanData,
      { baseUrl: process.env.FRONTEND_URL ?? "https://apmcb.pmpb.online", logoDataUri: "" },
      recipientFields,
    );
    const result = await deps.send({
      to: recipient.email, subject: rendered.subject, html: rendered.html, text: rendered.text,
      category: req.category, log,
    });

    // 7. trilha
    if (result.ok) {
      await deps.logEmail({
        template: req.template, category: req.category, recipient_id: recipient.id,
        status: "sent", resend_id: result.id, error_code: null,
      });
    } else {
      // Libera a dedup_key para não bloquear uma retentativa do MESMO gatilho
      // (relevante p/ `security`: melhor duplicado que alerta perdido).
      await deps.releaseDedup(key).catch(() => {});
      log.error({ template: req.template, to_masked: maskEmail(recipient.email), error: result.error }, "email.send_failed");
      await deps.logEmail({
        template: req.template, category: req.category, recipient_id: recipient.id,
        status: "failed", resend_id: null, error_code: result.error,
      });
      await deps.logFailure({
        template: req.template, category: req.category, recipient_id: recipient.id, error_code: result.error,
      });
    }

    return OK;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ template: req.template, error: message }, "email.orchestrator.exception");
    // Trilha durável — sobrevive a restart do container e aparece em
    // GET /api/nexus/errors. Best-effort: nunca deixa a exceção escapar.
    await deps
      .logException({ template: req.template, recipient_id: req.recipient_id, message })
      .catch((e) => log.error({ error: String(e) }, "email.orchestrator.exception.persist_failure"));
    return OK;
  }
}
