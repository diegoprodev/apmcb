-- Biometric Bridge Phase 1B — 2º fix de ambiguidade no mesmo RPC
-- (a migration anterior, 20260720173000, corrigiu o SELECT novo mas não
-- pegou esta).
--
-- Causa raiz: `ON CONFLICT (tenant_id, device_name)` — a lista de colunas
-- do conflict target é analisada pelo parser do Postgres como uma lista de
-- EXPRESSÕES (`infer_clause`), não como nomes de coluna puros — suporte a
-- índices de expressão exige isso. Como "tenant_id" também é um parâmetro
-- OUT implícito (de `RETURNS TABLE(..., tenant_id uuid, ...)`), o mesmo
-- tipo de ambiguidade do fix anterior se repete aqui, só que numa posição
-- sintática diferente (conflict target, não um SELECT/WHERE comum) — por
-- isso não foi pega antes.
--
-- Fix: `ON CONFLICT ON CONSTRAINT <nome>` em vez de `ON CONFLICT (colunas)`
-- — referencia a constraint pelo nome, sem nenhuma lista de expressões
-- para o parser resolver, eliminando a ambiguidade estruturalmente (não
-- só neste caso, para sempre). Nome confirmado via
-- `pg_constraint`/`conrelid = 'biometric_devices'::regclass`:
-- biometric_devices_tenant_id_device_name_key (unique inline da migration
-- de fundação, nome auto-gerado pelo Postgres).
--
-- Descoberto em produção real via E2E (PB02 voltou a falhar mesmo após o
-- fix anterior — "tenant_id" ambíguo, não mais "reserve_id" — confirmando
-- que era um SEGUNDO ponto de ambiguidade na mesma função, não um fix
-- incompleto do primeiro).
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
  v_existing_reserve_id uuid;
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

  select biometric_devices.reserve_id into v_existing_reserve_id
    from biometric_devices
   where biometric_devices.tenant_id = v_code.tenant_id
     and biometric_devices.device_name = p_device_name
   for update;

  if v_existing_reserve_id is not null and v_existing_reserve_id <> v_code.reserve_id then
    raise exception 'BIOMETRIC_PAIRING_DEVICE_RESERVE_MISMATCH' using errcode = 'P0001';
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
  on conflict on constraint biometric_devices_tenant_id_device_name_key do update set
    reserve_id = excluded.reserve_id,
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
