-- Fase 5 — Migration 2: Cautela por Tempo Indeterminado
-- Nova tabela: cautelamentos (atribuição pessoal permanente de item a militar)
-- NOTA: usa reserves(id) para unidade — tabela real no projeto (não 'unidades')

CREATE TABLE IF NOT EXISTS cautelamentos (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 UUID NOT NULL REFERENCES tenants(id),
  reserve_id                UUID NOT NULL REFERENCES reserves(id),
  item_id                   UUID NOT NULL REFERENCES material_items(id),
  militar_id                UUID NOT NULL REFERENCES profiles(id),
  armeiro_id                UUID NOT NULL REFERENCES profiles(id),
  condicao_emissao          TEXT NOT NULL DEFAULT 'bom'
    CHECK (condicao_emissao IN ('novo','bom','regular','ruim')),
  condicao_devolucao        TEXT
    CHECK (condicao_devolucao IN ('bom','regular','ruim','inapto')),
  motivo_emissao            TEXT NOT NULL,
  data_emissao              TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_devolucao            TIMESTAMPTZ,
  data_ultima_conferencia   TIMESTAMPTZ,
  prazo_proxima_conferencia DATE,
  data_substituicao         TIMESTAMPTZ,
  substituido_por           UUID REFERENCES cautelamentos(id),
  substitui                 UUID REFERENCES cautelamentos(id),
  status                    TEXT NOT NULL DEFAULT 'ativa'
    CHECK (status IN ('ativa','devolvida','substituida','em_revisao','cancelada')),
  motivo_devolucao          TEXT,
  militar_signature_id      UUID REFERENCES document_signatures(id),
  armeiro_signature_id      UUID REFERENCES document_signatures(id),
  document_hash             TEXT NOT NULL,
  pdf_storage_path          TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cautelamentos_tenant       ON cautelamentos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cautelamentos_item         ON cautelamentos(item_id);
CREATE INDEX IF NOT EXISTS idx_cautelamentos_militar      ON cautelamentos(militar_id);
CREATE INDEX IF NOT EXISTS idx_cautelamentos_status       ON cautelamentos(status);
CREATE INDEX IF NOT EXISTS idx_cautelamentos_conferencia  ON cautelamentos(prazo_proxima_conferencia)
  WHERE status = 'ativa';

-- RLS
ALTER TABLE cautelamentos ENABLE ROW LEVEL SECURITY;

-- Armeiro/admin vê todos do seu tenant; militar vê apenas as suas
CREATE POLICY cautelamentos_select ON cautelamentos
  FOR SELECT USING (
    militar_id = auth.uid()
    OR auth_role() = ANY (ARRAY[
      'admin'::role_enum,
      'master'::role_enum,
      'superadmin'::role_enum,
      'admin_global'::role_enum,
      'admin_reserva'::role_enum,
      'armeiro'::role_enum,
      'auditor'::role_enum
    ])
  );

CREATE POLICY cautelamentos_insert ON cautelamentos
  FOR INSERT WITH CHECK (
    auth_role() = ANY (ARRAY[
      'admin'::role_enum,
      'superadmin'::role_enum,
      'admin_global'::role_enum,
      'admin_reserva'::role_enum,
      'armeiro'::role_enum,
      'master'::role_enum
    ])
  );

CREATE POLICY cautelamentos_update ON cautelamentos
  FOR UPDATE USING (
    auth_role() = ANY (ARRAY[
      'admin'::role_enum,
      'superadmin'::role_enum,
      'admin_global'::role_enum,
      'admin_reserva'::role_enum,
      'armeiro'::role_enum,
      'master'::role_enum
    ])
  );

-- Trigger de updated_at
CREATE OR REPLACE FUNCTION _update_cautelamentos_timestamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END; $$;

CREATE TRIGGER set_cautelamentos_updated_at
  BEFORE UPDATE ON cautelamentos
  FOR EACH ROW EXECUTE FUNCTION _update_cautelamentos_timestamp();

-- Trigger de integridade de posse: bloqueia dupla saída/cautela do mesmo item
-- Disparado em material_items UPDATE para status_operacional
CREATE OR REPLACE FUNCTION _validate_item_possession()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Só valida quando status_operacional MUDA
  IF NEW.status_operacional = OLD.status_operacional THEN
    RETURN NEW;
  END IF;

  -- Se tentando marcar como em_saida ou cautelado e item NÃO estava disponivel
  IF NEW.status_operacional IN ('em_saida', 'cautelado')
     AND OLD.status_operacional NOT IN ('disponivel') THEN
    RAISE EXCEPTION 'Item não disponível para nova saída/cautela: status atual = %', OLD.status_operacional
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER validate_item_possession
  BEFORE UPDATE OF status_operacional ON material_items
  FOR EACH ROW EXECUTE FUNCTION _validate_item_possession();
