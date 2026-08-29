-- ═══════════════════════════════════════════════════════════════════
-- AVU-07 — Reativação do alerta de validade de material via pg_cron
-- (o mesmo mecanismo que de fato funciona neste projeto, ver
-- check_cautelas_vencimento() já em produção). Porta a lógica de
-- POST /api/arsenal/validity-alerts/run pra SQL puro, corrigindo o bug de
-- fuso horário (v_hoje em horário de Brasília, não new Date() do processo
-- Node) e usando material_types.validity_alert_days com fallback pra
-- reserves.material_validity_alert_dias_padrao (não mais o literal
-- [365,180,90] hardcoded no BFF).
--
-- p_reserve_id DEFAULT NULL: NULL (chamado pelo cron, sem argumento)
-- processa todas as reservas de todos os tenants (papel de plataforma); um
-- valor real (chamado pelo endpoint AVU-08, sempre com o reserveId da
-- sessão) restringe a 1 reserva — sem isso, o botão "verificar agora" de 1
-- admin_reserva processaria as reservas de TODOS os tenants de uma vez
-- (achado CRÍTICO de code review na spec, corrigido antes de implementar).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.check_material_validade_vencimento(p_reserve_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoje date;
  v_item record;
  v_recipient uuid;
BEGIN
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  FOR v_item IN
    SELECT mi.id, mi.tenant_id, mi.current_holder_user_id, mi.validade_item,
           mt.nome AS material_nome, mt.reserve_id,
           (mi.validade_item - v_hoje) AS dias_restantes
      FROM material_items mi
      JOIN material_types mt ON mt.id = mi.material_type_id
      JOIN reserves r ON r.id = mt.reserve_id
     WHERE mi.validade_item IS NOT NULL
       AND (p_reserve_id IS NULL OR mt.reserve_id = p_reserve_id)
       AND (mi.validade_item - v_hoje) = ANY(
             COALESCE(NULLIF(mt.validity_alert_days, '{}'), r.material_validity_alert_dias_padrao)
           )
  LOOP
    INSERT INTO material_validity_alert_events (tenant_id, reserve_id, material_item_id, alert_days, validade_item)
    VALUES (v_item.tenant_id, v_item.reserve_id, v_item.id, v_item.dias_restantes, v_item.validade_item)
    ON CONFLICT (material_item_id, alert_days, validade_item) DO NOTHING;

    IF FOUND THEN
      FOR v_recipient IN
        SELECT rm.user_id FROM reserve_memberships rm
         WHERE rm.reserve_id = v_item.reserve_id AND rm.role IN ('admin_reserva', 'armeiro')
        UNION
        SELECT v_item.current_holder_user_id WHERE v_item.current_holder_user_id IS NOT NULL
      LOOP
        INSERT INTO notifications (user_id, tenant_id, type, title, body, metadata)
        VALUES (
          v_recipient, v_item.tenant_id, 'material_validity_warning',
          'Validade de material próxima',
          format('%s vence em %s dia(s) (%s)', v_item.material_nome, v_item.dias_restantes, to_char(v_item.validade_item, 'DD/MM/YYYY')),
          jsonb_build_object('material_item_id', v_item.id)
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$;

-- 11h05 UTC = 8h05 Brasília — 5min depois do cron de cautela, evita
-- contenção entre os 2 jobs.
SELECT cron.schedule(
  'material-validade-vencimento-diario',
  '5 11 * * *',
  $$SELECT public.check_material_validade_vencimento()$$
);
