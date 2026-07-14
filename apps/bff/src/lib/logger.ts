import pino from "pino";

// ─── Redaction (REP10): campos que NUNCA podem aparecer em log ──────────────
// Cobre headers HTTP (access log da Fase C) e campos de payload em 1º e 2º
// nível. Pino não suporta wildcard profundo (**) — payloads de log devem ser
// PLANOS: logar campos escolhidos, nunca objetos inteiros do Supabase/request.
export const REDACT_PATHS = [
  // Headers (objetos req/res serializados no access log)
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  // Segredos e credenciais — 1º e 2º nível
  ...["token", "otp", "secret", "password", "senha",
      "access_token", "refresh_token", "csrfToken",
      "pendingTotpSecret", "template_data", "last_used_token",
      "bridge_signature", "public_key", "private_key",
      "raw_fingerprint", "template_hash", "encrypted_template_data",
      "authorization", "cookie"].flatMap((k) => [k, `*.${k}`]),
];

// Opções exportadas separadamente (não só a instância) para permitir testes
// unitários construírem um pino apontado para um stream em memória, em vez
// de depender de capturar o stdout real do processo.
export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  base: { service: "apmcb-bff", env: process.env.NODE_ENV ?? "production" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) }, // "level":"warn" (compat com formato atual)
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
};

export const baseLogger = pino(loggerOptions);
// SEM transport: NDJSON síncrono para stdout — transports do pino usam
// worker threads, historicamente instáveis em Bun. Em dev, pretty-print
// via pipe externo: `bun run dev | npx pino-pretty`.

export type Logger = pino.Logger;

// ─── Masking helpers para PII (usar no ponto de log, nunca logar PII crua) ──
/** "1234567" → "*****67" — mantém 2 últimos dígitos para triagem de suporte */
export function maskMatricula(matricula: string | null | undefined): string {
  if (!matricula) return "";
  return matricula.length <= 2 ? "**" : "*".repeat(matricula.length - 2) + matricula.slice(-2);
}

/** "João da Silva Sauro" → "João S." */
export function maskNome(nome: string | null | undefined): string {
  if (!nome) return "";
  const parts = nome.trim().split(/\s+/);
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ─── API retrocompatível (mesma assinatura do logger antigo: msg primeiro) ──
export const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => baseLogger.debug(data ?? {}, msg),
  info:  (msg: string, data?: Record<string, unknown>) => baseLogger.info(data ?? {}, msg),
  warn:  (msg: string, data?: Record<string, unknown>) => baseLogger.warn(data ?? {}, msg),
  error: (msg: string, data?: Record<string, unknown>) => baseLogger.error(data ?? {}, msg),
  fatal: (msg: string, data?: Record<string, unknown>) => baseLogger.fatal(data ?? {}, msg),
};
