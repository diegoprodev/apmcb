-- SP8 pt.2, Migration B2 — set_material_cautela_eligibility: guard vira
-- INCONDICIONAL. Ver
-- docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md
-- §3/D2 (passo 3), achado ALTO #1 da revisão de arquitetura da spec.
--
-- Achado de implementação (corrigido ANTES de aplicar, não em produção):
-- a spec original previa "remover o DEFAULT de p_actor_id" pra torná-lo
-- obrigatório na assinatura. Isso é sintaticamente INVÁLIDO em Postgres —
-- `p_quantidade_cautela` e `p_eligible_item_ids` (parâmetros anteriores)
-- têm DEFAULT; a regra da linguagem exige que todo parâmetro DEPOIS de um
-- com DEFAULT também tenha DEFAULT. Reordenar p_actor_id pra antes deles
-- mudaria a assinatura de TIPOS (exigindo DROP+CREATE de novo, como na B1).
--
-- Fix mais simples e igualmente seguro: manter `p_actor_id uuid DEFAULT
-- NULL::uuid` (mesma assinatura da B1, CREATE OR REPLACE de verdade, sem
-- DROP) e tornar o `PERFORM assert_actor_in_reserve(...)` INCONDICIONAL —
-- o helper (supabase/migrations/20260915230000_reserve_rpc_guard_helpers.sql)
-- já falha fechado quando p_actor_id é NULL e o caller não é o cron real
-- (session_user≠'postgres'): a busca em `profiles WHERE id = NULL` não
-- acha linha, `v_actor_tenant IS NULL` dispara `RAISE 'ator não
-- encontrado'`. Ou seja: uma chamada sem ator real já é rejeitada de
-- qualquer forma — não precisa do DEFAULT sumir da assinatura pra fechar
-- o gap, só o corpo parar de pular o guard quando p_actor_id é NULL.
--
-- Pré-condição confirmada antes de aplicar (2026-09-17):
-- 1. Migration B1 aplicada em prod (assinatura de 7 args confirmada via
--    pg_get_function_identity_arguments).
-- 2. Deploy do BFF com apps/bff/src/routes/arsenal.ts enviando
--    p_actor_id: c.get("userId") confirmado no ar (CI/CD "Deploy BFF (VPS)"
--    verde, PR #44 mergeado).
-- 3. Garantia estrutural de que p_actor_id nunca chega NULL nesta rota:
--    PATCH /api/arsenal/:id roda atrás de roleGuard("admin_reserva"), que
--    depende do middleware apps/bff/src/middleware/auth.ts já ter rodado
--    (c.set("userId", ...) a partir de sessão válida) — não existe caminho
--    pra esse handler executar sem userId preenchido. Validação end-to-end
--    via Playwright não pôde ser feita nesta sessão (browser MCP ocupado
--    por outra instância) — a garantia estrutural do middleware + staging
--    exaustivo (SP8 pt.2 Migration B1) + o próprio fail-closed do helper
--    (parágrafo acima) substituem essa evidência.
--
-- A partir desta migration: mesmo uma chamada hipotética sem p_actor_id
-- (BFF revertido/quebrado) falha com o RAISE do helper — nunca mais
-- silenciosamente aceita. Fecha o gap que a Migration B1 deixava aberto
-- (guard condicional, indetectável pelo gate 5 do CI se o BFF nunca
-- enviasse o valor).
--
-- ROLLBACK: ver bloco no fim (comentado).

CREATE OR REPLACE FUNCTION public.set_material_cautela_eligibility(
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
  -- §3/D2 passo 3): incondicional a partir daqui — mesmo com p_actor_id
  -- NULL (BFF revertido/quebrado), o helper falha fechado (ator "não
  -- encontrado"), nunca mais pula a checagem.
  perform assert_actor_in_reserve(p_actor_id, p_reserve_id);

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

-- ROLLBACK (referência, não executado): NÃO reaplicar o arquivo B1 direto
-- — ele usa DROP FUNCTION(6 args, que já não existe) + CREATE FUNCTION
-- puro (sem OR REPLACE), que falharia com "function already exists" contra
-- a versão de 7 args já criada por este B2. Rollback real:
--   CREATE OR REPLACE FUNCTION public.set_material_cautela_eligibility(
--     p_tenant_id uuid, p_reserve_id uuid, p_material_type_id uuid,
--     p_cautela_habilitada boolean,
--     p_quantidade_cautela integer DEFAULT NULL::integer,
--     p_eligible_item_ids uuid[] DEFAULT NULL::uuid[],
--     p_actor_id uuid DEFAULT NULL::uuid
--   ) RETURNS TABLE(cautela_habilitada boolean, quantidade_cautela integer)
--     LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
--     ... corpo idêntico ao da Migration B1 (guard condicional
--     IF p_actor_id IS NOT NULL THEN ... END IF) ...
--   $$;
--   (corpo completo versionado em
--   supabase/migrations/20260917000000_reserve_rpc_guard_wiring_migration_b1.sql)
