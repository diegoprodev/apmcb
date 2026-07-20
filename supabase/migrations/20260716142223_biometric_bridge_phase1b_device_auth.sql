-- Biometric Bridge Phase 1B: device-auth real para o bridge Windows.
-- Ver docs/superpowers/specs/2026-07-14-biometric-bridge-phase1b-windows-bridge-mvp-design.md
-- (auditada e ajustada em 2026-07-16).

-- 1. Nonces de request do bridge (anti-replay do device-auth Ed25519).
create table if not exists biometric_device_request_nonces (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references biometric_devices(id),
  nonce        text not null,
  request_hash text not null,
  created_at   timestamptz not null default now(),
  unique (device_id, nonce)
);

alter table biometric_device_request_nonces enable row level security;

create index if not exists idx_biometric_device_request_nonces_created_at
  on biometric_device_request_nonces(created_at);

comment on table biometric_device_request_nonces is
  'Anti-replay do device-auth do bridge Windows: cada (device_id, nonce) só pode ser usado uma vez. Retenção: limpar linhas com mais de BIOMETRIC_BRIDGE_NONCE_TTL_SECONDS via pg_cron.';

-- 2. Códigos de pareamento one-time (browser-facing gera, bridge consome).
create table if not exists biometric_pairing_codes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id),
  reserve_id      uuid not null references reserves(id),
  code_hash       text not null unique,
  device_name     text not null,
  created_by      uuid not null references profiles(id),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  used_device_id  uuid references biometric_devices(id),
  revoked_at      timestamptz,
  revoked_by      uuid references profiles(id)
);

alter table biometric_pairing_codes enable row level security;

create index if not exists idx_biometric_pairing_codes_tenant_reserve
  on biometric_pairing_codes(tenant_id, reserve_id);

comment on table biometric_pairing_codes is
  'Código one-time (hash com pepper, nunca texto puro) emitido por admin autorizado para parear um bridge Windows real sem exigir cookie/sessão de usuário no bridge.';

-- 3. Metadados operacionais do device.
alter table biometric_devices
  add column if not exists machine_name_hash text,
  add column if not exists hardware_serial_hash text,
  add column if not exists driver_version text,
  add column if not exists last_ip inet,
  add column if not exists last_error_code text,
  add column if not exists last_error_at timestamptz,
  add column if not exists heartbeat_interval_seconds integer not null default 15;

comment on column biometric_devices.machine_name_hash is
  'Hash do nome da máquina Windows — identificador operacional sem expor o nome real.';
comment on column biometric_devices.hardware_serial_hash is
  'Hash do serial de hardware do leitor — identificador operacional sem expor o serial bruto.';

-- 4. Consumo atômico do código de pareamento — cria/atualiza o device na
-- MESMA transação que marca o código como usado (achado de auditoria M3:
-- um UPDATE isolado do código, seguido de um upsert de device que falha
-- depois, queima o código sem criar o device — buraco operacional, não de
-- segurança, mas evitável com uma única transação).
--
-- Grants corretos desde o nascimento (achado de auditoria C2/Objetivo 9):
-- este projeto Supabase concede EXECUTE a anon/authenticated/service_role em
-- toda função nova via ALTER DEFAULT PRIVILEGES — revoke "from public" sozinho
-- é no-op contra isso. Já causou 2 incidentes reais na Phase 1A.2.
create or replace function public.consume_biometric_pairing_code(
  p_code_hash text,
  p_device_name text,
  p_public_key text,
  p_sdk_vendor text,
  p_sdk_version text,
  p_bridge_version text,
  p_machine_name_hash text,
  p_hardware_serial_hash text
)
returns table (
  device_id uuid,
  tenant_id uuid,
  reserve_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code biometric_pairing_codes%rowtype;
  v_device_id uuid;
begin
  select * into v_code
    from biometric_pairing_codes
   where code_hash = p_code_hash
   for update;

  if v_code.id is null then
    raise exception 'BIOMETRIC_PAIRING_CODE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_code.used_at is not null then
    raise exception 'BIOMETRIC_PAIRING_CODE_ALREADY_USED' using errcode = 'P0001';
  end if;
  if v_code.revoked_at is not null then
    raise exception 'BIOMETRIC_PAIRING_CODE_REVOKED' using errcode = 'P0001';
  end if;
  if v_code.expires_at <= now() then
    raise exception 'BIOMETRIC_PAIRING_CODE_EXPIRED' using errcode = 'P0001';
  end if;

  insert into biometric_devices (
    tenant_id, reserve_id, device_name, public_key, sdk_vendor, sdk_version,
    bridge_version, status, paired_by, paired_at,
    machine_name_hash, hardware_serial_hash
  ) values (
    v_code.tenant_id, v_code.reserve_id, p_device_name, p_public_key,
    coalesce(p_sdk_vendor, 'nitgen'), p_sdk_version, p_bridge_version,
    'active', v_code.created_by, now(),
    p_machine_name_hash, p_hardware_serial_hash
  )
  on conflict (tenant_id, device_name) do update set
    public_key = excluded.public_key,
    sdk_vendor = excluded.sdk_vendor,
    sdk_version = excluded.sdk_version,
    bridge_version = excluded.bridge_version,
    status = 'active',
    paired_by = excluded.paired_by,
    paired_at = now(),
    machine_name_hash = excluded.machine_name_hash,
    hardware_serial_hash = excluded.hardware_serial_hash,
    revoked_at = null,
    revoked_by = null,
    revoked_reason = null
  returning id into v_device_id;

  update biometric_pairing_codes
     set used_at = now(),
         used_device_id = v_device_id
   where id = v_code.id;

  return query select v_device_id, v_code.tenant_id, v_code.reserve_id;
end;
$$;

revoke execute on function public.consume_biometric_pairing_code(
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.consume_biometric_pairing_code(
  text, text, text, text, text, text, text, text
) to service_role;
