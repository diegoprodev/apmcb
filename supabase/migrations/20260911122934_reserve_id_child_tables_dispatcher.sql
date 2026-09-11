-- SP4 do isolamento por reserva — reserve_id nas 7 tabelas-filho + 1 trigger
-- dispatcher que DERIVA (não confia no caller). Ver
-- docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.5 [v8].
--
-- Pré-condições confirmadas em prod (2026-09-11, não por suposição):
--   - as 6 filhas não-polimórficas JÁ TÊM FK pro pai (SP4 não adiciona FK nenhuma)
--   - as 7 tabelas + document_signatures estão VAZIAS (clean-slate 2026-09-10)
--     → NOT NULL direto na coluna nova, sem NOT VALID/VALIDATE faseado
--
-- ROLLBACK:
--   drop trigger if exists trg_derive_reserve_id on public.material_request_items;
--   drop trigger if exists trg_derive_reserve_id on public.service_log_events;
--   drop trigger if exists trg_derive_reserve_id on public.handover_attachments;
--   drop trigger if exists trg_derive_reserve_id on public.inventory_item_checks;
--   drop trigger if exists trg_derive_reserve_id on public.material_items;
--   drop trigger if exists trg_derive_reserve_id on public.cautela_vencimento_alert_events;
--   drop trigger if exists trg_derive_reserve_id on public.document_signatures;
--   drop function if exists public.derive_child_reserve_id();
--   alter table public.material_request_items drop column reserve_id;
--   alter table public.service_log_events drop column reserve_id;
--   alter table public.handover_attachments drop column reserve_id;
--   alter table public.inventory_item_checks drop column reserve_id;
--   alter table public.material_items drop column reserve_id;
--   alter table public.cautela_vencimento_alert_events drop column reserve_id;
--   alter table public.document_signatures drop column reserve_id;

-- ── 1. Colunas (NOT NULL direto — tabelas vazias, ver header) ──────────────
-- Correção (achado M3 do review, o comentário original contradizia o código
-- abaixo): reserve_id EM TODAS as 7, inclusive material_items e
-- document_signatures, tem sim REFERENCES reserves(id) direto — não é
-- redundante ao dispatcher, é uma defesa independente (impede DELETE de uma
-- reserva com filhas pendentes, mesmo se o dispatcher algum dia for
-- desabilitado). A referência ao PAI (material_types/lendings/etc.) é
-- separada, já garantida pelas FKs existentes de cada tabela.

ALTER TABLE public.material_request_items
  ADD COLUMN reserve_id uuid REFERENCES public.reserves(id);
ALTER TABLE public.service_log_events
  ADD COLUMN reserve_id uuid REFERENCES public.reserves(id);
ALTER TABLE public.handover_attachments
  ADD COLUMN reserve_id uuid REFERENCES public.reserves(id);
ALTER TABLE public.inventory_item_checks
  ADD COLUMN reserve_id uuid REFERENCES public.reserves(id);
ALTER TABLE public.material_items
  ADD COLUMN reserve_id uuid REFERENCES public.reserves(id);
ALTER TABLE public.cautela_vencimento_alert_events
  ADD COLUMN reserve_id uuid REFERENCES public.reserves(id);
ALTER TABLE public.document_signatures
  ADD COLUMN reserve_id uuid REFERENCES public.reserves(id);

-- ── 2. Função dispatcher (SECURITY INVOKER — não precisa bypassar RLS,   ──
-- roda dentro do trigger, sempre no contexto de quem já tinha permissão de
-- escrever a linha) ─────────────────────────────────────────────────────
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
      SELECT reserve_id INTO v_reserve_id FROM public.material_types WHERE id = NEW.material_type_id;
    WHEN 'cautela_vencimento_alert_events' THEN
      SELECT reserve_id INTO v_reserve_id FROM public.cautelamentos WHERE id = NEW.cautela_id;
    WHEN 'document_signatures' THEN
      -- Polimórfico: document_type + document_id. Valores reais confirmados
      -- por grep (2026-09-11): 'lending' (saidas.ts), 'handover'
      -- (cautelamentos.ts/handovers.ts), 'inventory_reserve_check'
      -- (inventory.ts). 'inventory'/'inventory_campaign' existem no zod enum
      -- de POST /api/signatures (routes/signatures.ts) mas NENHUM insert real
      -- os usa hoje — tratados como desconhecido (RAISE), não suportados
      -- silenciosamente. inventory_campaigns é multi-reserva por design
      -- (reserve_ids array) — não tem um reserve_id único pra derivar.
      CASE NEW.document_type
        WHEN 'lending' THEN
          SELECT reserve_id INTO v_reserve_id FROM public.lendings WHERE id = NEW.document_id;
        WHEN 'handover' THEN
          SELECT reserve_id INTO v_reserve_id FROM public.service_handovers WHERE id = NEW.document_id;
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

REVOKE EXECUTE ON FUNCTION public.derive_child_reserve_id() FROM PUBLIC, anon, authenticated;

-- ── 3. Triggers BEFORE INSERT OR UPDATE OF <fk> — deriva de novo se o fk  ──
-- mudar (ex: um item trocando de material_type_id) ────────────────────────
CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF request_id ON public.material_request_items
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF shift_id ON public.service_log_events
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF handover_id ON public.handover_attachments
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF reserve_check_id ON public.inventory_item_checks
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF material_type_id ON public.material_items
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF cautela_id ON public.cautela_vencimento_alert_events
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

CREATE TRIGGER trg_derive_reserve_id
  BEFORE INSERT OR UPDATE OF document_type, document_id ON public.document_signatures
  FOR EACH ROW EXECUTE FUNCTION public.derive_child_reserve_id();

-- ── 4. NOT NULL (tabelas vazias — direto, sem NOT VALID/VALIDATE) ─────────
ALTER TABLE public.material_request_items ALTER COLUMN reserve_id SET NOT NULL;
ALTER TABLE public.service_log_events ALTER COLUMN reserve_id SET NOT NULL;
ALTER TABLE public.handover_attachments ALTER COLUMN reserve_id SET NOT NULL;
ALTER TABLE public.inventory_item_checks ALTER COLUMN reserve_id SET NOT NULL;
ALTER TABLE public.material_items ALTER COLUMN reserve_id SET NOT NULL;
ALTER TABLE public.cautela_vencimento_alert_events ALTER COLUMN reserve_id SET NOT NULL;
ALTER TABLE public.document_signatures ALTER COLUMN reserve_id SET NOT NULL;

-- ── 5. Índices ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mri_reserve_id ON public.material_request_items(reserve_id);
CREATE INDEX IF NOT EXISTS idx_sle_reserve_id ON public.service_log_events(reserve_id);
CREATE INDEX IF NOT EXISTS idx_ha_reserve_id ON public.handover_attachments(reserve_id);
CREATE INDEX IF NOT EXISTS idx_iic_reserve_id ON public.inventory_item_checks(reserve_id);
CREATE INDEX IF NOT EXISTS idx_mi_reserve_id ON public.material_items(reserve_id);
CREATE INDEX IF NOT EXISTS idx_cvae_reserve_id ON public.cautela_vencimento_alert_events(reserve_id);
CREATE INDEX IF NOT EXISTS idx_ds_reserve_id ON public.document_signatures(reserve_id);
