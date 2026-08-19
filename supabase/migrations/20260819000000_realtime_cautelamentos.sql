-- Adiciona cautelamentos à publication do Supabase Realtime.
-- Achado real (docs/enterprise/specs/cautela-sign-ux-realtime-enterprise.md):
-- sem isto, /reserva/cautelas e /efetivo/minhas-cautelas nunca recebiam
-- eventos de mudança em tempo real (assinatura, devolução, substituição)
-- mesmo depois de apps/bff/src/routes/realtime.ts passar a assinar a
-- tabela — o canal SSE do BFF só consegue repassar o que o Postgres
-- publica; sem a tabela na publication, nenhum evento é emitido, e o
-- código do BFF nunca vê nada pra encaminhar. Mesmo padrão já usado para
-- service_log_events/service_shifts em 20260708000002.
ALTER TABLE public.cautelamentos REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cautelamentos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cautelamentos;
  END IF;
END $$;
