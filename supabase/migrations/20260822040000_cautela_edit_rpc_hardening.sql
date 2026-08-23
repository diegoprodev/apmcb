-- Achados de code review sobre 20260822020000 (já aplicada em produção):
--
-- [ALTO] Os UPDATE material_items dos ramos "desabilitar" e "habilitada=
-- false" não repetiam o filtro `tenant_id = p_tenant_id`, ao contrário do
-- ramo "habilitar" (que já validava o array de ids contra tenant_id
-- explicitamente). Hoje material_items.tenant_id sempre deveria coincidir
-- com o do seu material_type, então não é explorável agora — mas é uma
-- inconsistência real numa função security definer que, no resto do corpo,
-- trata tenant_id como algo que precisa ser revalidado sempre. Uniformizado.
--
-- [MÉDIO] p_eligible_item_ids com ids duplicados fazia a validação de
-- contagem (`count(*) WHERE id = ANY(...)` vs `array_length(...)`) falhar
-- por um motivo errado — id é PK, então duplicatas no array nunca inflam a
-- contagem, mas inflam array_length, gerando CAUTELA_ITEM_INVALID mesmo
-- quando todos os ids são válidos. O caminho de produção (frontend usa um
-- Set) nunca gera duplicatas, mas a RPC é chamável diretamente e a
-- validação não deveria depender disso. Array deduplicado antes de
-- qualquer comparação.
--
-- Assinatura inalterada — CREATE OR REPLACE substitui no lugar.

