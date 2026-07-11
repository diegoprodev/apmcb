-- Expande status_operacional para cobrir ocorrências de dano/perda com mais
-- precisão (pedido do dono do projeto, domínio de reserva de armamento):
-- avariado (dano reportado, aguardando triagem), furtado (perda criminosa,
-- distinta de extraviado), em_pericia (investigação técnica/formal, ex: pós
-- incidente com arma de fogo), bloqueado (retenção administrativa/comando),
-- em_transito (transferência física entre reservas), aguardando_baixa
-- (triagem concluída, aguardando trâmite formal antes de baixado).
--
-- NOTA: não havia CHECK constraint em produção para esta coluna (a coluna é
-- TEXT livre) — a migration original (20260620000001b_material_items.sql)
-- tinha o CHECK inline, mas nunca chegou a ser aplicado/persistiu em
-- produção. Esta migration cria o constraint pela primeira vez, já com o
-- conjunto expandido.

ALTER TABLE material_items
  ADD CONSTRAINT material_items_status_operacional_check
  CHECK (status_operacional IN (
    'disponivel', 'em_saida', 'cautelado',
    'avariado', 'manutencao', 'extraviado', 'furtado',
    'em_pericia', 'bloqueado', 'em_transito', 'aguardando_baixa',
    'baixado', 'inapto'
  ));

-- Atualiza a trigger de transição: todos os estados-problema (não só os 4
-- originais) devem bloquear nova saída/cautela até regularização.
CREATE OR REPLACE FUNCTION public.fn_validate_item_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  -- Sem mudança de estado: passa direto
  IF OLD.status_operacional = NEW.status_operacional THEN
    RETURN NEW;
  END IF;

  -- REGRA CENTRAL: em_saida e cautelado só podem vir de disponivel
  IF NEW.status_operacional IN ('em_saida', 'cautelado')
     AND OLD.status_operacional <> 'disponivel'
  THEN
    RAISE EXCEPTION
      'POSSE_DUPLA_BLOQUEADA: item % está em estado "%" e não pode assumir "%". '
      'Registre a devolução/encerramento antes de nova saída ou cautela.',
      NEW.id, OLD.status_operacional, NEW.status_operacional
    USING ERRCODE = 'P0001';
  END IF;

  -- Estados finais/problema bloqueiam saída e cautela
  IF OLD.status_operacional IN (
       'avariado','manutencao','extraviado','furtado',
       'em_pericia','bloqueado','em_transito','aguardando_baixa',
       'baixado','inapto'
     )
     AND NEW.status_operacional IN ('em_saida','cautelado')
  THEN
    RAISE EXCEPTION
      'OPERACAO_INVALIDA: item % está em estado "%" e precisa ser regularizado '
      'antes de qualquer saída ou cautela.',
      NEW.id, OLD.status_operacional
    USING ERRCODE = 'P0002';
  END IF;

  -- Ao voltar para disponivel: limpar cache de posse ativa
  IF NEW.status_operacional = 'disponivel' THEN
    NEW.current_holder_user_id := NULL;
    NEW.active_lending_id      := NULL;
    NEW.active_cautelamento_id := NULL;
    -- current_unit_id preservado (última unidade que possuiu o item)
  END IF;

  NEW.last_movement_at := now();
  NEW.updated_at       := now();
  RETURN NEW;
END;
$function$;
