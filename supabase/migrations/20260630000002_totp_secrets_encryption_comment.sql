-- Task C3: documentar que a coluna `secret` passou a armazenar ciphertext AES-256-GCM
-- Formato: "v1:<base64(iv||ciphertext||authTag)>" para secrets novos;
--           Base32 plaintext para secrets legados (re-encriptar com re-encrypt-totp.mjs)
COMMENT ON COLUMN totp_secrets.secret IS
  'AES-256-GCM encrypted TOTP seed. Format: v1:<base64> (new) or Base32 plaintext (legacy). '
  'Run supabase/scripts/re-encrypt-totp.mjs to migrate legacy values.';
