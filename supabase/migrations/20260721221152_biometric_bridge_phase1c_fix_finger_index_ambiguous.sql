-- Fix CI/CD PB09: record_biometric_enrollment falhava em TODA chamada
-- (não só em conflito de upsert) com dois bugs reais na função SQL, nenhum
-- deles um P0001 de negócio, então ambos caíam no 500 genérico
-- BIOMETRIC_ENROLLMENT_PERSISTENCE_FAILED do BFF sem detalhe nenhum:
--
-- 1. "column reference finger_index is ambiguous" (42702) — RETURNS
--    TABLE(..., finger_index integer, ...) cria uma variável PL/pgSQL
--    implícita chamada finger_index; a lista do conflict target é
--    analisada pelo parser como lista de EXPRESSÕES (infer_clause), então
--    ela colide com essa variável — MESMA classe de bug já vista 2x nesta
--    base (20260720173000/20260720180000, em consume_biometric_pairing_code,
--    lá com tenant_id/device_name). Fix já estabelecido para essa classe:
--    ON CONFLICT ON CONSTRAINT <nome> em vez de ON CONFLICT (colunas) —
--    referencia a constraint pelo nome, sem lista de expressões pro parser
--    resolver, eliminando a ambiguidade estruturalmente. Nome confirmado
--    via pg_constraint/conrelid = 'biometric_templates'::regclass:
--    biometric_templates_user_id_finger_index_key.
--
-- 2. "structure of query does not match function result type ... Returned
--    type smallint does not match expected type integer in column 3"
--    (42804), desmascarado só depois do fix acima — RETURN QUERY exige
--    tipo exato por coluna (sem widening implícito smallint→integer, ao
--    contrário de um SELECT INTO comum). p_quality é smallint; a coluna 3
--    (quality) é integer. Fix: cast explícito p_quality::integer no
--    RETURN QUERY.
--
-- Ambos confirmados via reprodução direta com dados reais (execute_sql),
-- não hipótese — ver investigação da sessão 2026-07-21.
--
-- Assinatura inalterada (CREATE OR REPLACE, não DROP+CREATE) — preserva os
-- GRANTs existentes.

begin;

create or replace function public.record_biometric_enrollment(
  p_challenge_id uuid,
  p_tenant_id uuid,
  p_reserve_id uuid,
  p_device_id uuid,
  p_actor_id uuid,
  p_user_id uuid,
  p_template_data bytea,
  p_template_hash text,
  p_format text,
  p_finger_index integer,
  p_quality smallint,
  p_liveness_passed boolean,
  p_bridge_signature text,
  p_signature_algorithm text,
  p_sdk_version text,
  p_bridge_version text,
  p_require_liveness boolean
)
returns table(proof_id uuid, finger_index integer, quality integer, created_at timestamptz, updated_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_challenge biometric_challenges%rowtype;
  v_proof biometric_proofs%rowtype;
begin
  if p_template_data is null or octet_length(p_template_data) = 0 then
    raise exception 'BIOMETRIC_TEMPLATE_EMPTY' using errcode = 'P0001';
  end if;

  if p_template_hash is null
     or p_template_hash <> 'sha256:' || encode(sha256(p_template_data), 'hex') then
    raise exception 'BIOMETRIC_TEMPLATE_HASH_MISMATCH' using errcode = 'P0001';
  end if;

  if p_quality < 0 or p_quality > 100 or p_finger_index < 1 or p_finger_index > 10 then
    raise exception 'BIOMETRIC_ENROLLMENT_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_liveness_passed is false
     or (p_require_liveness and p_liveness_passed is distinct from true) then
    raise exception 'BIOMETRIC_LIVENESS_REQUIRED' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from biometric_devices d
     where d.id = p_device_id
       and d.tenant_id = p_tenant_id
       and d.reserve_id = p_reserve_id
       and d.status = 'active'
  ) then
    raise exception 'BIOMETRIC_DEVICE_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from profiles p
     where p.id = p_user_id
       and p.default_tenant_id = p_tenant_id
  ) then
    raise exception 'BIOMETRIC_TARGET_USER_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  update biometric_challenges
     set status = 'consumed', consumed_at = now(), device_id = p_device_id
   where id = p_challenge_id
     and tenant_id = p_tenant_id
     and reserve_id = p_reserve_id
     and actor_id = p_actor_id
     and purpose = 'enroll'
     and expected_user_id = p_user_id
     and status = 'pending'
     and expires_at > now()
  returning * into v_challenge;

  if v_challenge.id is null then
    raise exception 'BIOMETRIC_CHALLENGE_NOT_PENDING' using errcode = 'P0001';
  end if;

  insert into biometric_proofs (
    challenge_id, tenant_id, reserve_id, device_id, actor_id,
    matched_user_id, purpose, document_type, document_id, document_hash,
    template_hash, match_score, finger_index, liveness_passed,
    bridge_signature, signature_algorithm, sdk_version, bridge_version,
    result, failure_reason
  ) values (
    v_challenge.id, p_tenant_id, p_reserve_id, p_device_id, p_actor_id,
    p_user_id, 'enroll', v_challenge.document_type, v_challenge.document_id,
    v_challenge.document_hash, p_template_hash, 1, p_finger_index,
    p_liveness_passed, p_bridge_signature, p_signature_algorithm,
    p_sdk_version, p_bridge_version, 'success', null
  )
  returning * into v_proof;

  insert into biometric_templates (
    user_id, tenant_id, template_data, finger_index, registered_by,
    template_hash, format, sdk_version, quality, encryption_key_version,
    enrolled_device_id, revoked_at, revoked_by, revoked_reason
  ) values (
    p_user_id, p_tenant_id, p_template_data, p_finger_index, p_actor_id,
    p_template_hash, p_format, p_sdk_version, p_quality, 1,
    p_device_id, null, null, null
  )
  on conflict on constraint biometric_templates_user_id_finger_index_key do update set
    tenant_id = excluded.tenant_id,
    template_data = excluded.template_data,
    registered_by = excluded.registered_by,
    template_hash = excluded.template_hash,
    format = excluded.format,
    sdk_version = excluded.sdk_version,
    quality = excluded.quality,
    encryption_key_version = excluded.encryption_key_version,
    enrolled_device_id = excluded.enrolled_device_id,
    revoked_at = null,
    revoked_by = null,
    revoked_reason = null;

  update profiles
     set registration_status = 'complete'
   where id = p_user_id
     and default_tenant_id = p_tenant_id
     and registration_status = 'pending_biometric';

  return query select v_proof.id, p_finger_index, p_quality::integer, v_proof.created_at, null::timestamptz;
end;
$function$;

commit;
