-- Biometric Bridge Phase 1C — device_name vem do admin (pairing code), não do bridge
--
-- Achado real (spec docs/superpowers/specs/2026-07-21-biometric-bridge-
-- phase1c-client-design.md, seção 2.2, achado A5 de revisão): o admin já
-- digita device_name ao gerar o pairing code (POST /api/biometric/pairing-
-- codes, biometric.ts:611-617), e esse valor é persistido em
-- biometric_pairing_codes.device_name — mas a função consume_biometric_
-- pairing_code nunca usava esse valor, só o p_device_name que o BRIDGE
-- enviava em /pair. O nome escolhido pelo admin era descartado
-- silenciosamente, e quem auditava "qual device é esse" pelo nome que
-- ELE escolheu estava olhando pro valor errado.
--
-- Fix: device_name passa a vir de v_code.device_name (já carregado pelo
-- SELECT existente), nunca mais de um parâmetro do bridge. CREATE OR
-- REPLACE não é suficiente aqui porque a lista de parâmetros muda (perde
-- p_device_name) — precisa DROP + CREATE, senão o Postgres cria uma
-- função NOVA e distinta, deixando a assinatura antiga (com
-- p_device_name) intocada e ainda GRANTada.
--
-- begin/commit explícito (achado ALTO de code review, 2026-07-21): este
-- projeto já teve 2 incidentes reais de EXECUTE indevido a anon/
-- authenticated via ALTER DEFAULT PRIVILEGES automático em função nova do
-- schema public (20260714000007, 20260714000008 — log_shift_event_atomic
-- ficou chamável por qualquer cliente com a anon key). DROP+CREATE+REVOKE+
-- GRANT como statements separados, sem transação explícita, dependeria do
-- mecanismo de deploy garantir atomicidade — begin/commit remove essa
-- dependência: a função nova nunca fica visível sem já estar com os
-- grants corretos.
begin;

drop function if exists public.consume_biometric_pairing_code(
  text, text, text, text, text, text, text, text
);

create function public.consume_biometric_pairing_code(
  p_code_hash text,
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
     and biometric_devices.device_name = v_code.device_name
   for update;

  if v_existing_reserve_id is not null and v_existing_reserve_id <> v_code.reserve_id then
    raise exception 'BIOMETRIC_PAIRING_DEVICE_RESERVE_MISMATCH' using errcode = 'P0001';
  end if;

  insert into biometric_devices (
    tenant_id, reserve_id, device_name, public_key, sdk_vendor, sdk_version,
    bridge_version, status, paired_by, paired_at,
    machine_name_hash, hardware_serial_hash
  ) values (
    v_code.tenant_id, v_code.reserve_id, v_code.device_name, p_public_key,
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
  text, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.consume_biometric_pairing_code(
  text, text, text, text, text, text, text
) to service_role;

commit;
