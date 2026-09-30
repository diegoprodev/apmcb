-- ============================================================================
-- Saida/devolucao com biometria: liveness "desconhecido" (null) deixa de ser
-- recusado pelos RPCs.
--
-- AUTORIZADO pelo dono do sistema (2026-09-24): a reserva SEMPRE opera com o
-- armeiro presente supervisionando a captura (acesso ao sistema logico exige o
-- armeiro), e o codigo dinamico segue como fator alternativo. Modelos de leitor
-- sem detector de dedo falso (LFD), como o NITGEN Hamster DX, reportam
-- liveness_passed = NULL (o bridge nunca inventa true).
--
-- O gate de liveness do sistema ja e condicional na borda: POST
-- /api/biometric-bridge/challenges/:id/proof recusa `false` sempre e recusa
-- `null` so quando BIOMETRIC_REQUIRE_LIVENESS=true (o cadastro usa
-- p_require_liveness, ver 20260721173926). Mas record_lending_batch e
-- record_lending_returns ainda exigiam `liveness_passed = true`: o
-- reconhecimento passava e o "Registrar Saida" falhava segundos depois com
-- LENDING_BIOMETRIC_PROOF_INVALID.
--
-- Nova regra nos RPCs: so e invalida a prova com liveness EXPLICITAMENTE false
-- (dedo falso detectado). Se um dia BIOMETRIC_REQUIRE_LIVENESS=true, prova sem
-- liveness nem chega a existir (rejeitada no /proof) -- a exigencia estrita
-- continua a um flag de distancia.
--
-- Reescreve, via pg_get_functiondef, todas as sobrecargas vivas trocando SO essa
-- condicao: preserva o resto do corpo, SECURITY DEFINER, search_path e GRANTs.
-- ============================================================================

DO $$
DECLARE
  r record;
  v_def text;
  v_count int := 0;
  v_old constant text := 'v_proof.liveness_passed is distinct from true';
  v_new constant text := 'v_proof.liveness_passed is not distinct from false';
BEGIN
  FOR r IN
    SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('record_lending_batch', 'record_lending_returns')
       AND position(v_old in p.prosrc) > 0
  LOOP
    v_def := pg_get_functiondef(r.oid);
    IF position(v_old in v_def) = 0 THEN
      RAISE EXCEPTION 'condicao de liveness nao encontrada na definicao de oid %', r.oid;
    END IF;
    EXECUTE replace(v_def, v_old, v_new);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'sobrecargas atualizadas: %', v_count;
END
$$;
