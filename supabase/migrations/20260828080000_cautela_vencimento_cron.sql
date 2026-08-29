-- ═══════════════════════════════════════════════════════════════════
-- CAULC-08 — Function + pg_cron: notificação de vencimento de cautela.
-- Único mecanismo de agendamento que de fato funciona em produção neste
-- projeto (pg_cron, mesmo padrão de revoked_sessions/biometric_bridge) —
-- ver spec §2.2 sobre por que o padrão de material_validity_warning
-- (endpoint manual, nunca chamado pelo frontend) não foi copiado.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_cautelas_vencimento()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje date;
  v_cautela record;
  v_recipient uuid;
BEGIN
  -- A sessão do pg_cron roda em UTC (confirmado: current_setting('TimeZone')
  -- = 'UTC' neste projeto) — CURRENT_DATE aqui seria a data em UTC, não em
  -- Brasília, mesma classe de bug já corrigida em cautelamentos.ts:379 pro
  -- caminho da aplicação. v_hoje fica no mesmo referencial de fuso que
  -- prazo_devolucao_data (calculado em horário de Brasília na emissão).
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- "Vencendo" — 7 dias antes do prazo, 1 notificação por cautela (nunca
  -- duplicada — UNIQUE INDEX em cautela_vencimento_alert_events garante
  -- mesmo se este loop rodar 2x pra mesma cautela no mesmo dia).
  FOR v_cautela IN
    SELECT c.id, c.tenant_id, c.militar_id, c.armeiro_id, c.reserve_id,
           c.prazo_devolucao_data, mt.nome AS material_nome
      FROM cautelamentos c
      JOIN material_items mi ON mi.id = c.item_id
      JOIN material_types mt ON mt.id = mi.material_type_id
     WHERE c.status = 'ativa'
       AND c.prazo_devolucao_data = v_hoje + 7
       AND NOT EXISTS (
         SELECT 1 FROM cautela_vencimento_alert_events e
          WHERE e.cautela_id = c.id AND e.tipo_alerta = 'vencendo'
       )
  LOOP
    INSERT INTO cautela_vencimento_alert_events (cautela_id, tenant_id, tipo_alerta)
    VALUES (v_cautela.id, v_cautela.tenant_id, 'vencendo')
    -- Corrida entre 2 execuções concorrentes do cron: a 2ª bateria no
    -- UNIQUE INDEX parcial (cautela_id WHERE tipo_alerta='vencendo') — sem
    -- este ON CONFLICT, a 2ª execução abortaria a transação inteira em vez
    -- de simplesmente pular esta cautela.
    ON CONFLICT DO NOTHING;

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

  -- "Vencida" — a partir do dia seguinte ao prazo, repetida a cada 3 dias
  -- enquanto continuar ativa e vencida (não é evento único — o usuário
  -- pediu um estado contínuo visível, não um aviso que se perde no sino).
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
    INSERT INTO cautela_vencimento_alert_events (cautela_id, tenant_id, tipo_alerta)
    VALUES (v_cautela.id, v_cautela.tenant_id, 'vencida');

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
  END LOOP;
END;
$$;

-- 11h UTC = 8h America/Recife (UTC-3, sem horário de verão no Brasil
-- atualmente) — horário de expediente de fato, não madrugada.
SELECT cron.schedule(
  'cautelas-vencimento-diario',
  '0 11 * * *',
  $$SELECT public.check_cautelas_vencimento()$$
);
