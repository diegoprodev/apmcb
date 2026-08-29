-- ═══════════════════════════════════════════════════════════════════
-- Achado ALTO de code review (implementação de CAULC-08): o ramo "vencida"
-- de check_cautelas_vencimento() não tinha proteção real contra duplicata
-- (só o NOT EXISTS na query, sem constraint no banco) — ao contrário do
-- ramo "vencendo", que já tinha um UNIQUE INDEX parcial + ON CONFLICT DO
-- NOTHING. Duas execuções concorrentes da function (chamada manual de QA
-- sobrepondo o schedule, reexecução acidental) podiam ambas passar no
-- NOT EXISTS antes de qualquer uma commitar, duplicando notificação
-- "vencida" pra militar+armeiro+admin_reserva.
--
-- Fix: coluna `alerta_dia` (data em horário de Brasília do momento do
-- alerta, calculada pela function — nunca CURRENT_DATE, que seria UTC) +
-- 1 único UNIQUE INDEX (cautela_id, tipo_alerta, alerta_dia) cobrindo os
-- 2 tipos de alerta — substitui o índice parcial anterior, que só cobria
-- "vencendo".
-- ═══════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS idx_cautela_vencimento_alert_vencendo_unico;

ALTER TABLE public.cautela_vencimento_alert_events
  ADD COLUMN IF NOT EXISTS alerta_dia date NOT NULL DEFAULT CURRENT_DATE;

-- DEFAULT CURRENT_DATE só existe pra permitir o ADD COLUMN em linhas já
-- existentes (nenhuma linha real deve existir ainda nesta tabela nova) —
-- todo INSERT novo (via check_cautelas_vencimento, atualizada abaixo)
-- sempre informa alerta_dia explicitamente em horário de Brasília.

CREATE UNIQUE INDEX IF NOT EXISTS idx_cautela_vencimento_alert_dia_unico
  ON public.cautela_vencimento_alert_events (cautela_id, tipo_alerta, alerta_dia);

CREATE OR REPLACE FUNCTION public.check_cautelas_vencimento()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje date;
  v_cautela record;
  v_recipient uuid;
BEGIN
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  FOR v_cautela IN
    SELECT c.id, c.tenant_id, c.militar_id, c.armeiro_id, c.reserve_id,
           c.prazo_devolucao_data, mt.nome AS material_nome
      FROM cautelamentos c
      JOIN material_items mi ON mi.id = c.item_id
      JOIN material_types mt ON mt.id = mi.material_type_id
     WHERE c.status = 'ativa'
       AND c.prazo_devolucao_data = v_hoje + 7
  LOOP
    INSERT INTO cautela_vencimento_alert_events (cautela_id, tenant_id, tipo_alerta, alerta_dia)
    VALUES (v_cautela.id, v_cautela.tenant_id, 'vencendo', v_hoje)
    ON CONFLICT (cautela_id, tipo_alerta, alerta_dia) DO NOTHING;

    IF FOUND THEN
      FOR v_recipient IN
        SELECT v_cautela.militar_id
        UNION
        SELECT v_cautela.armeiro_id
        UNION
        SELECT rm.user_id FROM reserve_memberships rm
         WHERE rm.reserve_id = v_cautela.reserve_id AND rm.role = 'admin_reserva'
      LOOP
        INSERT INTO notifications (user_id, tenant_id, type, title, body, metadata)
        VALUES (
          v_recipient, v_cautela.tenant_id, 'cautela_vencendo',
          'Cautela vencendo em breve',
          format('%s vence em 7 dias (%s)', v_cautela.material_nome, to_char(v_cautela.prazo_devolucao_data, 'DD/MM/YYYY')),
          jsonb_build_object('cautelamento_id', v_cautela.id)
        );
      END LOOP;
    END IF;
  END LOOP;

  -- "Vencida" — a partir do dia seguinte, repetida a cada 3 dias enquanto
  -- continuar ativa e vencida. `alerta_dia = v_hoje` no INSERT + o mesmo
  -- UNIQUE INDEX de cima agora protege este ramo também: 2 execuções da
  -- function no MESMO dia (concorrentes ou reexecução) nunca duplicam a
  -- notificação de hoje, mesmo que ambas passem pelo NOT EXISTS antes de
  -- qualquer uma commitar.
  FOR v_cautela IN
    SELECT c.id, c.tenant_id, c.militar_id, c.armeiro_id, c.reserve_id,
           c.prazo_devolucao_data, mt.nome AS material_nome
      FROM cautelamentos c
      JOIN material_items mi ON mi.id = c.item_id
      JOIN material_types mt ON mt.id = mi.material_type_id
     WHERE c.status = 'ativa'
       AND c.prazo_devolucao_data < v_hoje
       AND NOT EXISTS (
         SELECT 1 FROM cautela_vencimento_alert_events e
          WHERE e.cautela_id = c.id AND e.tipo_alerta = 'vencida'
            AND e.created_at > now() - interval '3 days'
       )
  LOOP
    INSERT INTO cautela_vencimento_alert_events (cautela_id, tenant_id, tipo_alerta, alerta_dia)
    VALUES (v_cautela.id, v_cautela.tenant_id, 'vencida', v_hoje)
    ON CONFLICT (cautela_id, tipo_alerta, alerta_dia) DO NOTHING;

    IF FOUND THEN
      FOR v_recipient IN
        SELECT v_cautela.militar_id
        UNION
        SELECT v_cautela.armeiro_id
        UNION
        SELECT rm.user_id FROM reserve_memberships rm
         WHERE rm.reserve_id = v_cautela.reserve_id AND rm.role = 'admin_reserva'
      LOOP
        INSERT INTO notifications (user_id, tenant_id, type, title, body, metadata)
        VALUES (
          v_recipient, v_cautela.tenant_id, 'cautela_vencida',
          'Cautela vencida',
          format('%s está vencida desde %s', v_cautela.material_nome, to_char(v_cautela.prazo_devolucao_data, 'DD/MM/YYYY')),
          jsonb_build_object('cautelamento_id', v_cautela.id)
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
