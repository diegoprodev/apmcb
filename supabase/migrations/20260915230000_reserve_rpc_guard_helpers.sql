-- SP8 do isolamento por reserva — helpers de guarda de escrita p/ RPCs
-- SECURITY DEFINER (assert_actor_in_reserve, assert_device_in_reserve,
-- assert_resource_in_reserve). Ver
-- docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.4/§8 (SP8).
--
-- Esta migration cria SÓ os helpers — nenhuma RPC existente é alterada
-- aqui (dormente, zero mudança de comportamento). Wiring nas 9 assinaturas
-- de F5 (record_cautelamento_batch, record_lending_batch×2,
-- record_lending_returns×2, record_biometric_enrollment,
-- record_biometric_proof, set_material_cautela_eligibility,
-- check_material_validade_vencimento) fica pra um passo separado — cada
-- uma dessas funções é caminho quente de escrita real (cautela/empréstimo/
-- biometria), então cada wiring é testado em staging isoladamente antes de
-- prod, mesma disciplina do SP4/SP5/SP6/SP7 (nunca alterar corpo de RPC de
-- alto risco sem validação isolada + review antes de aplicar).
--
-- bump_reserve_preference é EXCLUÍDA do escopo de assert_actor_in_reserve:
-- ela é o mecanismo que registra preferência de reserva ANTES/DURANTE a
-- troca (grava em user_reserve_preferences, contagem de uso), não uma
-- escrita de recurso de negócio — exigir "já estar ativo na reserva X" pra
-- registrar preferência por X seria circular (nunca dá pra trocar). Guarda
-- própria (membership via user_in_reserve, já existe desde SP2) fica como
-- follow-up, não este helper.
--
-- ROLLBACK: ver bloco no fim (comentado).

