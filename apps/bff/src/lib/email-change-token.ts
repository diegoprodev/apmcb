import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";

// Token de confirmação de troca de e-mail (spec:
// docs/enterprise/specs/troca-email-acesso-enterprise.md §4). O token BRUTO
// só existe em memória e na URL do e-mail enviado; o que persiste em
// `pending_email_changes.token_hash` é o HMAC-SHA256 — mesma disciplina de
// nunca guardar segredo em texto puro já usada em totp_secrets (encryptSecret/
// decryptSecret) e no hashed_token de recovery link do GoTrue.
//
// 32 bytes aleatórios = 256 bits de entropia — inviável de adivinhar por
// força bruta mesmo sem rate limit no endpoint de confirmação (que é público,
// sem sessão, por design).

const TOKEN_BYTES = 32;

function hmacKey(): string {
  const key = process.env.EMAIL_CHANGE_TOKEN_SECRET;
  if (!key) throw new Error("EMAIL_CHANGE_TOKEN_SECRET não configurado");
  return key;
}

export function generateEmailChangeToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashEmailChangeToken(rawToken: string): string {
  return createHmac("sha256", hmacKey()).update(rawToken).digest("hex");
}

// Comparação em tempo constante — evita timing attack no endpoint público de
// confirmação (um atacante medindo latência de respostas não pode inferir
// quantos bytes do hash acertou).
export function verifyEmailChangeToken(rawToken: string, storedHash: string): boolean {
  const computed = Buffer.from(hashEmailChangeToken(rawToken), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}
