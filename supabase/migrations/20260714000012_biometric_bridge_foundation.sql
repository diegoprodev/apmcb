-- ============================================================================
-- Biometric Bridge foundation: local NITGEN bridge + BFF-authoritative proof
-- ============================================================================

-- 1. Bridge devices paired to a tenant/reserve.
create table if not exists biometric_devices (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id),
  reserve_id     uuid not null references reserves(id),
  device_name    text not null,
  public_key     text not null,
  sdk_vendor     text not null default 'nitgen',
  sdk_version    text,
  bridge_version text,
  status         text not null default 'pending'
    check (status in ('pending','active','suspended','revoked')),
  paired_by      uuid references profiles(id),
  paired_at      timestamptz,
  last_seen_at   timestamptz,
  revoked_at     timestamptz,
  revoked_by     uuid references profiles(id),
  revoked_reason text,
  created_at     timestamptz not null default now(),
  unique (tenant_id, device_name)
);

create index if not exists idx_biometric_devices_tenant_reserve
  on biometric_devices(tenant_id, reserve_id);

create index if not exists idx_biometric_devices_status
  on biometric_devices(status);

alter table biometric_devices enable row level security;

-- Service role owns these rows through the BFF. Direct browser access remains
-- denied by default because no anon/authenticated policies are created here.

-- 2. One-time nonce/challenge for each biometric operation.
create table if not exists biometric_challenges (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id),
  reserve_id       uuid not null references reserves(id),
  device_id        uuid references biometric_devices(id),
  actor_id         uuid not null references profiles(id),
  purpose          text not null check (purpose in (
    'identify',
    'enroll',
    'sign_saida_armeiro',
    'confirm_saida_militar',
    'sign_cautela_armeiro',
    'sign_cautela_militar',
    'handover_sign_exit',
    'handover_sign_entry',
    'open_shift',
    'close_shift',
    'return'
  )),
  expected_user_id uuid references profiles(id),
  document_type    text,
  document_id      uuid,
  document_hash    text,
  status           text not null default 'pending'
    check (status in ('pending','consumed','expired','failed')),
  expires_at       timestamptz not null,
  consumed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists idx_biometric_challenges_scope_status
  on biometric_challenges(tenant_id, reserve_id, status);

create index if not exists idx_biometric_challenges_device_status
  on biometric_challenges(device_id, status);

create index if not exists idx_biometric_challenges_expires_at
  on biometric_challenges(expires_at);

alter table biometric_challenges enable row level security;

-- 3. Immutable proof submitted by a registered bridge.
create table if not exists biometric_proofs (
  id                  uuid primary key default gen_random_uuid(),
  challenge_id        uuid not null unique references biometric_challenges(id),
  tenant_id           uuid not null references tenants(id),
  reserve_id          uuid not null references reserves(id),
  device_id           uuid not null references biometric_devices(id),
  actor_id            uuid not null references profiles(id),
  matched_user_id     uuid references profiles(id),
  purpose             text not null,
  document_type       text,
  document_id         uuid,
  document_hash       text,
  match_score         numeric not null,
  finger_index        smallint check (finger_index between 1 and 10),
  liveness_passed     boolean,
  bridge_signature    text not null,
  signature_algorithm text not null default 'ed25519',
  sdk_version         text,
  bridge_version      text,
  result              text not null check (result in ('success','failure','error')),
  failure_reason      text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_biometric_proofs_scope
  on biometric_proofs(tenant_id, reserve_id, purpose);

create index if not exists idx_biometric_proofs_matched_user
  on biometric_proofs(matched_user_id)
  where matched_user_id is not null;

alter table biometric_proofs enable row level security;

create rule no_update_biometric_proofs as
  on update to biometric_proofs do instead nothing;

create rule no_delete_biometric_proofs as
  on delete to biometric_proofs do instead nothing;

-- 4. Harden existing biometric templates before tenant-wide 1:N is enabled.
alter table biometric_templates
  add column if not exists tenant_id uuid references tenants(id),
  add column if not exists template_hash text,
  add column if not exists format text not null default 'nitgen-fmd',
  add column if not exists sdk_version text,
  add column if not exists quality smallint check (quality between 0 and 100),
  add column if not exists encryption_key_version smallint not null default 1,
  add column if not exists enrolled_device_id uuid references biometric_devices(id),
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references profiles(id),
  add column if not exists revoked_reason text;

update biometric_templates bt
set tenant_id = p.default_tenant_id
from profiles p
where bt.user_id = p.id
  and bt.tenant_id is null
  and p.default_tenant_id is not null;

do $$
begin
  if exists (select 1 from biometric_templates where tenant_id is null) then
    raise exception 'biometric_templates contains rows without tenant_id; fix data before enabling tenant-wide biometrics';
  end if;
end $$;

alter table biometric_templates
  alter column tenant_id set not null;

create or replace function assert_biometric_bridge_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'biometric_devices' then
    if not exists (
      select 1 from reserves r
      where r.id = new.reserve_id and r.tenant_id = new.tenant_id
    ) then
      raise exception 'biometric device reserve/tenant mismatch';
    end if;
  elsif tg_table_name = 'biometric_challenges' then
    if not exists (
      select 1 from reserves r
      where r.id = new.reserve_id and r.tenant_id = new.tenant_id
    ) then
      raise exception 'biometric challenge reserve/tenant mismatch';
    end if;
    if new.device_id is not null and not exists (
      select 1 from biometric_devices d
      where d.id = new.device_id
        and d.tenant_id = new.tenant_id
        and d.reserve_id = new.reserve_id
    ) then
      raise exception 'biometric challenge device scope mismatch';
    end if;
  elsif tg_table_name = 'biometric_proofs' then
    if not exists (
      select 1 from biometric_challenges ch
      where ch.id = new.challenge_id
        and ch.tenant_id = new.tenant_id
        and ch.reserve_id = new.reserve_id
        and ch.actor_id = new.actor_id
        and ch.purpose = new.purpose
        and (ch.device_id is null or ch.device_id = new.device_id)
    ) then
      raise exception 'biometric proof challenge scope mismatch';
    end if;
    if not exists (
      select 1 from biometric_devices d
      where d.id = new.device_id
        and d.tenant_id = new.tenant_id
        and d.reserve_id = new.reserve_id
    ) then
      raise exception 'biometric proof device scope mismatch';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists biometric_devices_scope_guard on biometric_devices;
create trigger biometric_devices_scope_guard
  before insert or update of tenant_id, reserve_id on biometric_devices
  for each row execute function assert_biometric_bridge_scope();

drop trigger if exists biometric_challenges_scope_guard on biometric_challenges;
create trigger biometric_challenges_scope_guard
  before insert or update of tenant_id, reserve_id, device_id on biometric_challenges
  for each row execute function assert_biometric_bridge_scope();

drop trigger if exists biometric_proofs_scope_guard on biometric_proofs;
create trigger biometric_proofs_scope_guard
  before insert or update of tenant_id, reserve_id, device_id, challenge_id, actor_id, purpose on biometric_proofs
  for each row execute function assert_biometric_bridge_scope();

create index if not exists idx_biometric_templates_tenant_active
  on biometric_templates(tenant_id, user_id)
  where revoked_at is null;

comment on table biometric_devices is
  'Paired local Windows biometric bridges. Service-role only through BFF.';
comment on table biometric_challenges is
  'One-time biometric operation challenges with short TTL.';
comment on table biometric_proofs is
  'Immutable signed proof submitted by biometric bridge; no templates or raw captures.';
comment on column biometric_templates.template_data is
  'Encrypted biometric template bytes. Never expose in logs, responses or public endpoints.';
