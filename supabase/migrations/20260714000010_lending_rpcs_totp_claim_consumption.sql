-- Integra o consumo atômico de totp_identity_claims nas RPCs de custódia.
-- Ver 20260714000009 para o contexto do achado que motivou isso.

create or replace function public.record_lending_batch(
  p_tenant_id uuid,
  p_master_id uuid,
  p_military_id uuid,
  p_reserve_id uuid,
  p_movement_id uuid,
  p_notes text,
  p_auth_mode text,
  p_biometric_proof_id uuid,
  p_items jsonb,
  p_totp_claim_id uuid default null
)
returns table (lending_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_material_id uuid;
  v_quantity integer;
  v_total integer;
  v_active integer;
  v_proof biometric_proofs%rowtype;
  v_claim totp_identity_claims%rowtype;
begin
  if p_tenant_id is null or p_master_id is null or p_military_id is null
     or p_reserve_id is null or p_movement_id is null
     or p_auth_mode not in ('biometria', 'totp')
     or p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'LENDING_BATCH_INPUT_INVALID' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from lendings l
     where l.tenant_id = p_tenant_id and l.movement_id = p_movement_id
  ) then
    if exists (
      select 1 from lendings l
       where l.tenant_id = p_tenant_id and l.movement_id = p_movement_id
         and (l.military_id is distinct from p_military_id
           or l.reserve_id is distinct from p_reserve_id)
    ) then
      raise exception 'LENDING_MOVEMENT_SCOPE_INVALID' using errcode = 'P0001';
    end if;
    if exists (
      select 1
      from (
        select material_type_id, quantidade::integer as quantidade
          from lendings
         where tenant_id = p_tenant_id and movement_id = p_movement_id
      ) persisted
      full outer join (
        select (item->>'material_type_id')::uuid as material_type_id,
               (item->>'quantidade')::integer as quantidade
          from jsonb_array_elements(p_items) item
      ) requested
        on persisted.material_type_id = requested.material_type_id
       and persisted.quantidade = requested.quantidade
      where persisted.material_type_id is null or requested.material_type_id is null
    ) then
      raise exception 'LENDING_MOVEMENT_ITEMS_MISMATCH' using errcode = 'P0001';
    end if;
    -- Replay de uma operação já persistida: não precisa revalidar identidade
    -- (nada novo está sendo autorizado), só devolve o que já existe.
    return query select l.id from lendings l
      where l.tenant_id = p_tenant_id and l.movement_id = p_movement_id
      order by l.id;
    return;
  end if;

  if p_auth_mode = 'biometria' then
    if p_biometric_proof_id is null then
      raise exception 'LENDING_BIOMETRIC_PROOF_REQUIRED' using errcode = 'P0001';
    end if;

    select * into v_proof
      from biometric_proofs
     where id = p_biometric_proof_id and tenant_id = p_tenant_id
     for update;
    if v_proof.id is null
       or v_proof.reserve_id is distinct from p_reserve_id
       or v_proof.actor_id is distinct from p_master_id
       or v_proof.matched_user_id is distinct from p_military_id
       or v_proof.purpose is distinct from 'confirm_saida_militar'
       or v_proof.result is distinct from 'success'
       or v_proof.liveness_passed is distinct from true
       or v_proof.created_at <= now() - interval '2 minutes' then
      raise exception 'LENDING_BIOMETRIC_PROOF_INVALID' using errcode = 'P0001';
    end if;

    insert into biometric_proof_consumptions (
      proof_id, tenant_id, reserve_id, actor_id, operation_type, operation_id
    ) values (
      p_biometric_proof_id, p_tenant_id, p_reserve_id, p_master_id,
      'lending.create', p_movement_id
    );
  elsif p_biometric_proof_id is not null then
    raise exception 'LENDING_TOTP_PROOF_MISMATCH' using errcode = 'P0001';
  end if;

  if p_auth_mode = 'totp' then
    if p_totp_claim_id is null then
      raise exception 'LENDING_TOTP_CLAIM_REQUIRED' using errcode = 'P0001';
    end if;

    select * into v_claim
      from totp_identity_claims
     where id = p_totp_claim_id and tenant_id = p_tenant_id
     for update;
    if v_claim.id is null
       or v_claim.reserve_id is distinct from p_reserve_id
       or v_claim.actor_id is distinct from p_master_id
       or v_claim.profile_id is distinct from p_military_id
       or v_claim.created_at <= now() - interval '2 minutes' then
      raise exception 'LENDING_TOTP_CLAIM_INVALID' using errcode = 'P0001';
    end if;
    if v_claim.consumed_operation_id is not null
       and v_claim.consumed_operation_id is distinct from p_movement_id then
      raise exception 'LENDING_TOTP_CLAIM_ALREADY_CONSUMED' using errcode = 'P0001';
    end if;

    update totp_identity_claims
       set consumed_operation_id = p_movement_id
     where id = p_totp_claim_id
       and consumed_operation_id is null;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_material_id := (v_item->>'material_type_id')::uuid;
    v_quantity := (v_item->>'quantidade')::integer;
    if v_quantity is null or v_quantity < 1 then
      raise exception 'LENDING_BATCH_QUANTITY_INVALID' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from jsonb_array_elements(p_items) other
       where (other->>'material_type_id')::uuid = v_material_id
       group by (other->>'material_type_id')
       having count(*) > 1
    ) then
      raise exception 'LENDING_BATCH_DUPLICATE_MATERIAL' using errcode = 'P0001';
    end if;

    select quantidade_total into v_total
      from material_types
     where id = v_material_id and tenant_id = p_tenant_id
     for update;
    if v_total is null then
      raise exception 'LENDING_MATERIAL_NOT_FOUND' using errcode = 'P0001';
    end if;

    select coalesce(sum(quantidade), 0) into v_active
      from lendings
     where material_type_id = v_material_id
       and tenant_id = p_tenant_id
       and status_legacy = 'ativo';
    if v_active + v_quantity > v_total then
      raise exception 'LENDING_INSUFFICIENT_STOCK' using errcode = 'P0001';
    end if;
  end loop;

  return query
  insert into lendings (
    tenant_id, material_type_id, military_id, master_id, quantidade,
    notes, auth_mode, biometric_proof_id, reserve_id, movement_id
  )
  select
    p_tenant_id,
    (item->>'material_type_id')::uuid,
    p_military_id,
    p_master_id,
    (item->>'quantidade')::smallint,
    p_notes,
    p_auth_mode,
    p_biometric_proof_id,
    p_reserve_id,
    p_movement_id
  from jsonb_array_elements(p_items) item
  returning id;
