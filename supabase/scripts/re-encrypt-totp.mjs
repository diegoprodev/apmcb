#!/usr/bin/env node
// Re-encrypts legacy plaintext TOTP secrets (Base32) with AES-256-GCM.
// Run once after deploying crypto.ts integration. Safe to re-run (idempotent).
//
// Usage:
//   TOTP_ENCRYPTION_KEY=<key> DATABASE_URL=<psql-url> node re-encrypt-totp.mjs
//
// Or with pnpm from repo root:
//   TOTP_ENCRYPTION_KEY=<key> DATABASE_URL=<psql-url> pnpm --filter supabase re-encrypt-totp

import postgres from "postgres";

const ENC_PREFIX = "v1:";
const ALGO = "AES-GCM";
const IV_LEN = 12;
const KEY_LEN = 256;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_HASH = "SHA-256";
const SALT = new TextEncoder().encode("apmcb-totp-v1");

async function deriveKey(appKey) {
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
    ["encrypt"],
  );
}

async function encryptSecret(plaintext, appKey) {
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

const TOTP_KEY = process.env.TOTP_ENCRYPTION_KEY;
const DB_URL = process.env.DATABASE_URL;

if (!TOTP_KEY) { console.error("TOTP_ENCRYPTION_KEY ausente"); process.exit(1); }
if (!DB_URL)   { console.error("DATABASE_URL ausente"); process.exit(1); }

const sql = postgres(DB_URL, { ssl: "require", max: 1 });

try {
  const rows = await sql`SELECT id, secret FROM totp_secrets WHERE secret NOT LIKE 'v1:%'`;
  console.log(`Encontrados ${rows.length} secret(s) legados para re-encriptar.`);

  let updated = 0;
  for (const row of rows) {
    const encrypted = await encryptSecret(row.secret, TOTP_KEY);
    await sql`UPDATE totp_secrets SET secret = ${encrypted} WHERE id = ${row.id}`;
    updated++;
    process.stdout.write(`\r  Progresso: ${updated}/${rows.length}`);
  }

  console.log(`\nConcluído. ${updated} secret(s) re-encriptados.`);
} finally {
  await sql.end();
}
