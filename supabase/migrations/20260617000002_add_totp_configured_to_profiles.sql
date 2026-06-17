-- Add totp_configured to profiles so Next.js (CF Pages) can read TOTP status
-- without needing access to totp_secrets (service_role only).
-- The BFF updates this flag when /api/totp/setup completes successfully.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS totp_configured BOOLEAN NOT NULL DEFAULT FALSE;

-- Back-fill for existing users who already have a totp_secret row
UPDATE public.profiles p
SET totp_configured = TRUE
WHERE EXISTS (
  SELECT 1 FROM public.totp_secrets ts
  WHERE ts.user_id = p.id AND ts.enabled = TRUE
);
