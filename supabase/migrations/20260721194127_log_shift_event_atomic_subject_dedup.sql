-- Deduplicação defensiva em log_shift_event_atomic.
--
-- Achado de code review (2026-07-21, junto com o fix de POST /api/lendings/batch
-- e /bulk-return não chamarem logShiftEvent): as rotas de custódia que criam
-- lendings/devoluções são idempotentes por movement_id/operation_id — um retry
-- legítimo do MESMO movement_id (rede caiu, duplo-clique) reusa o resultado já
-- persistido em vez de inserir de novo (ver record_lending_batch/returns,
-- 20260714000010_lending_rpcs_totp_claim_consumption.sql). A chamada a
-- logShiftEvent no BFF, porém, roda incondicionalmente após qualquer resposta
-- de sucesso da RPC — inclusive nesse caminho de replay — o que geraria uma
-- SEGUNDA entrada no Livro Digital (hash-encadeado, imutável) para a mesma
-- operação de negócio.
--
-- Fix: quando subject_id é informado, log_shift_event_atomic passa a checar
-- se já existe um evento com o mesmo (shift_id, subject_id, subject_type,
-- event_type) antes de inserir — se sim, é um replay da mesma operação e o
-- insert vira no-op. Isso é seguro para todos os chamadores existentes:
-- cautelamentos.ts e ocorrencias.ts sempre passam um subject_id recém-criado
-- (cautela.id / ocorrencia.id), que nunca colide entre chamadas distintas —
-- então o dedup nunca encontra correspondência para eles, comportamento
-- idêntico ao anterior. Eventos sem subject_id (ex: evento_manual, turno_assumido,
-- turno_encerrado) não são afetados pelo dedup.
CREATE OR REPLACE FUNCTION log_shift_event_atomic(
  p_id          uuid,
  p_shift_id    uuid,
  p_tenant_id   uuid,
  p_happened_at text,
  p_event_type  text,
  p_actor_id    uuid,
  p_subject_id  uuid,
  p_subject_type text,
  p_description  text,
  p_metadata     jsonb,
  p_is_pending   boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev_hash  text;
  v_input      text;
  v_event_hash text;
BEGIN
  -- Bloqueia a linha do turno para serializar inserts concorrentes no mesmo turno
  PERFORM id FROM service_shifts WHERE id = p_shift_id FOR UPDATE;

  -- Replay idempotente: já existe um evento para este exato (turno, subject,
  -- subject_type, tipo)? Se sim, a operação de negócio já foi registrada —
  -- não duplica o Livro Digital.
  IF p_subject_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM service_log_events
     WHERE shift_id = p_shift_id
       AND subject_id = p_subject_id
       AND subject_type IS NOT DISTINCT FROM p_subject_type
       AND event_type = p_event_type
  ) THEN
    RETURN;
  END IF;

  -- Obtém o hash do último evento para encadear (ordenação por happened_at + id para estabilidade)
  SELECT event_hash INTO v_prev_hash
  FROM service_log_events
  WHERE shift_id = p_shift_id
  ORDER BY happened_at DESC, id DESC
  LIMIT 1;

  -- Computa o hash usando a mesma fórmula do TypeScript:
  -- `${id}${shiftId}${happenedAt}${eventType}${description}${prevHash ?? "genesis"}`
  v_input := p_id::text
          || p_shift_id::text
          || p_happened_at
          || p_event_type
          || p_description
          || COALESCE(v_prev_hash, 'genesis');

  v_event_hash := encode(sha256(v_input::bytea), 'hex');

  INSERT INTO service_log_events (
    id, shift_id, tenant_id, happened_at, event_type, actor_id,
    subject_id, subject_type, description, metadata, is_pending,
    prev_hash, event_hash
  ) VALUES (
    p_id,
    p_shift_id,
    p_tenant_id,
    p_happened_at::timestamptz,
    p_event_type,
    p_actor_id,
    p_subject_id,
    p_subject_type,
    p_description,
    p_metadata,
    p_is_pending,
    v_prev_hash,
    v_event_hash
  );
END;
$$;

-- Garante que somente o service role (BFF) pode invocar esta função
REVOKE ALL ON FUNCTION log_shift_event_atomic FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_shift_event_atomic TO service_role;
