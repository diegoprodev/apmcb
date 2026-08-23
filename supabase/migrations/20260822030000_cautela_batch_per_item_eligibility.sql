-- Continuação de 20260822020000 (elegibilidade de cautela por item, não só
-- por tipo): record_cautelamento_batch é um SEGUNDO caminho de criação de
-- cautela (fluxo multi-item, ver docs/enterprise/specs/cautela-multi-item-
-- batch-enterprise.md), independente do fluxo singular em
-- POST /api/cautelamentos — precisa da MESMA checagem CAU-06 reforçada, ou
-- o gate por item vira decorativo pra qualquer cautela criada em lote.
-- Assinatura inalterada — CREATE OR REPLACE substitui no lugar.

create or replace function public.record_cautelamento_batch(
  p_tenant_id uuid,
  p_armeiro_id uuid,
  p_militar_id uuid,
  p_reserve_id uuid,
  p_movement_id uuid,
  p_motivo_emissao text,
  p_items jsonb
)
returns table (cautelamento_id uuid, item_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_document_hash text;
  v_status_operacional text;
  v_cautela_habilitada boolean;
  v_cautela_elegivel boolean;
  v_validade_item date;
  v_hoje_local date;
begin
  if p_tenant_id is null or p_armeiro_id is null or p_militar_id is null
     or p_reserve_id is null or p_movement_id is null
     or p_motivo_emissao is null or length(trim(p_motivo_emissao)) < 3
     or p_items is null or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 50 then
    raise exception 'CAUTELA_BATCH_INPUT_INVALID' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || p_movement_id::text));

  if exists (
    select 1 from cautelamentos c
     where c.tenant_id = p_tenant_id and c.movement_id = p_movement_id
  ) then
    if exists (
      select 1 from cautelamentos c
       where c.tenant_id = p_tenant_id and c.movement_id = p_movement_id
         and (c.militar_id is distinct from p_militar_id
           or c.reserve_id is distinct from p_reserve_id)
    ) then
      raise exception 'CAUTELA_MOVEMENT_SCOPE_INVALID' using errcode = 'P0001';
    end if;
    if exists (
      select 1
      from (
        select c.item_id from cautelamentos c
         where c.tenant_id = p_tenant_id and c.movement_id = p_movement_id
      ) persisted
      full outer join (
        select (item->>'item_id')::uuid as item_id
          from jsonb_array_elements(p_items) item
      ) requested
        on persisted.item_id = requested.item_id
      where persisted.item_id is null or requested.item_id is null
    ) then
      raise exception 'CAUTELA_MOVEMENT_ITEMS_MISMATCH' using errcode = 'P0001';
    end if;
    return query select c.id, c.item_id from cautelamentos c
      where c.tenant_id = p_tenant_id and c.movement_id = p_movement_id
      order by c.id;
    return;
  end if;

  if not exists (
    select 1 from profiles p
     where p.id = p_militar_id and p.default_tenant_id = p_tenant_id
  ) then
    raise exception 'CAUTELA_MILITAR_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from reserves r
     where r.id = p_reserve_id and r.tenant_id = p_tenant_id
  ) then
    raise exception 'CAUTELA_RESERVE_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_hoje_local := (now() at time zone 'America/Sao_Paulo')::date;

  for v_item in select value from jsonb_array_elements(p_items) order by (value->>'item_id')::uuid
  loop
    v_item_id := (v_item->>'item_id')::uuid;
    v_document_hash := v_item->>'document_hash';

    if v_item_id is null or v_document_hash is null or length(v_document_hash) = 0 then
      raise exception 'CAUTELA_BATCH_ITEM_INVALID' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from jsonb_array_elements(p_items) other
       where (other->>'item_id')::uuid = v_item_id
       group by (other->>'item_id')
       having count(*) > 1
    ) then
      raise exception 'CAUTELA_BATCH_DUPLICATE_ITEM' using errcode = 'P0001';
    end if;

    select mi.status_operacional, mi.validade_item, mt.cautela_habilitada, mi.cautela_elegivel
      into v_status_operacional, v_validade_item, v_cautela_habilitada, v_cautela_elegivel
      from material_items mi
      join material_types mt on mt.id = mi.material_type_id
     where mi.id = v_item_id and mi.tenant_id = p_tenant_id
     for update of mi;

    if v_status_operacional is null then
      raise exception 'CAUTELA_ITEM_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_status_operacional <> 'disponivel' then
      raise exception 'CAUTELA_ITEM_NOT_AVAILABLE' using errcode = 'P0001';
    end if;
    -- CAU-06: dois gates independentes desde a elegibilidade por item — o
    -- TIPO precisa estar habilitado E o ITEM específico precisa estar
    -- marcado como elegível (20260822020000).
    if not coalesce(v_cautela_habilitada, false) or not coalesce(v_cautela_elegivel, false) then
      raise exception 'CAUTELA_ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;
    if v_validade_item is not null and v_validade_item < v_hoje_local then
      raise exception 'CAUTELA_ITEM_EXPIRED' using errcode = 'P0001';
    end if;
  end loop;

  return query
  with inserted as (
    insert into cautelamentos as c (
      tenant_id, reserve_id, item_id, militar_id, armeiro_id,
      condicao_emissao, motivo_emissao, prazo_proxima_conferencia,
      document_hash, movement_id
    )
    select
      p_tenant_id, p_reserve_id, (item->>'item_id')::uuid, p_militar_id, p_armeiro_id,
      coalesce(item->>'condicao_emissao', 'bom'),
      p_motivo_emissao,
      nullif(item->>'prazo_proxima_conferencia', '')::date,
      item->>'document_hash',
      p_movement_id
    from jsonb_array_elements(p_items) item
    returning c.id, c.item_id
  ),
  updated as (
    update material_items mi
       set status_operacional = 'cautelado',
           current_holder_user_id = p_militar_id,
           active_cautelamento_id = ins.id,
           last_movement_at = now()
      from inserted ins
     where mi.id = ins.item_id
       and mi.tenant_id = p_tenant_id
       and mi.status_operacional = 'disponivel'
    returning mi.id
  )
  select ins.id, ins.item_id from inserted ins;
end;
$$;

revoke execute on function public.record_cautelamento_batch(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;

grant execute on function public.record_cautelamento_batch(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;
