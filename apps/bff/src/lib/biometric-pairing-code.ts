import { createHmac, randomInt } from "node:crypto";

/**
 * Código de pareamento one-time do bridge Windows (Phase 1B). Alfabeto
 * Crockford Base32-like (sem I/L/O/U — evita ambiguidade visual ao digitar
 * no bridge), 8 caracteres úteis após o prefixo fixo = 40 bits de entropia,
 * suficiente contra brute force dentro do TTL de 10 minutos mesmo a taxas
 * generosas (ajuste de auditoria L1).
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

function randomSegment(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

export function generatePairingCode(): string {
  return `APMCB-${randomSegment(4)}-${randomSegment(4)}`;
}

/**
 * Hash com pepper server-side — o código nunca é armazenado em texto puro
 * (nem mesmo temporariamente em log). BIOMETRIC_PAIRING_CODE_PEPPER é
 * obrigatória; sem ela, todo pareamento falharia fechado (fail-closed).
 */
export function hashPairingCode(code: string): string {
  const pepper = process.env.BIOMETRIC_PAIRING_CODE_PEPPER;
  if (!pepper) {
    throw new Error("BIOMETRIC_PAIRING_CODE_PEPPER não configurada");
  }
  return createHmac("sha256", pepper).update(code.toUpperCase().trim(), "utf8").digest("hex");
}
