-- SP4 HOTFIX (achados CRÍTICO/ALTO do review adversarial, aplicados em prod
-- minutos depois do SP4 original, migração 20260911122934):
--
-- C1 (CRÍTICO, ATIVO EM PROD): document_type='handover' é usado por DOIS
-- fluxos reais com semânticas diferentes — passagem de serviço de verdade
-- (service_handovers, handovers.ts) E assinatura de cautela
-- (cautelamentos.ts:694,792 + RPC sign_cautelamento_batch), que reusa o
-- mesmo texto 'handover' apontando pro id de uma CAUTELA. O dispatcher só
-- olhava service_handovers → RAISE em toda assinatura de cautela desde que
-- o SP4 foi aplicado. Fix: tenta service_handovers primeiro, cai pra
-- cautelamentos se não achar (mesmo texto, dois pais possíveis — a
-- correção de vocabulário real, document_type='cautelamento' dedicado, é
-- follow-up maior que não cabe num hotfix).
--
-- A1 (ALTO): os triggers não cobriam UPDATE da própria coluna reserve_id —
-- um UPDATE direto nela não re-derivava, deixando a garantia "deriva,
-- nunca confia no caller" furada pra escrita futura via RLS. Fix: inclui
-- reserve_id em UPDATE OF em todos os 7.
--
-- C3/A3 (CRÍTICO+ALTO): material_items derivava de material_types.reserve_id
-- (o CATÁLOGO — "o que o item é"), não de current_unit_id (ONDE o item está
-- fisicamente, já é reserves(id) direto). material_types.reserve_id pode ser
-- NULL ("material global", padrão usado em arsenal.ts/categories.ts/
-- lendings.ts) → RAISE em todo cadastro de item físico de material global.
-- E mesmo quando não-NULL, os dois nunca são garantidos iguais depois de
-- uma transferência (fn_validate_item_transition preserva current_unit_id
-- deliberadamente). Fix: deriva direto de NEW.current_unit_id (sem lookup —
-- já É um reserves(id)); RAISE se NULL (mesmo comportamento fail-closed).
--
-- ROLLBACK: reverte pro corpo de derive_child_reserve_id() da migração
-- 20260911122934 e pros triggers sem `, reserve_id`/`current_unit_id` no UPDATE OF.

CREATE OR REPLACE FUNCTION public.derive_child_reserve_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reserve_id uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'material_request_items' THEN
      SELECT reserve_id INTO v_reserve_id FROM public.material_requests WHERE id = NEW.request_id;
    WHEN 'service_log_events' THEN
      SELECT reserve_id INTO v_reserve_id FROM public.service_shifts WHERE id = NEW.shift_id;
    WHEN 'handover_attachments' THEN
      SELECT reserve_id INTO v_reserve_id FROM public.service_handovers WHERE id = NEW.handover_id;
    WHEN 'inventory_item_checks' THEN
      SELECT reserve_id INTO v_reserve_id FROM public.inventory_reserve_checks WHERE id = NEW.reserve_check_id;
    WHEN 'material_items' THEN
      -- C3/A3: current_unit_id JÁ é reserves(id) — sem lookup, deriva direto
      -- de onde o item está fisicamente, não do catálogo.
      v_reserve_id := NEW.current_unit_id;
    WHEN 'cautela_vencimento_alert_events' THEN
      SELECT reserve_id INTO v_reserve_id FROM public.cautelamentos WHERE id = NEW.cautela_id;
    WHEN 'document_signatures' THEN
      CASE NEW.document_type
        WHEN 'lending' THEN
          SELECT reserve_id INTO v_reserve_id FROM public.lendings WHERE id = NEW.document_id;
        WHEN 'handover' THEN
          -- C1: 'handover' é ambíguo — passagem de serviço OU cautela.
          SELECT reserve_id INTO v_reserve_id FROM public.service_handovers WHERE id = NEW.document_id;
          IF v_reserve_id IS NULL THEN
            SELECT reserve_id INTO v_reserve_id FROM public.cautelamentos WHERE id = NEW.document_id;
          END IF;
        WHEN 'inventory_reserve_check' THEN
          SELECT reserve_id INTO v_reserve_id FROM public.inventory_reserve_checks WHERE id = NEW.document_id;
        ELSE
          RAISE EXCEPTION 'derive_child_reserve_id: document_type % não suportado (document_signatures.id=%)', NEW.document_type, NEW.id;
      END CASE;
    ELSE
      RAISE EXCEPTION 'derive_child_reserve_id: tabela % não configurada no dispatcher', TG_TABLE_NAME;
  END CASE;

  IF v_reserve_id IS NULL THEN
    RAISE EXCEPTION 'derive_child_reserve_id: não foi possível derivar reserve_id em % (referência inválida ou pai sem reserve_id)', TG_TABLE_NAME;
  END IF;

  NEW.reserve_id := v_reserve_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_reserve_id ON public.material_request_items;
CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF request_id, reserve_id ON public.material_request_items
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

DROP TRIGGER IF EXISTS trg_derive_reserve_id ON public.service_log_events;
CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF shift_id, reserve_id ON public.service_log_events
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

DROP TRIGGER IF EXISTS trg_derive_reserve_id ON public.handover_attachments;
CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF handover_id, reserve_id ON public.handover_attachments
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

DROP TRIGGER IF EXISTS trg_derive_reserve_id ON public.inventory_item_checks;
CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF reserve_check_id, reserve_id ON public.inventory_item_checks
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

DROP TRIGGER IF EXISTS trg_derive_reserve_id ON public.material_items;
CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF material_type_id, current_unit_id, reserve_id ON public.material_items
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

DROP TRIGGER IF EXISTS trg_derive_reserve_id ON public.cautela_vencimento_alert_events;
CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF cautela_id, reserve_id ON public.cautela_vencimento_alert_events
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

DROP TRIGGER IF EXISTS trg_derive_reserve_id ON public.document_signatures;
CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF document_type, document_id, reserve_id ON public.document_signatures
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();
