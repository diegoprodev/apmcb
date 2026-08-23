-- Pedido do usuário: hoje, quando um material tem rastreio individual
-- (número de série ou validade — Cenário A), habilitar "Disponibilizar
-- para cautela" reserva automaticamente TODAS as unidades cadastradas,
-- sem opção de escolher especificamente quais. "às vezes a gestão quer
-- apenas disponibilizar alguns itens específicos do acervo." Fix: elegi-
-- bilidade de cautela passa a ser decidida por ITEM, não só por tipo.
--
-- material_types.cautela_habilitada continua sendo o gate de tipo (CAU-06:
-- nenhum item de um tipo desabilitado pode ser cautelado, checagem
-- inalterada). A coluna nova, material_items.cautela_elegivel, é um
-- segundo gate — um item só é elegível se AMBOS os flags forem true.
-- Cenário B (material bulk, itens sintéticos) continua funcionando
-- exatamente como antes (quantidade numérica, sem seleção individual —
-- itens sintéticos são anônimos e interpermutáveis, não faz sentido
-- "escolher" um em vez de outro); os itens sintéticos passam a nascer com
-- cautela_elegivel=true (representam 1:1 a fração reservada).

ALTER TABLE public.material_items
  ADD COLUMN IF NOT EXISTS cautela_elegivel boolean NOT NULL DEFAULT false;

-- Backfill: preserva o comportamento atual ("todas as unidades elegíveis")
-- pros materiais já cadastrados com cautela_habilitada=true — sem isso,
-- todo material existente perderia elegibilidade de cautela da noite pro
-- dia. Mesmo conjunto de status considerado elegível já usado pela RPC de
-- edição (exclui baixado/extraviado, que não representam mais estoque
-- físico real).
UPDATE public.material_items mi
SET cautela_elegivel = true
FROM public.material_types mt
WHERE mi.material_type_id = mt.id
  AND mt.cautela_habilitada = true
  AND mi.status_operacional IN ('disponivel', 'cautelado', 'em_saida', 'manutencao', 'inapto');

CREATE INDEX IF NOT EXISTS idx_material_items_cautela_elegivel
  ON public.material_items (material_type_id)
  WHERE cautela_elegivel = true;

-- Reescreve set_material_cautela_eligibility (20260818120000): Cenário A
-- agora recebe a lista explícita de itens elegíveis (p_eligible_item_ids)
-- em vez de marcar "todos" automaticamente. Assinatura muda (novo
-- parâmetro) — DROP explícito antes do CREATE OR REPLACE, já que Postgres
-- só substitui no lugar quando a lista de parâmetros é idêntica.
DROP FUNCTION IF EXISTS public.set_material_cautela_eligibility(uuid, uuid, uuid, boolean, integer);

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

  -- Desabilitar: bloqueado se algum item deste material já está em custódia
  -- ativa — não dá pra "desabilitar" com alguém de posse de um item cauteloado.
  if v_was_enabled and not p_cautela_habilitada then
    select count(*) into v_cautelado_count
      from material_items
     where material_type_id = p_material_type_id
       and status_operacional = 'cautelado';
    if v_cautelado_count > 0 then
      raise exception 'CAUTELA_HAS_ACTIVE_CUSTODY: Não é possível desabilitar cautela: % item(ns) em custódia ativa (cautelado)', v_cautelado_count
        using errcode = 'P0001';
    end if;

    -- Cenário B: os itens sintéticos existiam só pra representar a fração
    -- reservada — sem cautela habilitada essa fração volta pro estoque
    -- geral, então os itens ainda 'disponivel' (nunca cautelados nem em
    -- outro estado, já garantido pelo check acima) são removidos. Cenário A
    -- mantém os material_items reais intocados — só os flags mudam.
    if not v_scenario_a then
      delete from material_items
       where material_type_id = p_material_type_id
         and tipo_identificador = 'interno'
         and status_operacional = 'disponivel';
    end if;

    update material_items
       set cautela_elegivel = false
     where material_type_id = p_material_type_id;

    update material_types
       set cautela_habilitada = false, quantidade_cautela = 0
     where id = p_material_type_id;

    return query select false, 0;
    return;
  end if;

  if v_scenario_a then
    if p_cautela_habilitada then
      if p_eligible_item_ids is null or array_length(p_eligible_item_ids, 1) is null then
        raise exception 'CAUTELA_NO_ITEMS: Selecione ao menos uma unidade (número de série ou validade) para habilitar a cautela neste material'
          using errcode = 'P0001';
      end if;

      -- Nunca confiar no array vindo do cliente: valida que TODOS os ids
      -- pertencem a este material/tenant e estão num status elegível antes
      -- de aplicar qualquer coisa.
      select count(*) into v_eligible_count
        from material_items
       where id = any(p_eligible_item_ids)
         and material_type_id = p_material_type_id
         and tenant_id = p_tenant_id
         and status_operacional in ('disponivel', 'cautelado', 'em_saida', 'manutencao', 'inapto');

      if v_eligible_count <> array_length(p_eligible_item_ids, 1) then
        raise exception 'CAUTELA_ITEM_INVALID: Um ou mais itens selecionados não pertencem a este material ou não estão em um estado elegível'
          using errcode = 'P0001';
      end if;

      -- Full replace, idempotente: desmarca todos os itens deste material,
      -- depois marca só os selecionados.
      update material_items
         set cautela_elegivel = false
       where material_type_id = p_material_type_id;

      update material_items
         set cautela_elegivel = true
       where id = any(p_eligible_item_ids);

      v_target := v_eligible_count;
    else
      v_target := 0;
      update material_items
         set cautela_elegivel = false
       where material_type_id = p_material_type_id;
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

  -- Base do índice pro identificador_principal dos novos itens sintéticos:
  -- MAX do sufixo numérico já persistido (não COUNT) — correto mesmo com
  -- buracos na numeração deixados por remoções anteriores.
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
