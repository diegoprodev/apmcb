-- CAU-08 (docs/enterprise/specs/cautela-eligibility-quantity-enterprise.md):
-- achado CRÍTICO de code review no endpoint PATCH /api/arsenal/:id (edição
-- de cautela_habilitada/quantidade_cautela em material já cadastrado) —
-- a primeira versão fazia leitura+decisão+escrita em vários passos
-- sequenciais no BFF, sem SELECT ... FOR UPDATE nem transação. Dois PATCH
-- concorrentes no mesmo material podiam produzir um resultado final
-- inconsistente (ex: quantidade_cautela=6 gravado com 0 material_items reais
-- por trás, se um PATCH de aumento e um PATCH de desabilitação intercalarem
-- leituras/escritas) — inaceitável num sistema de governança de armamento.
--
-- Fix: toda a decisão (que itens sintéticos criar/remover, qual
-- quantidade_cautela final gravar) agora roda dentro desta RPC, com
-- `SELECT ... FOR UPDATE` no material_types travando a linha pra qualquer
-- segundo PATCH concorrente esperar o primeiro terminar — mesmo padrão já
-- usado por record_lending_batch (20260714000010) e agora por esta mesma
-- migration em record_lending_batch de novo (20260818110000).
--
-- Também corrige, achado ALTO do mesmo review: o índice numérico usado pra
-- montar identificador_principal dos itens sintéticos (Cenário B) agora vem
-- de MAX(sufixo numérico já persistido), não de COUNT(*) nem de uma
-- suposição de ordenação por created_at — um INSERT de N linhas na mesma
-- instrução grava o MESMO created_at em todas (sem desempate), então COUNT
-- após uma remoção parcial não garantia a faixa contígua 1..N que a versão
-- anterior assumia, criando risco real de colisão com a constraint
-- UNIQUE (tenant_id, tipo_identificador, identificador_principal). Usar
-- MAX(sufixo) é correto mesmo com "buracos" na numeração.
--
-- E o achado ALTO de contagem no Cenário A: itens com status_operacional
-- terminal (baixado/extraviado) nunca deveriam contar como elegíveis pra
-- cautela — ficariam subtraindo estoque de saída diária por uma unidade que
-- já nem existe fisicamente.

create or replace function public.set_material_cautela_eligibility(
  p_tenant_id uuid,
  p_reserve_id uuid,
  p_material_type_id uuid,
  p_cautela_habilitada boolean,
  p_quantidade_cautela integer default null
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
    -- mantém os material_items reais intocados — só o flag muda.
    if not v_scenario_a then
      delete from material_items
       where material_type_id = p_material_type_id
         and tipo_identificador = 'interno'
         and status_operacional = 'disponivel';
    end if;

    update material_types
       set cautela_habilitada = false, quantidade_cautela = 0
     where id = p_material_type_id;

    return query select false, 0;
    return;
  end if;

  if v_scenario_a then
    -- Elegibilidade é "todas as unidades já cadastradas" (CAU-02) — exclui
    -- estados terminais (baixado/extraviado), que não representam mais
    -- estoque físico real disponível pra nenhum fluxo.
    select count(*) into v_eligible_count
      from material_items
     where material_type_id = p_material_type_id
       and status_operacional in ('disponivel', 'cautelado', 'em_saida', 'manutencao', 'inapto');
    if p_cautela_habilitada and v_eligible_count < 1 then
      raise exception 'CAUTELA_NO_ITEMS: Cadastre ao menos uma unidade (número de série ou validade) para habilitar a cautela neste material'
        using errcode = 'P0001';
    end if;
    v_target := case when p_cautela_habilitada then v_eligible_count else 0 end;

    update material_types
       set cautela_habilitada = p_cautela_habilitada, quantidade_cautela = v_target
     where id = p_material_type_id;

    return query select p_cautela_habilitada, v_target;
    return;
  end if;

  -- Cenário B a partir daqui.
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
      numero_serie, validade_item, descricao_adicional, current_unit_id
    )
    select
      p_tenant_id,
      p_material_type_id,
      'interno',
      v_material.categoria_slug || '-' || p_material_type_id || '-' || (v_base_index + gs),
      null, null, null,
      p_reserve_id
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

  update material_types
     set cautela_habilitada = true, quantidade_cautela = v_target
   where id = p_material_type_id;

  return query select true, v_target;
end;
$$;

revoke execute on function public.set_material_cautela_eligibility(
  uuid, uuid, uuid, boolean, integer
) from public, anon, authenticated;

grant execute on function public.set_material_cautela_eligibility(
  uuid, uuid, uuid, boolean, integer
) to service_role;
