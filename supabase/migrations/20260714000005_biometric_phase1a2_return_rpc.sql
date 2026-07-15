-- Biometric Bridge Phase 1A.2: atomic lending return.
-- The BFF calls this function with service_role; all authorization inputs are
-- checked again inside the transaction before any lending or item is changed.

create or replace function public.record_lending_returns(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_military_id uuid,
  p_reserve_id uuid,
  p_lending_ids uuid[],
  p_notes text default null,
  p_biometric_proof_id uuid default null,
  p_operation_id uuid default null
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

revoke all on function public.record_lending_returns(
  uuid, uuid, uuid, uuid, uuid[], text, uuid, uuid
) from public;

grant execute on function public.record_lending_returns(
  uuid, uuid, uuid, uuid, uuid[], text, uuid, uuid
) to service_role;
