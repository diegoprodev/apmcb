-- Biometric Bridge Phase 1C — gate de liveness do enrollment vira condicional
--
-- Achado CRÍTICO real (spec docs/superpowers/specs/2026-07-21-biometric-
-- bridge-phase1c-client-design.md, seção 2.7): record_biometric_enrollment
-- exigia p_liveness_passed = true incondicionalmente, sem nenhum jeito de
-- desligar isso — diferente de /proof (biometric-bridge.ts:359), que já
-- respeita BIOMETRIC_REQUIRE_LIVENESS. Se o modelo de leitor NITGEN real
-- não expuser LFD (liveness detection) de verdade, liveness_passed só pode
-- vir null do SDK — e com o gate incondicional, NENHUM enrollment jamais
-- seria aceito, travando o objetivo central da Fase 1C, descoberto só no
-- gate de hardware.
--
-- Fix: novo parâmetro p_require_liveness (o BFF já lê BIOMETRIC_REQUIRE_
-- LIVENESS no processo Node, só precisa repassar) — mesma lógica OR já
-- usada em biometric-bridge.ts:359. Um `false` explícito do SDK continua
-- SEMPRE rejeitado, independente do flag — só null passa a ser aceito
-- quando o flag está desligado.
--
-- DROP + CREATE, não CREATE OR REPLACE: a lista de parâmetros muda (ganha
-- p_require_liveness), e CREATE OR REPLACE não substitui uma função
-- in-place quando isso acontece — cria uma função nova/distinta (novo
-- OID), deixando a assinatura antiga (16 params, gate incondicional)
-- intocada no catálogo e ainda GRANTada. Sem o DROP explícito, na melhor
-- hipótese o BFF (chamando com 17 params nomeados) recebe "function does
-- not exist"; na pior, a função antiga fica órfã mas ainda GRANTada e
-- coexistindo, uma superfície morta desnecessária.
--
-- begin/commit explícito (achado ALTO de code review, 2026-07-21) — mesmo
-- motivo da migration 20260721000001: DROP+CREATE+REVOKE+GRANT em
-- statements separados, sem transação, dependeria do mecanismo de deploy
-- pra atomicidade, num projeto que já teve 2 incidentes reais de EXECUTE
-- indevido a anon/authenticated via grant automático em função nova.
begin;

drop function if exists public.record_biometric_enrollment(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, text, integer,
  smallint, boolean, text, text, text, text
);

create function public.record_biometric_enrollment(
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
returns table (
  proof_id uuid,
  finger_index integer,
  quality integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
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
  on conflict (user_id, finger_index) do update set
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

  return query select v_proof.id, p_finger_index, p_quality, v_proof.created_at, null::timestamptz;
end;
$$;

revoke all on function public.record_biometric_enrollment(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, text, integer,
  smallint, boolean, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.record_biometric_enrollment(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, text, integer,
  smallint, boolean, text, text, text, text, boolean
) to service_role;

commit;
