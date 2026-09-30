import type { Context } from "hono";
import { baseLogger } from "./logger.ts";
import type { HonoVariables } from "../types/hono.ts";

// Regra do CLAUDE.md ("Debug — sempre pelo BFF primeiro"): toda negação,
// bloqueio ou falha de validação deixa rastro no log do BFF. Achado real
// (2026-09-24): a saída por digital falhava com 409 e o `docker logs` não
// mostrava nada, porque os ramos de recusa respondiam sem logar.

const MAX_DETAIL = 200;
// Exceções das RPCs começam por um código fixo (LENDING_*, BIOMETRIC_*).
// Quando existe, só ele vai ao log: um RAISE futuro que interpole dado
// pessoal depois do código não vaza. Exige "_" e um separador depois, para
// uma sigla comum no início ("TOTP inválido") não ser tomada por código.
const ERROR_CODE_PREFIX = /^[A-Z][A-Z0-9]*_[A-Z0-9_]+(?=:|\s|$)/;

/** Logger da requisição, com fallback para o base — nunca undefined. */
export function routeLog(c: Context<{ Variables: HonoVariables }>) {
  return c.get("log") ?? baseLogger;
}

export function rejectionDetail(detail: string): string {
  return detail.match(ERROR_CODE_PREFIX)?.[0] ?? detail.slice(0, MAX_DETAIL);
}

/**
 * Loga uma recusa como `warn` estruturado. `context` leva só motivo e ids —
 * nunca nome, matrícula, CPF nem segredo. Sem logger no contexto (rota
 * montada sem request-id), cai no logger base: a recusa nunca some.
 */
export function logRejection(
  c: Context<{ Variables: HonoVariables }>,
  event: string,
  context: Record<string, unknown>,
  detail?: string | null,
): void {
  routeLog(c).warn(detail ? { ...context, detail: rejectionDetail(detail) } : context, event);
}

/**
 * Falha interna (5xx) com o mesmo fallback de logger — mesma assinatura do
 * pino (`obj, msg`), para substituir `c.get("log").error(...)` sem risco de
 * TypeError nem de log descartado quando falta o logger do contexto.
 */
export function logFailure(
  c: Context<{ Variables: HonoVariables }>,
  context: Record<string, unknown>,
  event: string,
): void {
  routeLog(c).error(context, event);
}
