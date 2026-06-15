-- TOTP anti-replay: store last accepted token per user
-- Prevents reuse of the same 6-digit code within the same 30s window.
ALTER TABLE public.totp_secrets
  ADD COLUMN IF NOT EXISTS last_used_token TEXT;
