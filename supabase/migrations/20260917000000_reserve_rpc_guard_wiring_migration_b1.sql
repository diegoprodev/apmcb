-- SP8 pt.2, Migration B1 — set_material_cautela_eligibility ganha p_actor_id
-- (mudança de assinatura, aditiva) + guard condicional. Ver
-- docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md
-- §3/D2, §4.7 (Migration B1).
--
-- Achado de implementação (não estava explícito na spec): CREATE OR REPLACE
-- FUNCTION com um parâmetro NOVO no final NÃO substitui a função existente —
-- Postgres identifica função por assinatura de TIPOS, então isso criaria um
-- 2º overload (6 args) coexistindo com o antigo, e qualquer chamada sem
-- p_actor_id continuaria batendo no 6-args antigo pra sempre (sem guard,
-- mesmo depois do BFF atualizar — silenciosamente, o pior tipo de bug pra
-- este épico). Fix: DROP explícito da assinatura de 6 args ANTES do CREATE
-- da de 7, garantindo que só existe UMA versão da função a partir daqui.
--
-- Sequência de aplicação (spec §3/D2):
--   1. Esta migration (B1) — aditiva, DEFAULT NULL preserva comportamento
--      atual pra qualquer caller que não passe p_actor_id.
--   2. Deploy do BFF (apps/bff/src/routes/arsenal.ts) passando
--      p_actor_id: c.get("userId").
--   3. Confirmar em prod que p_actor_id chega não-nulo, DEPOIS aplicar
--      Migration B2 (remove o DEFAULT, torna obrigatório).
--
-- Guard inserido ANTES do `SELECT ... FOR UPDATE` (achado MÉDIO #3 da
-- revisão de arquitetura da spec) — não depende de nenhuma linha travada,
-- e esta função já teve 1 CRÍTICO de concorrência resolvido antes
-- (comentário em apps/bff/src/routes/arsenal.ts, handler PATCH /:id):
-- rejeitar ator não autorizado ANTES de disputar o lock é o padrão mais
-- conservador, consistente com as outras 8 assinaturas já guardadas na
-- Migration A.
--
-- ROLLBACK: ver bloco no fim (comentado).

DROP FUNCTION IF EXISTS public.set_material_cautela_eligibility(uuid, uuid, uuid, boolean, integer, uuid[]);

CREATE FUNCTION public.set_material_cautela_eligibility(
  p_tenant_id uuid,
  p_reserve_id uuid,
  p_material_type_id uuid,
  p_cautela_habilitada boolean,
  p_quantidade_cautela integer DEFAULT NULL::integer,
  p_eligible_item_ids uuid[] DEFAULT NULL::uuid[],
  p_actor_id uuid DEFAULT NULL::uuid
)
 RETURNS TABLE(cautela_habilitada boolean, quantidade_cautela integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- SP8 (docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md
  -- §3/D2, §4.7): prova que p_actor_id está autorizado a escrever em
  -- p_reserve_id. Condicional (IS NOT NULL) enquanto o BFF não migrar
  -- (Migration B1) — vira incondicional na B2, quando o DEFAULT sair.
  if p_actor_id is not null then
    perform assert_actor_in_reserve(p_actor_id, p_reserve_id);
  end if;

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
$function$;

REVOKE ALL ON FUNCTION public.set_material_cautela_eligibility(uuid, uuid, uuid, boolean, integer, uuid[], uuid) FROM PUBLIC, anon, authenticated;

-- ROLLBACK (referência, não executado):
--   DROP FUNCTION IF EXISTS public.set_material_cautela_eligibility(uuid, uuid, uuid, boolean, integer, uuid[], uuid);
--   CREATE FUNCTION public.set_material_cautela_eligibility(p_tenant_id uuid, p_reserve_id uuid, p_material_type_id uuid, p_cautela_habilitada boolean, p_quantidade_cautela integer DEFAULT NULL::integer, p_eligible_item_ids uuid[] DEFAULT NULL::uuid[])
--     RETURNS TABLE(cautela_habilitada boolean, quantidade_cautela integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$ ... corpo original sem o guard ... $$;
--   -- corpo original completo e versionado em
--   -- supabase/migrations/20260822040000_cautela_edit_rpc_hardening.sql
