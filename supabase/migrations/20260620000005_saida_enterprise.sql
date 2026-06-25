-- Fase 5 — Migration 1: Saída Diária Enterprise
-- Completa a máquina de estados de lendings para o fluxo enterprise.
-- A Fase 1 já renomeou "status" → "status_legacy".
-- Aqui adicionamos "status" com os valores canônicos do fluxo enterprise.
-- NOTA: lendings já tem reserve_id → não duplicar como unidade_id.

ALTER TABLE lendings
  -- Item físico individual (toda saída de Fase 5+ é sobre um item concreto)
  ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES material_items(id),
  -- Status machine canônico de saída diária
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'emitida'
    CHECK (status IN ('emitida','aguardando_confirmacao','ativa','devolvida','divergencia','cancelada')),
  -- Controle enterprise
  ADD COLUMN IF NOT EXISTS prazo_devolucao TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS observacao_emissao TEXT,
  ADD COLUMN IF NOT EXISTS observacao_devolucao TEXT,
  ADD COLUMN IF NOT EXISTS armeiro_signature_id UUID REFERENCES document_signatures(id),
  ADD COLUMN IF NOT EXISTS militar_signature_id UUID REFERENCES document_signatures(id),
  ADD COLUMN IF NOT EXISTS document_hash TEXT,
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;

-- Migrar status_legacy para o novo campo status
-- status_legacy usa enum lending_status_enum: 'ativo' | 'devolvido'
-- ADD COLUMN com DEFAULT 'emitida' já preenche todos; sobrescrever os que têm status_legacy definido
UPDATE lendings SET status = 'ativa'     WHERE status_legacy = 'ativo';
UPDATE lendings SET status = 'devolvida' WHERE status_legacy = 'devolvido';

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lendings_status  ON lendings(status);
CREATE INDEX IF NOT EXISTS idx_lendings_item    ON lendings(item_id);
CREATE INDEX IF NOT EXISTS idx_lendings_prazo   ON lendings(prazo_devolucao)
  WHERE status = 'ativa';
