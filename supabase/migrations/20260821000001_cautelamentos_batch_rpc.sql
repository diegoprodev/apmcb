-- Cautela com múltiplos materiais — Fase 2: RPC de criação em lote
-- Ver docs/enterprise/specs/cautela-multi-item-batch-enterprise.md (CMB).
--
-- Espelha record_lending_batch (20260818110000_cautela_reserve_excludes_
-- daily_stock.sql), mas com a granularidade certa pra cautela: por item
-- físico (material_items.id), não por tipo+quantidade — cada cautela é
-- sempre exatamente 1 item, sem conceito de quantidade.
--
-- Requisitos incorporados da revisão adversarial do plano (ver plano
-- aprovado): document_hash calculado no BFF (TypeScript, hashDocument()) e
-- passado já pronto por item — nunca recalculado em SQL, pra não divergir
-- do algoritmo canônico; validade comparada em America/Sao_Paulo, não
-- CURRENT_DATE puro (bug de fronteira UTC-3 já corrigido uma vez no fluxo
-- singular, não pode voltar aqui); toda query filtra tenant_id
-- explicitamente — o BFF chama com a service role key, então RLS é
-- bypassada e este filtro escrito à mão É o isolamento real de tenant.

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

  -- Achado de code review: sem isto, duas requisições concorrentes com o
  -- MESMO movement_id (duplo clique real, não sequencial) passavam ambas
  -- pelo "not exists" abaixo antes de qualquer commit, avançavam, e uma
  -- delas acabava vendo o item já 'cautelado' pela outra — recebendo
  -- CAUTELA_ITEM_NOT_AVAILABLE para uma operação que na verdade já tinha
  -- sido concluída com sucesso pela requisição irmã. Serializa por
  -- (tenant, movement_id) ANTES do check de idempotência — barato (hash de
  -- dois UUIDs), e a segunda requisição concorrente só entra depois que a
  -- primeira já commitou, batendo no caminho idempotente normalmente.
  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || p_movement_id::text));

  -- Idempotência: replay de uma operação já persistida com o mesmo
  -- movement_id (duplo clique / retry de rede) não revalida nada, só
  -- devolve o que já existe — desde que escopo e itens batam exatamente.
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

  -- Validação por item — cada iteração já trava a linha de material_items
  -- (for update), então o lock é mantido até o commit/rollback da própria
  -- transação: nenhum outro request concorrente consegue reservar o mesmo
  -- item entre a validação aqui e o insert/update no fim da função. Ordem
  -- de lock por item_id (achado de code review): sem isso, dois lotes que
  -- compartilham 2+ itens em ordem inversa no array (Lote A=[x,y], Lote
  -- B=[y,x]) travariam em espera circular — deadlock real (40P01) que o
  -- BFF trataria como erro 500 genérico. Ordenar a iteração garante que
  -- toda transação adquire os locks sempre na mesma ordem.
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

    select mi.status_operacional, mi.validade_item, mt.cautela_habilitada
      into v_status_operacional, v_validade_item, v_cautela_habilitada
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
    -- CAU-06: mesma fronteira de segurança do fluxo singular — nunca
    -- confiar que o frontend só ofereceu itens elegíveis.
    if not coalesce(v_cautela_habilitada, false) then
      raise exception 'CAUTELA_ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;
    if v_validade_item is not null and v_validade_item < v_hoje_local then
      raise exception 'CAUTELA_ITEM_EXPIRED' using errcode = 'P0001';
    end if;
  end loop;

  return query
  with inserted as (
    -- Alias "c" + colunas qualificadas no RETURNING: "item_id" desqualificado
    -- aqui colide com o parâmetro de saída da função (RETURNS TABLE declara
    -- uma variável plpgsql implícita também chamada item_id) — sem o alias,
    -- Postgres não sabe se "item_id" é a coluna da tabela ou a variável.
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