create or replace function public.set_material_cautela_eligibility(
  p_tenant_id uuid,
  p_reserve_id uuid,
  p_material_type_id uuid,
  p_cautela_habilitada boolean,
  p_quantidade_cautela integer default null,
  p_eligible_item_ids uuid[] default null
)
returns table (
  cautela_habilitada boolean,
  quantidade_cautela integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_material material_types%rowtype;
  v_was_enabled boolean;
  v_scenario_a boolean;
  v_target integer;
  v_base_index integer;
  v_delta integer;
  v_cautelado_count integer;
  v_removable_count integer;
  v_eligible_count integer;
  v_dedup_ids uuid[];
begin
  select * into v_material
    from material_types
   where id = p_material_type_id
     and tenant_id = p_tenant_id
     and reserve_id = p_reserve_id
   for update;

  if v_material.id is null then
    raise exception 'MATERIAL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not v_material.ativo then
    raise exception 'MATERIAL_INACTIVE: Material está desativado' using errcode = 'P0001';
  end if;

  v_was_enabled := v_material.cautela_habilitada;
  v_scenario_a := v_material.has_serial_numbers or v_material.requires_validity;

  if v_was_enabled and not p_cautela_habilitada then
    select count(*) into v_cautelado_count
      from material_items
     where material_type_id = p_material_type_id
       and tenant_id = p_tenant_id
       and status_operacional = 'cautelado';
    if v_cautelado_count > 0 then
      raise exception 'CAUTELA_HAS_ACTIVE_CUSTODY: Não é possível desabilitar cautela: % item(ns) em custódia ativa (cautelado)', v_cautelado_count
        using errcode = 'P0001';
    end if;

    if not v_scenario_a then
      delete from material_items
       where material_type_id = p_material_type_id
         and tenant_id = p_tenant_id
         and tipo_identificador = 'interno'
         and status_operacional = 'disponivel';
    end if;

    update material_items
       set cautela_elegivel = false
     where material_type_id = p_material_type_id
       and tenant_id = p_tenant_id;

    update material_types
       set cautela_habilitada = false, quantidade_cautela = 0
     where id = p_material_type_id;

    return query select false, 0;
    return;
  end if;

  if v_scenario_a then
    if p_cautela_habilitada then
      v_dedup_ids := array(select distinct unnest(p_eligible_item_ids));

      if v_dedup_ids is null or array_length(v_dedup_ids, 1) is null then
        raise exception 'CAUTELA_NO_ITEMS: Selecione ao menos uma unidade (número de série ou validade) para habilitar a cautela neste material'
          using errcode = 'P0001';
      end if;

      select count(*) into v_eligible_count
        from material_items
       where id = any(v_dedup_ids)
         and material_type_id = p_material_type_id
         and tenant_id = p_tenant_id
         and status_operacional in ('disponivel', 'cautelado', 'em_saida', 'manutencao', 'inapto');

      if v_eligible_count <> array_length(v_dedup_ids, 1) then
        raise exception 'CAUTELA_ITEM_INVALID: Um ou mais itens selecionados não pertencem a este material ou não estão em um estado elegível'
          using errcode = 'P0001';
      end if;

      update material_items
         set cautela_elegivel = false
       where material_type_id = p_material_type_id
         and tenant_id = p_tenant_id;

      update material_items
         set cautela_elegivel = true
       where id = any(v_dedup_ids)
         and tenant_id = p_tenant_id;

      v_target := v_eligible_count;
    else
      v_target := 0;
      update material_items
         set cautela_elegivel = false
       where material_type_id = p_material_type_id
         and tenant_id = p_tenant_id;
    end if;

    update material_types
       set cautela_habilitada = p_cautela_habilitada, quantidade_cautela = v_target
     where id = p_material_type_id;

    return query select p_cautela_habilitada, v_target;
    return;
  end if;

  -- Cenário B a partir daqui — inalterado (quantidade numérica, itens
  -- sintéticos e interpermutáveis).
  if not p_cautela_habilitada then
    v_target := 0;
    update material_types
       set cautela_habilitada = false, quantidade_cautela = 0
     where id = p_material_type_id;
    return query select false, 0;
    return;
  end if;

  v_target := coalesce(p_quantidade_cautela, v_material.quantidade_cautela);
  if v_target is null or v_target < 1 then
    raise exception 'CAUTELA_QTY_INVALID: Informe a quantidade reservada para cautela (maior que zero)'
      using errcode = 'P0001';
  end if;
  if v_target > v_material.quantidade_total then
    raise exception 'CAUTELA_QTY_EXCEEDS_TOTAL: Quantidade reservada para cautela não pode exceder a quantidade total do material'
      using errcode = 'P0001';
  end if;

  select coalesce(max(substring(identificador_principal from '(\d+)$')::integer), 0) into v_base_index
    from material_items
   where material_type_id = p_material_type_id
     and tipo_identificador = 'interno';

  v_delta := v_target - (
    select count(*) from material_items
     where material_type_id = p_material_type_id
       and tipo_identificador = 'interno'
  );

  if v_delta > 0 then
    insert into material_items (
      tenant_id, material_type_id, tipo_identificador, identificador_principal,
      numero_serie, validade_item, descricao_adicional, current_unit_id, cautela_elegivel
    )
    select
      p_tenant_id,
      p_material_type_id,
      'interno',
      v_material.categoria_slug || '-' || p_material_type_id || '-' || (v_base_index + gs),
      null, null, null,
      p_reserve_id, true
    from generate_series(1, v_delta) as gs;
  elsif v_delta < 0 then
    with removable as (
      select id from material_items
       where material_type_id = p_material_type_id
         and tipo_identificador = 'interno'
         and status_operacional = 'disponivel'
       order by substring(identificador_principal from '(\d+)$')::integer desc
       limit (-v_delta)
    )
    delete from material_items where id in (select id from removable);

    get diagnostics v_removable_count = row_count;
    if v_removable_count < -v_delta then
      raise exception 'CAUTELA_QTY_REDUCE_BLOCKED: Não é possível reduzir a quantidade reservada: apenas % unidade(s) disponível(is) para remover (as demais estão em uso)', v_removable_count
        using errcode = 'P0001';
    end if;
  end if;

  update material_items
     set cautela_elegivel = true
   where material_type_id = p_material_type_id
     and tipo_identificador = 'interno';

  update material_types
     set cautela_habilitada = true, quantidade_cautela = v_target
   where id = p_material_type_id;

  return query select true, v_target;
end;
$$;

revoke execute on function public.set_material_cautela_eligibility(
  uuid, uuid, uuid, boolean, integer, uuid[]
) from public, anon, authenticated;

grant execute on function public.set_material_cautela_eligibility(
  uuid, uuid, uuid, boolean, integer, uuid[]
) to service_role;
