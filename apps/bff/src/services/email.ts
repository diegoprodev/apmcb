import { randomUUID } from "node:crypto";
import { baseLogger, maskEmail, type Logger } from "../lib/logger.ts";
import type { EmailCategory } from "../lib/email-templates/index.ts";

// Transporte Resend (plano §3.5). Puro: não conhece templates, rotas nem
// banco — recebe { subject, html, text } pronto. Fail-soft: sem config, vira
// no-op logado, NUNCA lança no import (diferente de services/supabase.ts).

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 8000;

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string; retryable: boolean; status?: number };

export function emailConfigured(): boolean {
  return (
    process.env.EMAIL_ENABLED !== "false" &&
    !!process.env.RESEND_API_KEY &&
    !!process.env.FROM_EMAIL
  );
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  category: EmailCategory;
  log?: Logger;
}

export async function sendEmail(p: SendEmailInput): Promise<SendResult> {
  const log = p.log ?? baseLogger;
  const to_masked = maskEmail(p.to);

  if (!emailConfigured()) {
    log.info({ to_masked, category: p.category, reason: "not_configured" }, "email.skipped");
    return { ok: false, error: "not_configured", retryable: false };
  }

  const timeoutMs = Number(process.env.EMAIL_SEND_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const from = process.env.FROM_NAME
    ? `${process.env.FROM_NAME} <${process.env.FROM_EMAIL}>`
    : process.env.FROM_EMAIL!;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        // Chave só aqui, inline — nunca dentro de objeto que vá pro logger.
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        from,
        to: p.to,
        subject: p.subject,
        html: p.html,
        text: p.text,
        tags: [{ name: "category", value: p.category }],
      }),
    });

    if (!res.ok) {
      let code = `http_${res.status}`;
      try {
        const body = (await res.json()) as { name?: string };
        if (body?.name) code = body.name;
      } catch {
        /* corpo não-JSON */
      }
      const retryable = res.status === 429 || res.status >= 500;
      log.warn({ to_masked, category: p.category, status: res.status, code }, "email.send.failure");
      return { ok: false, error: code, retryable, status: res.status };
    }

    const body = (await res.json()) as { id?: string };
    const id = body?.id ?? "";
    log.info({ to_masked, category: p.category, id }, "email.sent");
    return { ok: true, id };
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
    const reason = isTimeout ? "timeout" : "exception";
    log.warn({ to_masked, category: p.category, reason }, "email.send.failure");
    return { ok: false, error: reason, retryable: true };
  }
}