-- ── assert_actor_in_reserve ──────────────────────────────────────────
-- Prova "ator humano autorizado a escrever na reserva p_reserve_id":
-- 1. reserva existe e está ativa
-- 2. ator pertence ao mesmo tenant da reserva
-- 3. se a flag de isolamento do tenant está OFF, libera sem checar mais
--    nada (dormente enquanto reserve_isolation_enabled=false, igual RLS)
-- 4. se está ON: só libera se active_reserve_id do ator (verdade do banco,
--    nunca do cliente) == p_reserve_id
-- admin_global/auditor NÃO ganham bypass — precisam ter "entrado" na
-- reserva pelo chevron (SEC-ALTO-5 do spec), igual staff comum.
CREATE OR REPLACE FUNCTION public.assert_actor_in_reserve(p_actor_id uuid, p_reserve_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_status text;
  v_role role_enum;
  v_actor_tenant uuid;
  v_active uuid;
  v_flag boolean;
BEGIN
  -- Achado CRÍTICO do review (2026-09-15): `current_user` NÃO serve pra
  -- distinguir "chamada de cron" de "chamada real via PostgREST" — dentro
  -- de QUALQUER RPC SECURITY DEFINER de propriedade de postgres,
  -- current_user já É 'postgres' independente de quem disparou (a
  -- substituição de SECURITY DEFINER propaga pra chamadas aninhadas do
  -- mesmo owner — mesma semântica já documentada na migration
  -- 20260910100000:27 sobre as próprias RPCs de F5). `session_user` é o
  -- que reflete o role de LOGIN real da conexão (pg_cron conecta como
  -- postgres diretamente; tráfego do PostgREST nunca é postgres) — é o
  -- único dos dois que de fato prova "isso é cron, não usuário real".
  IF p_actor_id IS NULL AND session_user = 'postgres' THEN
    RETURN; -- caller de sistema (cron) — já roda escopado externamente
  END IF;

  SELECT tenant_id, status INTO v_tenant, v_status
    FROM public.reserves WHERE id = p_reserve_id;
  IF v_tenant IS NULL OR v_status <> 'ativa' THEN
    RAISE EXCEPTION 'reserva % inexistente ou inativa', p_reserve_id USING ERRCODE = '42501';
  END IF;

  SELECT role, default_tenant_id, active_reserve_id INTO v_role, v_actor_tenant, v_active
    FROM public.profiles WHERE id = p_actor_id;
  IF v_actor_tenant IS NULL THEN
    RAISE EXCEPTION 'ator % nao encontrado', p_actor_id USING ERRCODE = '42501';
  END IF;
  IF v_actor_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'ator de outro tenant' USING ERRCODE = '42501';
  END IF;

  SELECT reserve_isolation_enabled INTO v_flag FROM public.tenants WHERE id = v_tenant;
  IF NOT COALESCE(v_flag, false) THEN
    RETURN; -- flag OFF: comportamento atual, sem checagem de reserva ativa
  END IF;

  IF v_active = p_reserve_id THEN
    RETURN;
  END IF;

  IF v_role IN ('admin_global', 'auditor') THEN
    RAISE EXCEPTION 'admin_global/auditor precisa entrar na reserva (chevron) para escrever' USING ERRCODE = '42501';
  END IF;

  RAISE EXCEPTION 'ator % nao autorizado na reserva %', p_actor_id, p_reserve_id USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_actor_in_reserve(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── assert_device_in_reserve ─────────────────────────────────────────
-- Variante p/ o biometric-bridge (ator = device, não usuário humano).
-- Mesma estrutura, mas o "active_reserve_id" do device é o próprio
-- biometric_devices.reserve_id (dispositivo é fixo por reserva, não troca
-- como profiles.active_reserve_id).
CREATE OR REPLACE FUNCTION public.assert_device_in_reserve(p_device_id uuid, p_reserve_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant uuid;
  v_status text;
  v_device_tenant uuid;
  v_device_reserve uuid;
  v_device_status text;
  v_flag boolean;
BEGIN
  SELECT tenant_id, status INTO v_tenant, v_status
    FROM public.reserves WHERE id = p_reserve_id;
  IF v_tenant IS NULL OR v_status <> 'ativa' THEN
    RAISE EXCEPTION 'reserva % inexistente ou inativa', p_reserve_id USING ERRCODE = '42501';
  END IF;

  SELECT tenant_id, reserve_id, status INTO v_device_tenant, v_device_reserve, v_device_status
    FROM public.biometric_devices WHERE id = p_device_id;
  IF v_device_tenant IS NULL THEN
    RAISE EXCEPTION 'device % nao encontrado', p_device_id USING ERRCODE = '42501';
  END IF;
  IF v_device_tenant IS DISTINCT FROM v_tenant THEN
    RAISE EXCEPTION 'device de outro tenant' USING ERRCODE = '42501';
  END IF;
  -- Achado ALTO do review: sem isso, device revogado/suspenso continua
  -- autorizado a escrever (leitor roubado/comprometido, credencial
  -- rotacionada — status muda pra 'revoked'/'suspended', tenant_id/
  -- reserve_id continuam corretos). status='active' é a única checagem
  -- de "device confiável agora", não só "device desta reserva".
  IF v_device_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'device % nao esta ativo (status=%)', p_device_id, v_device_status USING ERRCODE = '42501';
  END IF;

  SELECT reserve_isolation_enabled INTO v_flag FROM public.tenants WHERE id = v_tenant;
  IF NOT COALESCE(v_flag, false) THEN
    RETURN;
  END IF;

  IF v_device_reserve IS DISTINCT FROM p_reserve_id THEN
    RAISE EXCEPTION 'device % nao autorizado na reserva %', p_device_id, p_reserve_id USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_device_in_reserve(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── assert_resource_in_reserve ───────────────────────────────────────
-- Cross-check genérico "recurso do payload pertence à reserva declarada"
-- (SEC-v5 Q1 do spec — o ator pode estar autorizado na reserva A e ainda
-- assim referenciar um recurso (material/cautelamento/lending) da reserva
-- B no payload). p_table é regclass (só nomes de tabela reais, sem risco
-- de injeção — regclass falha se a tabela não existir). Usa EXECUTE porque
-- a tabela/coluna variam por chamada.
CREATE OR REPLACE FUNCTION public.assert_resource_in_reserve(p_table regclass, p_id uuid, p_reserve_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_reserve uuid;
BEGIN
  EXECUTE format('SELECT reserve_id FROM %s WHERE id = $1', p_table)
    INTO v_reserve
    USING p_id;
  IF v_reserve IS NULL THEN
    RAISE EXCEPTION 'recurso % (%) nao encontrado', p_id, p_table USING ERRCODE = '42501';
  END IF;
  IF v_reserve IS DISTINCT FROM p_reserve_id THEN
    RAISE EXCEPTION 'recurso % (%) nao pertence a reserva %', p_id, p_table, p_reserve_id USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_resource_in_reserve(regclass, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ROLLBACK (referência, não executado):
--   DROP FUNCTION IF EXISTS public.assert_actor_in_reserve(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.assert_device_in_reserve(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.assert_resource_in_reserve(regclass, uuid, uuid);
