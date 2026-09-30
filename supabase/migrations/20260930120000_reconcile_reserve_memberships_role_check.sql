-- R-22 (docs/auditoria/EVIDENCE_R22.md): formaliza no repositório o CHECK de
-- public.reserve_memberships.role que já está em produção.
--
-- 20260620000001_multitenant_foundation criou o CHECK inline (nome gerado
-- pelo Postgres: reserve_memberships_role_check) só com os papéis de staff.
-- O SP2 passou a gravar role='usuario' e produção foi alterada fora do
-- histórico de migrations (introspecção read-only de 2026-09-30:
-- CHECK (role = ANY (ARRAY['admin_reserva','armeiro','auditor_reserva','usuario']))).
-- Um ambiente recriado a partir do repositório rejeitaria memberships 'usuario'.
--
-- Um único bloco (atômico mesmo fora de transação explícita):
--  - se o CHECK já tem exatamente a definição esperada e não há outro CHECK
--    sobre `role` (estado de produção), não faz nada — sem lock;
--  - senão trava a tabela (lock_timeout 5s) e, já sob o lock:
--    falha se existir role fora do conjunto (nada é convertido nem apagado),
--    falha se houver outro CHECK sobre `role` com nome diferente (drift),
--    e troca DROP+ADD num só ALTER TABLE.
-- Não altera dados, FKs, UNIQUE, RLS, policies nem tenants.reserve_isolation_enabled.

DO $$
DECLARE
  v_allowed  constant text[] := ARRAY['admin_reserva', 'armeiro', 'auditor_reserva', 'usuario'];
  v_in_list  text := (SELECT string_agg(quote_literal(r), ', ') FROM unnest(v_allowed) r);
  v_expected text := 'CHECK ((role = ANY (ARRAY['
                     || (SELECT string_agg(quote_literal(r) || '::text', ', ') FROM unnest(v_allowed) r)
                     || '])))';
  v_current  text;
  v_invalid  text;
  v_other    text;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  SELECT pg_get_constraintdef(oid) INTO v_current
    FROM pg_constraint
   WHERE conrelid = 'public.reserve_memberships'::regclass
     AND conname = 'reserve_memberships_role_check';
  SELECT string_agg(c.conname, ', ') INTO v_other
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'role'
   WHERE c.conrelid = 'public.reserve_memberships'::regclass
     AND c.contype = 'c'
     AND c.conname <> 'reserve_memberships_role_check'
     AND a.attnum = ANY (c.conkey);
  IF v_current = v_expected AND v_other IS NULL THEN
    RAISE NOTICE 'R-22: reserve_memberships_role_check já está correto; nada a fazer';
    RETURN;
  END IF;

  -- Checagens abaixo rodam sob o lock: nenhuma escrita/DDL concorrente entre
  -- a validação e o ALTER.
  LOCK TABLE public.reserve_memberships IN ACCESS EXCLUSIVE MODE;

  SELECT string_agg(DISTINCT quote_literal(role), ', ') INTO v_invalid
    FROM public.reserve_memberships
   WHERE NOT (role = ANY (v_allowed));
  IF v_invalid IS NOT NULL THEN
    RAISE EXCEPTION 'R-22: reserve_memberships contém role fora do conjunto permitido: %', v_invalid;
  END IF;

  SELECT string_agg(c.conname, ', ') INTO v_other
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = 'role'
   WHERE c.conrelid = 'public.reserve_memberships'::regclass
     AND c.contype = 'c'
     AND c.conname <> 'reserve_memberships_role_check'
     AND a.attnum = ANY (c.conkey);
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'R-22: CHECK inesperado sobre reserve_memberships.role: %', v_other;
  END IF;

  EXECUTE format(
    'ALTER TABLE public.reserve_memberships
       DROP CONSTRAINT IF EXISTS reserve_memberships_role_check,
       ADD CONSTRAINT reserve_memberships_role_check CHECK (role IN (%s))',
    v_in_list);
END
$$;
