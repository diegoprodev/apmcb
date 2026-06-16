-- Allow authenticated users to check if their own TOTP is configured.
-- The cadete page selects only "id" (never secret), so exposing row existence is safe.
-- Secret column remains accessible only via service_role through the BFF.
CREATE POLICY totp_owner_read_status ON public.totp_secrets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