end;
$$;

revoke execute on function public.record_lending_batch(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb, uuid
) from public, anon, authenticated;

grant execute on function public.record_lending_batch(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb, uuid
) to service_role;

-- record_lending_returns: mesma lógica, chave de idempotência é p_operation_id
-- (já existente para o modo biometria via biometric_proof_consumptions).

create or replace function public.record_lending_returns(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_military_id uuid,
  p_reserve_id uuid,
  p_lending_ids uuid[],
  p_notes text default null,
  p_biometric_proof_id uuid default null,
  p_operation_id uuid default null,
  p_totp_claim_id uuid default null
)
returns table (returned_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_count integer;
  v_returned_count integer;
  v_proof biometric_proofs%rowtype;
  v_existing_consumption biometric_proof_consumptions%rowtype;
  v_claim totp_identity_claims%rowtype;
begin
  if p_tenant_id is null or p_actor_id is null or p_military_id is null or p_reserve_id is null
     or p_lending_ids is null or cardinality(p_lending_ids) = 0 then
    raise exception 'BIOMETRIC_RETURN_INPUT_INVALID' using errcode = 'P0001';
  end if;

  select count(*) into v_expected_count
    from (select distinct unnest(p_lending_ids) as id) requested;

  if exists (
    select 1
      from lendings l
     where l.id = any(p_lending_ids)
       and (l.tenant_id is distinct from p_tenant_id
         or l.reserve_id is distinct from p_reserve_id
         or l.military_id is distinct from p_military_id
         or l.status_legacy is distinct from 'ativo')
  ) then
    raise exception 'BIOMETRIC_RETURN_SCOPE_OR_STATUS_INVALID' using errcode = 'P0001';
  end if;

  if (
    select count(*) from lendings l
     where l.id = any(p_lending_ids)
       and l.tenant_id = p_tenant_id
       and l.reserve_id = p_reserve_id
       and l.military_id = p_military_id
       and l.status_legacy = 'ativo'
  ) <> v_expected_count then
    raise exception 'BIOMETRIC_RETURN_LENDING_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_biometric_proof_id is not null then
    if p_operation_id is null then
      raise exception 'BIOMETRIC_RETURN_OPERATION_REQUIRED' using errcode = 'P0001';
    end if;

    select * into v_proof
      from biometric_proofs
     where id = p_biometric_proof_id
       and tenant_id = p_tenant_id
     for update;

    if v_proof.id is null
       or v_proof.reserve_id is distinct from p_reserve_id
       or v_proof.actor_id is distinct from p_actor_id
       or v_proof.matched_user_id is distinct from p_military_id
       or v_proof.purpose is distinct from 'return'
       or v_proof.result is distinct from 'success'
       or v_proof.liveness_passed is distinct from true
       or v_proof.created_at <= now() - interval '2 minutes' then
      raise exception 'BIOMETRIC_RETURN_PROOF_INVALID' using errcode = 'P0001';
    end if;

    select * into v_existing_consumption
      from biometric_proof_consumptions
     where proof_id = p_biometric_proof_id
     for update;

    if v_existing_consumption.id is not null then
      if v_existing_consumption.operation_type <> 'lending.return'
         or v_existing_consumption.operation_id is distinct from p_operation_id then
        raise exception 'BIOMETRIC_RETURN_PROOF_ALREADY_CONSUMED' using errcode = 'P0001';
      end if;
    else
      insert into biometric_proof_consumptions (
        proof_id, tenant_id, reserve_id, actor_id, operation_type, operation_id
      ) values (
        p_biometric_proof_id, p_tenant_id, p_reserve_id, p_actor_id,
        'lending.return', p_operation_id
      );
    end if;
  elsif p_totp_claim_id is not null then
    select * into v_claim
      from totp_identity_claims
     where id = p_totp_claim_id and tenant_id = p_tenant_id
     for update;
    if v_claim.id is null
       or v_claim.reserve_id is distinct from p_reserve_id
       or v_claim.actor_id is distinct from p_actor_id
       or v_claim.profile_id is distinct from p_military_id
       or v_claim.created_at <= now() - interval '2 minutes' then
      raise exception 'LENDING_TOTP_CLAIM_INVALID' using errcode = 'P0001';
    end if;
    if v_claim.consumed_operation_id is not null
       and v_claim.consumed_operation_id is distinct from p_operation_id then
      raise exception 'LENDING_TOTP_CLAIM_ALREADY_CONSUMED' using errcode = 'P0001';
    end if;

    update totp_identity_claims
       set consumed_operation_id = p_operation_id
     where id = p_totp_claim_id
       and consumed_operation_id is null;
  else
    raise exception 'BIOMETRIC_RETURN_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;

  update lendings
     set status_legacy = 'devolvido',
         status = 'devolvida',
         returned_at = now(),
         observacao_devolucao = coalesce(p_notes, observacao_devolucao)
   where id = any(p_lending_ids)
     and tenant_id = p_tenant_id
     and reserve_id = p_reserve_id
     and military_id = p_military_id
     and status_legacy = 'ativo';
  get diagnostics v_returned_count = row_count;

  update material_items mi
     set status_operacional = 'disponivel',
         current_holder_user_id = null,
         current_unit_id = null,
         active_lending_id = null,
         last_movement_at = now(),
         updated_at = now()
   where mi.id in (
     select l.item_id from lendings l
      where l.id = any(p_lending_ids) and l.item_id is not null
   )
     and mi.tenant_id = p_tenant_id;

  return query select v_returned_count;
end;
$$;

revoke execute on function public.record_lending_returns(
  uuid, uuid, uuid, uuid, uuid[], text, uuid, uuid, uuid
) from public, anon, authenticated;

grant execute on function public.record_lending_returns(
  uuid, uuid, uuid, uuid, uuid[], text, uuid, uuid, uuid
) to service_role;
