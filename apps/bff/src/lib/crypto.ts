// SRP: encriptação/decriptação de secrets sensíveis (TOTP seeds).
// Usa AES-256-GCM via crypto.subtle (nativo Node 18+, zero dependências).
// Formato do ciphertext: base64(iv[12 bytes] || ciphertext || authTag[16 bytes])

const ALGO = "AES-GCM";
const IV_LEN = 12; // 96-bit IV — recomendado para GCM
const KEY_LEN = 256;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const SALT = new TextEncoder().encode("apmcb-totp-v1"); // contexto fixo — nunca muda

async function deriveKey(appKey: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appKey).slice(0, 32),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: SALT, iterations: PBKDF2_ITERATIONS, hash: PBKDF2_HASH },
    raw,
    { name: ALGO, length: KEY_LEN },
    false,
    ["encrypt", "decrypt"],
  );
}

// Prefixo de versão — distingue ciphertext de plaintext legacy sem precisar de coluna extra.
// Secrets sem prefixo são Base32 plaintext (criados antes desta migração).
const ENC_PREFIX = "v1:";

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

export async function encryptSecret(plaintext: string, appKey: string): Promise<string> {
  const key = await deriveKey(appKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(IV_LEN + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LEN);
  return ENC_PREFIX + Buffer.from(combined).toString("base64");
}

export async function decryptSecret(encoded: string, appKey: string): Promise<string> {
  if (!encoded.startsWith(ENC_PREFIX)) {
    // Legacy plaintext Base32 — retornar como está durante período de transição
    return encoded;
  }
  const key = await deriveKey(appKey);
  const combined = Buffer.from(encoded.slice(ENC_PREFIX.length), "base64");
  if (combined.byteLength <= IV_LEN) throw new Error("Ciphertext inválido");
  const iv = combined.subarray(0, IV_LEN);
  const ciphertext = combined.subarray(IV_LEN);
  const plaintext = await crypto.subtle.decrypt({ name: ALGO, iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
