-- Biometric Bridge Phase 1A.2: atomic multi-material lending.
-- A movement is one transaction: stock checks, proof consumption and all
-- lending rows either succeed together or none is persisted.

create or replace function public.record_lending_batch(
  p_tenant_id uuid,
  p_master_id uuid,
  p_military_id uuid,
  p_reserve_id uuid,
  p_movement_id uuid,
  p_notes text,
  p_auth_mode text,
  p_biometric_proof_id uuid,
  p_items jsonb
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
    -- Replay do mesmo movement_id só é seguro se os itens forem exatamente os
    -- mesmos já persistidos — achado de code review: sem essa checagem, um
    -- retry com lista de materiais diferente (bug de cliente, movement_id
    -- reaproveitado) devolvia silenciosamente os itens ANTIGOS com 200,
    -- dando a impressão de sucesso para materiais que nunca foram de fato
    -- registrados. uq_lendings_movement_material garante 1 linha por
    -- material dentro do mesmo movement_id, então o full outer join abaixo
    -- é suficiente (sem precisar contar duplicatas).
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

revoke all on function public.record_lending_batch(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb
) from public;

grant execute on function public.record_lending_batch(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb
) to service_role;
