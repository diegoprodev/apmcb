-- Função atômica para inserir eventos no Livro Digital.
-- Serializa acessos concorrentes ao mesmo turno via SELECT FOR UPDATE no service_shifts,
-- eliminando a race condition no encadeamento de hashes.
-- Recebe happened_at como TEXT (ISO 8601) para garantir que o hash seja idêntico
-- ao que seria computado pelo TypeScript (mesma representação de string).
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
