-- ═══════════════════════════════════════════════════════════════════
-- AVU-06 — check_cautelas_vencimento() passa a usar a configuração real da
-- reserva (reserves.cautela_alert_dias_antes) em vez do literal "7", muda
-- "vencida" de a cada 3 dias pra todo dia, e respeita snooze/silenciar por
-- cautela.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_cautelas_vencimento()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje date;
  v_cautela record;
  v_recipient uuid;
BEGIN
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- "Vencendo" — agora por marco configurável na reserva (array), não mais
  -- um único "7" fixo. Um alerta por marco que bater (mesmo padrão de
  -- material_validity_alert_days).
  FOR v_cautela IN
    SELECT c.id, c.tenant_id, c.militar_id, c.armeiro_id, c.reserve_id,
           c.prazo_devolucao_data, mt.nome AS material_nome,
           (c.prazo_devolucao_data - v_hoje) AS dias_restantes
      FROM cautelamentos c
      JOIN material_items mi ON mi.id = c.item_id
      JOIN material_types mt ON mt.id = mi.material_type_id
      JOIN reserves r ON r.id = c.reserve_id
     WHERE c.status = 'ativa'
       AND NOT c.vencimento_silenciado
       AND (c.vencimento_snooze_until IS NULL OR c.vencimento_snooze_until < v_hoje)
       AND (c.prazo_devolucao_data - v_hoje) = ANY(r.cautela_alert_dias_antes)
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
          format('%s vence em %s dia(s) (%s)', v_cautela.material_nome, v_cautela.dias_restantes, to_char(v_cautela.prazo_devolucao_data, 'DD/MM/YYYY')),
          jsonb_build_object('cautelamento_id', v_cautela.id)
        );
      END LOOP;
    END IF;
  END LOOP;

  -- "Vencida" — agora TODO DIA (não mais a cada 3 dias — pedido explícito
  -- do usuário), respeitando snooze/silenciar. Dedupe só por `alerta_dia`
  -- (já é 1 linha por dia via o UNIQUE INDEX existente), sem o filtro de
  -- "3 dias" que existia antes.
  FOR v_cautela IN
    SELECT c.id, c.tenant_id, c.militar_id, c.armeiro_id, c.reserve_id,
           c.prazo_devolucao_data, mt.nome AS material_nome
      FROM cautelamentos c
      JOIN material_items mi ON mi.id = c.item_id
      JOIN material_types mt ON mt.id = mi.material_type_id
     WHERE c.status = 'ativa'
       AND NOT c.vencimento_silenciado
       AND (c.vencimento_snooze_until IS NULL OR c.vencimento_snooze_until < v_hoje)
       AND c.prazo_devolucao_data < v_hoje
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
