-- Biometric Bridge Phase 1B — correções de code review obrigatório
-- (docs/superpowers/specs/2026-07-14-biometric-bridge-phase1b-windows-bridge-mvp-design.md)
-- antes do commit inicial da fase.

-- 1. CRÍTICO — sequestro de device entre reservas via colisão de
-- `device_name` no `ON CONFLICT` de `consume_biometric_pairing_code`.
--
-- O `SET` do `ON CONFLICT` original não incluía `reserve_id` — se um ator
-- autorizado APENAS na reserva B gerasse um pairing_code legítimo para B e
-- chamasse /pair com o `device_name` de um device já existente na reserva A
-- (mesmo tenant), a linha existente (de A) tinha sua `public_key`
-- substituída e `status` reativado, mas o `reserve_id` armazenado
-- continuava sendo o de A — o device resultante passava a autenticar
-- como pertencente a A no `deviceAuthMiddleware` (que lê `reserve_id`
-- direto da coluna), mesmo o ator nunca tendo tido autorização sobre A
-- (`actorCanAccessReserve` só validou a reserva B, do pairing_code usado).
--
-- Fix: rejeitar explicitamente a colisão quando a reserva do pairing_code
-- usado difere da reserva já registrada para aquele `(tenant_id,
-- device_name)` — reativação/rotação de chave via reuso de nome só é
-- permitida dentro da MESMA reserva (risco residual já documentado na spec,
-- seção 4.1, achado M3 — aceitável porque exige autorização legítima sobre
-- ESSA reserva especificamente).
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

  -- Trava a linha de device colidente (se existir) ANTES do INSERT, pro
  -- ON CONFLICT abaixo não correr contra um estado que já mudou.
  select reserve_id into v_existing_reserve_id
    from biometric_devices
   where tenant_id = v_code.tenant_id
     and device_name = p_device_name
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

-- 2. ALTO — biometric_device_request_nonces sem limpeza real. O comentário
-- original prometia "limpar via pg_cron" mas nenhum job foi criado — mesmo
-- padrão já usado em revoked_sessions (20260715000001), replicado aqui.
-- Janela de retenção fixa de 24h: generosa frente aos ~60s de
-- BIOMETRIC_BRIDGE_CLOCK_SKEW_SECONDS (default) que realmente precisam de
-- unicidade — pg_cron roda no Postgres, não tem acesso a env var do BFF,
-- por isso o valor é fixo aqui em vez de referenciar a env var (a promessa
-- original no comentário da tabela estava incorreta nesse sentido também).
create extension if not exists pg_cron with schema extensions;

select cron.schedule(
  'cleanup-biometric-device-request-nonces',
  '0 * * * *',
  $$delete from public.biometric_device_request_nonces where created_at < now() - interval '24 hours'$$
);

comment on table biometric_device_request_nonces is
  'Anti-replay do device-auth do bridge Windows: cada (device_id, nonce) só pode ser usado uma vez. Limpeza: pg_cron job "cleanup-biometric-device-request-nonces", de hora em hora, retenção de 24h.';
