-- Enable Realtime for audit_logs so the /nexus dashboard receives live events.
-- REPLICA IDENTITY FULL includes old and new row data in CDC payloads;
-- for INSERT-only tables (audit_logs is immutable) this is a no-op for old values
-- but is required by Supabase Realtime's row-level security enforcement.
ALTER TABLE public.audit_logs REPLICA IDENTITY FULL;

-- Add audit_logs to the realtime publication if not already present.
-- Supabase creates 'supabase_realtime' publication by default.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'audit_logs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_logs;
  END IF;
END
$$;
