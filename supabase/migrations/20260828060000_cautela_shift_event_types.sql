-- ═══════════════════════════════════════════════════════════════════
-- CAULC-06 — Novos tipos de evento do Livro Digital para o ciclo de vida
-- da cautela (assinatura, cancelamento, edição). Achado durante a
-- implementação (não estava na spec original): `service_log_events` tem
-- um CHECK constraint espelhando o union TypeScript `ShiftEventType`
-- (apps/bff/src/lib/shift-events.ts) — os dois precisam ser estendidos
-- juntos, ou o INSERT falha no banco mesmo com o TS compilando limpo.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.service_log_events
  DROP CONSTRAINT service_log_events_event_type_check;

ALTER TABLE public.service_log_events
  ADD CONSTRAINT service_log_events_event_type_check
    CHECK (event_type = ANY (ARRAY[
      'turno_assumido'::text, 'cautela_emitida'::text, 'cautela_devolvida'::text,
      'saida_autorizada'::text, 'saida_devolvida'::text, 'ocorrencia_registrada'::text,
      'solicitacao_aprovada'::text, 'solicitacao_negada'::text, 'inventario_divergencia'::text,
      'turno_encerrado'::text, 'evento_manual'::text,
      'cautela_assinada'::text, 'cautela_cancelada'::text, 'cautela_editada'::text
    ]));
