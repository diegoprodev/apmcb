-- Biometric Bridge Phase 1A.1: simulator flag and one-time proof consumption.

alter table biometric_devices
  add column if not exists is_simulator boolean not null default false;

create table if not exists biometric_proof_consumptions (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references biometric_proofs(id),
  tenant_id uuid not null references tenants(id),
  reserve_id uuid not null references reserves(id),
  actor_id uuid not null references profiles(id),
  operation_type text not null,
  operation_id uuid,
  created_at timestamptz not null default now(),
  unique (proof_id)
);

alter table biometric_proof_consumptions enable row level security;

create index if not exists idx_biometric_proof_consumptions_tenant
  on biometric_proof_consumptions(tenant_id, reserve_id, created_at desc);

create or replace function assert_biometric_proof_consumption_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  p record;
begin
  select tenant_id, reserve_id, actor_id
    into p
  from public.biometric_proofs
  where id = new.proof_id;

  if p.tenant_id is null then
    raise exception 'biometric proof not found for consumption';
  end if;

  if p.tenant_id <> new.tenant_id then
    raise exception 'biometric proof consumption tenant mismatch';
  end if;

  if p.reserve_id <> new.reserve_id then
    raise exception 'biometric proof consumption reserve mismatch';
  end if;

  if p.actor_id <> new.actor_id then
    raise exception 'biometric proof consumption actor mismatch';
  end if;

  return new;
end;
$$;

drop trigger if exists biometric_proof_consumptions_scope_guard on biometric_proof_consumptions;
create trigger biometric_proof_consumptions_scope_guard
  before insert or update on biometric_proof_consumptions
  for each row execute function assert_biometric_proof_consumption_scope();

create or replace function public.record_biometric_proof(
  p_challenge_id uuid,
  p_tenant_id uuid,
  p_reserve_id uuid,
  p_device_id uuid,
  p_actor_id uuid,
  p_matched_user_id uuid,
  p_purpose text,
  p_document_type text,
  p_document_id uuid,
  p_document_hash text,
  p_match_score numeric,
  p_finger_index integer,
  p_liveness_passed boolean,
  p_bridge_signature text,
  p_signature_algorithm text,
  p_sdk_version text,
  p_bridge_version text,
  p_result text,
  p_failure_reason text
)
returns table (
  id uuid,
  challenge_id uuid,
  result text,
  matched_user_id uuid,
  match_score numeric,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_challenge_id uuid;
begin
  update public.biometric_challenges
    set status = 'consumed',
        consumed_at = now(),
        device_id = p_device_id
  where biometric_challenges.id = p_challenge_id
    and biometric_challenges.tenant_id = p_tenant_id
    and biometric_challenges.reserve_id = p_reserve_id
    and biometric_challenges.actor_id = p_actor_id
    and biometric_challenges.status = 'pending'
    and biometric_challenges.expires_at > now()
  returning biometric_challenges.id into v_challenge_id;

  if v_challenge_id is null then
    raise exception 'BIOMETRIC_CHALLENGE_NOT_PENDING' using errcode = 'P0001';
  end if;

  return query
  insert into public.biometric_proofs (
    challenge_id,
    tenant_id,
    reserve_id,
    device_id,
    actor_id,
    matched_user_id,
    purpose,
    document_type,
    document_id,
    document_hash,
    match_score,
    finger_index,
    liveness_passed,
    bridge_signature,
    signature_algorithm,
    sdk_version,
    bridge_version,
    result,
    failure_reason
  )
  values (
    p_challenge_id,
    p_tenant_id,
    p_reserve_id,
    p_device_id,
    p_actor_id,
    p_matched_user_id,
    p_purpose,
    p_document_type,
    p_document_id,
    p_document_hash,
    p_match_score,
    p_finger_index,
    p_liveness_passed,
    p_bridge_signature,
    p_signature_algorithm,
    p_sdk_version,
    p_bridge_version,
    p_result,
    p_failure_reason
  )
  returning
    biometric_proofs.id,
    biometric_proofs.challenge_id,
    biometric_proofs.result,
    biometric_proofs.matched_user_id,
    biometric_proofs.match_score,
    biometric_proofs.created_at;
end;
$$;
