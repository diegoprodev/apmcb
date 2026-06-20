-- ============================================================
-- SLICE 1A — Material Items (Rastreamento de Item Físico Individual)
-- ============================================================
-- material_types continua como catálogo (o que é o item).
-- material_items registra cada unidade física individual.
-- REGRA CENTRAL: Um item só pode ter UMA posse ativa por vez.
-- Garantido por trigger de banco — não pode ser bypassado.
-- ============================================================

CREATE TABLE IF NOT EXISTS material_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id),
  material_type_id        UUID NOT NULL REFERENCES material_types(id),

  -- Identificação flexível: nem todo item tem número de série
  tipo_identificador      TEXT NOT NULL
    CHECK (tipo_identificador IN (
      'numero_serie',   -- armas, equipamentos com série gravada
      'patrimonio',     -- número patrimonial do órgão
      'tombo',          -- registro de tombamento
      'prefixo',        -- viaturas policiais
      'placa',          -- veículos
      'imei',           -- celulares, tablets, GPS
      'interno'         -- identificador interno sem padrão externo
    )),
  identificador_principal TEXT NOT NULL,

  -- Campos de identificação secundária (opcionais)
  numero_serie            TEXT,
  patrimonio              TEXT,
  tombo                   TEXT,
  prefixo                 TEXT,
  placa                   TEXT,
  imei                    TEXT,

  -- =========================================================
  -- ESTADO OPERACIONAL — REGRA CENTRAL DO DOMÍNIO
  -- Um item sensível só pode ter UMA posse operacional ativa por vez.
  -- Garantido por trigger trg_validate_item_transition (abaixo).
  -- =========================================================
  status_operacional      TEXT NOT NULL DEFAULT 'disponivel'
    CHECK (status_operacional IN (
      'disponivel',   -- na reserva; pode iniciar saída ou cautela
      'em_saida',     -- em saída diária ativa (lendings) — bloqueia cautela
      'cautelado',    -- em cautela por tempo indeterminado — bloqueia saída
      'manutencao',   -- em reparo; bloqueia saída e cautela
      'extraviado',   -- não localizado; bloqueia saída e cautela
      'baixado',      -- baixado do patrimônio definitivamente
      'inapto'        -- inoperante; bloqueia saída e cautela
    )),

  -- Cache de posse atual (atualizado atomicamente em cada transação)
  current_holder_user_id  UUID REFERENCES profiles(id),
  current_unit_id         UUID REFERENCES reserves(id),
  active_lending_id       UUID,              -- ref. lógica para lendings.id (FK real: Fase 5)
  active_cautelamento_id  UUID,              -- ref. lógica para cautelamentos.id (FK real: Fase 5)
  last_movement_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Dados físicos do item
  descricao_adicional     TEXT,
  condicao                TEXT NOT NULL DEFAULT 'bom'
    CHECK (condicao IN ('novo','bom','regular','ruim','inapto')),
  validade_item           DATE,
  data_aquisicao          DATE,
  valor_aquisicao         NUMERIC(12,2),

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Unicidade por tenant: mesmo identificador não pode ser cadastrado duas vezes
  UNIQUE (tenant_id, tipo_identificador, identificador_principal)
);

-- =========================================================
-- TRIGGER DE INTEGRIDADE DE POSSE
-- Valida todas as transições de status_operacional.
-- Nenhum backend pode bypassar esta regra — ela vive no banco.
-- =========================================================
CREATE OR REPLACE FUNCTION fn_validate_item_transition()
RETURNS TRIGGER AS $$
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

  -- Estados finais bloqueiam saída e cautela
  IF OLD.status_operacional IN ('manutencao','extraviado','baixado','inapto')
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
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_item_transition
  BEFORE UPDATE OF status_operacional ON material_items
  FOR EACH ROW EXECUTE FUNCTION fn_validate_item_transition();

-- RLS: isolamento por tenant
ALTER TABLE material_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "material_items_tenant_member" ON material_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM tenant_memberships tm
      WHERE tm.tenant_id = material_items.tenant_id
        AND tm.user_id = auth.uid()
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_material_items_tenant        ON material_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_material_items_type          ON material_items(material_type_id);
CREATE INDEX IF NOT EXISTS idx_material_items_status        ON material_items(status_operacional);
CREATE INDEX IF NOT EXISTS idx_material_items_holder        ON material_items(current_holder_user_id)
  WHERE status_operacional IN ('em_saida','cautelado');
CREATE INDEX IF NOT EXISTS idx_material_items_validade      ON material_items(validade_item)
  WHERE validade_item IS NOT NULL AND status_operacional = 'cautelado';
CREATE INDEX IF NOT EXISTS idx_material_items_identificador ON material_items(tenant_id, tipo_identificador, identificador_principal);

-- updated_at trigger
CREATE TRIGGER material_items_updated_at
  BEFORE UPDATE ON material_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
