-- Biometric Bridge Phase 1B — corrige "column reference reserve_id is
-- ambiguous" introduzido pela migration anterior
-- (20260719230524_biometric_bridge_phase1b_security_fixes.sql).
--
-- Causa raiz: `RETURNS TABLE (device_id uuid, tenant_id uuid, reserve_id
-- uuid)` cria parâmetros OUT implícitos com esses mesmos nomes, visíveis
-- em todo o corpo da função. O SELECT novo adicionado para o fix do
-- CRÍTICO (sequestro de device cross-reserve) referenciava `reserve_id` e
-- `tenant_id` sem qualificar a tabela — colidindo com os parâmetros OUT.
-- O resto da função sempre usou `v_code.xxx`/`excluded.xxx` qualificados
-- por esse motivo exato; o SELECT novo quebrou essa disciplina.
--
-- Descoberto em produção real via E2E (PB02 falhando com 500 genérico,
-- causa raiz só visível em `docker logs apmcb-bff` — a resposta HTTP não
-- expõe o erro do Postgres ao cliente, por design).
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

  -- Fix: qualificar biometric_devices.reserve_id/tenant_id/device_name
  -- explicitamente — sem isso colide com os parâmetros OUT de mesmo nome.
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
  on conflict (tenant_id, device_name) do update set
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
