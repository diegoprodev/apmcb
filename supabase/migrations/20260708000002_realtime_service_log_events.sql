-- Adiciona service_log_events e service_shifts à publication do Supabase Realtime.
-- Necessário para que o livro digital receba atualizações em tempo real.
ALTER TABLE public.service_log_events REPLICA IDENTITY FULL;
ALTER TABLE public.service_shifts REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_log_events', 'service_shifts'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
