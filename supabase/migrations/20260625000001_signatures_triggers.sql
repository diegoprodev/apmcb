-- Fase 4 fix: trocar RULE por triggers BEFORE para suportar supabase-js DELETE RETURNING
-- RULE DO INSTEAD NOTHING é incompatível com DELETE RETURNING (erro 0A000)
-- Triggers BEFORE que retornam NULL cancelam a operação silenciosamente

-- Remover RULEs existentes
DROP RULE IF EXISTS no_update_signatures ON document_signatures;
DROP RULE IF EXISTS no_delete_signatures ON document_signatures;

-- Criar funções de bloqueio
CREATE OR REPLACE FUNCTION _block_signature_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION _block_signature_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RETURN NULL;
END;
$$;

-- Criar triggers (substituem as RULEs)
DROP TRIGGER IF EXISTS no_update_signatures ON document_signatures;
CREATE TRIGGER no_update_signatures
  BEFORE UPDATE ON document_signatures
  FOR EACH ROW EXECUTE FUNCTION _block_signature_update();

DROP TRIGGER IF EXISTS no_delete_signatures ON document_signatures;
CREATE TRIGGER no_delete_signatures
  BEFORE DELETE ON document_signatures
  FOR EACH ROW EXECUTE FUNCTION _block_signature_delete();
