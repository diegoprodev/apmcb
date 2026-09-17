-- SP8 pt.2, Migration A — wiring dos guards de reserva (assert_actor_in_reserve/
-- assert_device_in_reserve, criados no SP8 pt.1) nas 6 RPCs de F5 que já têm
-- parâmetro de ator (sem mudança de assinatura). Ver
-- docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md §3/§4
-- (Migration A) e docs/superpowers/specs/2026-09-09-isolamento-reserva-design.md §4.4/§8 (SP8).
--
-- Funções cobertas (8 assinaturas, 6 nomes): record_cautelamento_batch,
-- record_lending_batch (2 overloads), record_lending_returns (2 overloads),
-- record_biometric_enrollment, record_biometric_proof,
-- check_material_validade_vencimento.
--
-- set_material_cautela_eligibility (sem parâmetro de ator, precisa de mudança de
-- assinatura) e a remoção do DEFAULT dessa mesma função ficam em migrations B1/B2
-- separadas (spec §3/D2) — cada uma coordenada com o deploy do BFF, disciplina
-- diferente desta migration (que não depende de nenhum deploy).
--
-- Dormente enquanto tenants.reserve_isolation_enabled = false (default, estado
-- atual de PMPB em prod) — os helpers já fazem `IF NOT flag THEN RETURN` (SP8 pt.1).
-- Testado em staging com dado real antes de aplicar em prod (regra §7 do épico).
--
-- Achado de infra confirmado durante o review desta migration (2026-09-16): os
-- corpos de record_cautelamento_batch e record_lending_batch em PROD já
-- divergiam dos arquivos de migration mais recentes DESSAS funções no repo
-- (`20260828070000_cautela_batch_prazo_devolucao.sql`,
-- `20260714000006_biometric_phase1a2_batch_lending_rpc.sql`) ANTES desta
-- migration — CAUTELA_ITEM_WRONG_RESERVE e o cross-check de reserve_id de
-- record_cautelamento_batch já existiam em PROD real (confirmado via
-- pg_get_functiondef direto contra prod em 2026-09-16), mas não em nenhum
-- arquivo de migration correspondente no repo. Mesmo padrão já documentado
-- no épico: migrations aplicadas via SQL Editor não deixam rastro no
-- histórico de arquivos. Os corpos usados como base desta migration A vieram
-- de leitura direta de PROD (via MCP), não dos arquivos de migration antigos
-- — são a fonte da verdade correta; um review que compare só contra arquivos
-- do repo pode reportar como "novo" algo que já era real.
--
-- Achado novo desta spec (não catalogado antes): record_lending_batch nunca
-- comparava material_types.reserve_id contra p_reserve_id — gap de cross-reserve
-- write real, corrigido aqui (não é sobre assert_actor_in_reserve, é um segundo
-- fix independente na mesma migration por tocar o mesmo corpo).
--
-- ROLLBACK: ver bloco no fim (comentado).

-- ── 1. record_cautelamento_batch ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_cautelamento_batch(p_tenant_id uuid, p_armeiro_id uuid, p_militar_id uuid, p_reserve_id uuid, p_movement_id uuid, p_motivo_emissao text, p_items jsonb, p_prazo_devolucao_tipo text DEFAULT NULL::text)
 RETURNS TABLE(cautelamento_id uuid, item_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item jsonb;
  v_item_id uuid;
  v_document_hash text;
  v_status_operacional text;
  v_cautela_habilitada boolean;
  v_cautela_elegivel boolean;
  v_validade_item date;
  v_item_reserve_id uuid;
  v_hoje_local date;
  v_prazo_devolucao_data date;
begin
  if p_tenant_id is null or p_armeiro_id is null or p_militar_id is null
     or p_reserve_id is null or p_movement_id is null
     or p_motivo_emissao is null or length(trim(p_motivo_emissao)) < 3
     or p_items is null or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 50 then
    raise exception 'CAUTELA_BATCH_INPUT_INVALID' using errcode = 'P0001';
  end if;

  -- SP8 (docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md §4.1):
  -- prova que p_armeiro_id está autorizado a escrever em p_reserve_id. Roda ANTES do
  -- lock (não depende de nenhuma linha travada abaixo), mesma disciplina das outras
  -- funções desta migration.
  perform assert_actor_in_reserve(p_armeiro_id, p_reserve_id);

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

  v_prazo_devolucao_data := case p_prazo_devolucao_tipo
    when '15_dias' then (v_hoje_local + interval '15 days')::date
    when '30_dias' then (v_hoje_local + interval '30 days')::date
    when '90_dias' then (v_hoje_local + interval '90 days')::date
    when '6_meses' then (v_hoje_local + interval '6 months')::date
    when '1_ano'   then (v_hoje_local + interval '12 months')::date
    else null
  end;

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

    select mi.status_operacional, mi.validade_item, mt.cautela_habilitada, mi.cautela_elegivel, mt.reserve_id
      into v_status_operacional, v_validade_item, v_cautela_habilitada, v_cautela_elegivel, v_item_reserve_id
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
    if not coalesce(v_cautela_habilitada, false) or not coalesce(v_cautela_elegivel, false) then
      raise exception 'CAUTELA_ITEM_NOT_ELIGIBLE' using errcode = 'P0001';
    end if;
    if v_validade_item is not null and v_validade_item < v_hoje_local then
      raise exception 'CAUTELA_ITEM_EXPIRED' using errcode = 'P0001';
    end if;
    if v_item_reserve_id is not null and v_item_reserve_id <> p_reserve_id then
      raise exception 'CAUTELA_ITEM_WRONG_RESERVE' using errcode = 'P0001';
    end if;
  end loop;

  return query
  with inserted as (
    insert into cautelamentos as c (
      tenant_id, reserve_id, item_id, militar_id, armeiro_id,
      condicao_emissao, motivo_emissao, prazo_proxima_conferencia,
      prazo_devolucao_tipo, prazo_devolucao_data,
      document_hash, movement_id
    )
    select
      p_tenant_id, p_reserve_id, (item->>'item_id')::uuid, p_militar_id, p_armeiro_id,
      coalesce(item->>'condicao_emissao', 'bom'),
      p_motivo_emissao,
      nullif(item->>'prazo_proxima_conferencia', '')::date,
      p_prazo_devolucao_tipo, v_prazo_devolucao_data,
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
$function$;

REVOKE ALL ON FUNCTION public.record_cautelamento_batch(uuid, uuid, uuid, uuid, uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;

-- ── 2. record_lending_batch (assinatura 1 — sem p_totp_claim_id) ────
CREATE OR REPLACE FUNCTION public.record_lending_batch(p_tenant_id uuid, p_master_id uuid, p_military_id uuid, p_reserve_id uuid, p_movement_id uuid, p_notes text, p_auth_mode text, p_biometric_proof_id uuid, p_items jsonb)
 RETURNS TABLE(lending_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item jsonb;
  v_material_id uuid;
  v_quantity integer;
  v_total integer;
  v_active integer;
  v_material_reserve_id uuid;
  v_proof biometric_proofs%rowtype;
begin
  if p_tenant_id is null or p_master_id is null or p_military_id is null
     or p_reserve_id is null or p_movement_id is null
     or p_auth_mode not in ('biometria', 'totp')
     or p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'LENDING_BATCH_INPUT_INVALID' using errcode = 'P0001';
  end if;

  -- SP8 (docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md §4.2):
  -- prova que p_master_id está autorizado a escrever em p_reserve_id.
  perform assert_actor_in_reserve(p_master_id, p_reserve_id);

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

    select quantidade_total, reserve_id into v_total, v_material_reserve_id
      from material_types
     where id = v_material_id and tenant_id = p_tenant_id
     for update;
    if v_total is null then
      raise exception 'LENDING_MATERIAL_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- SP8, achado novo: material_type de outra reserva nunca era rejeitado aqui.
    -- reserve_id IS NULL = catálogo compartilhado do tenant (padrão SP5) — só
    -- bloqueia quando a linha tem reserva própria E diverge de p_reserve_id.
    if v_material_reserve_id is not null and v_material_reserve_id <> p_reserve_id then
      raise exception 'LENDING_MATERIAL_WRONG_RESERVE' using errcode = 'P0001';
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
$function$;

REVOKE ALL ON FUNCTION public.record_lending_batch(uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 2b. record_lending_batch (assinatura 2 — com p_totp_claim_id) ───
CREATE OR REPLACE FUNCTION public.record_lending_batch(p_tenant_id uuid, p_master_id uuid, p_military_id uuid, p_reserve_id uuid, p_movement_id uuid, p_notes text, p_auth_mode text, p_biometric_proof_id uuid, p_items jsonb, p_totp_claim_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(lending_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_item jsonb;
  v_material_id uuid;
  v_quantity integer;
  v_total integer;
  v_cautela integer;
  v_active integer;
  v_material_reserve_id uuid;
  v_proof biometric_proofs%rowtype;
  v_claim totp_identity_claims%rowtype;
begin
  if p_tenant_id is null or p_master_id is null or p_military_id is null
     or p_reserve_id is null or p_movement_id is null
     or p_auth_mode not in ('biometria', 'totp')
     or p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'LENDING_BATCH_INPUT_INVALID' using errcode = 'P0001';
  end if;

  -- SP8 (docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md §4.2):
  -- prova que p_master_id está autorizado a escrever em p_reserve_id.
  perform assert_actor_in_reserve(p_master_id, p_reserve_id);

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

    select quantidade_total, quantidade_cautela, reserve_id into v_total, v_cautela, v_material_reserve_id
      from material_types
     where id = v_material_id and tenant_id = p_tenant_id
     for update;
    if v_total is null then
      raise exception 'LENDING_MATERIAL_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- SP8, achado novo: material_type de outra reserva nunca era rejeitado aqui.
    if v_material_reserve_id is not null and v_material_reserve_id <> p_reserve_id then
      raise exception 'LENDING_MATERIAL_WRONG_RESERVE' using errcode = 'P0001';
    end if;

    select coalesce(sum(quantidade), 0) into v_active
      from lendings
     where material_type_id = v_material_id
       and tenant_id = p_tenant_id
       and status_legacy = 'ativo';
    -- Achado real (CAU, ver comentário no topo desta migration): unidades
    -- reservadas para cautela (quantidade_cautela) nunca podem ser
    -- contabilizadas como disponíveis para saída diária também.
    if v_active + v_quantity > (v_total - coalesce(v_cautela, 0)) then
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
$function$;

REVOKE ALL ON FUNCTION public.record_lending_batch(uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. record_lending_returns (assinatura 1 — sem p_totp_claim_id) ──
CREATE OR REPLACE FUNCTION public.record_lending_returns(p_tenant_id uuid, p_actor_id uuid, p_military_id uuid, p_reserve_id uuid, p_lending_ids uuid[], p_notes text DEFAULT NULL::text, p_biometric_proof_id uuid DEFAULT NULL::uuid, p_operation_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(returned_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- SP8 (docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md §4.3):
  -- prova que p_actor_id está autorizado a escrever em p_reserve_id.
  perform assert_actor_in_reserve(p_actor_id, p_reserve_id);

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
$function$;

REVOKE ALL ON FUNCTION public.record_lending_returns(uuid, uuid, uuid, uuid, uuid[], text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3b. record_lending_returns (assinatura 2 — com p_totp_claim_id) ─
CREATE OR REPLACE FUNCTION public.record_lending_returns(p_tenant_id uuid, p_actor_id uuid, p_military_id uuid, p_reserve_id uuid, p_lending_ids uuid[], p_notes text DEFAULT NULL::text, p_biometric_proof_id uuid DEFAULT NULL::uuid, p_operation_id uuid DEFAULT NULL::uuid, p_totp_claim_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(returned_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- SP8 (docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md §4.3):
  -- prova que p_actor_id está autorizado a escrever em p_reserve_id.
  perform assert_actor_in_reserve(p_actor_id, p_reserve_id);

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
$function$;

REVOKE ALL ON FUNCTION public.record_lending_returns(uuid, uuid, uuid, uuid, uuid[], text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- ── 4. record_biometric_enrollment ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_biometric_enrollment(p_challenge_id uuid, p_tenant_id uuid, p_reserve_id uuid, p_device_id uuid, p_actor_id uuid, p_user_id uuid, p_template_data bytea, p_template_hash text, p_format text, p_finger_index integer, p_quality smallint, p_liveness_passed boolean, p_bridge_signature text, p_signature_algorithm text, p_sdk_version text, p_bridge_version text, p_require_liveness boolean)
 RETURNS TABLE(proof_id uuid, finger_index integer, quality integer, created_at timestamp with time zone, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_challenge biometric_challenges%rowtype;
  v_proof biometric_proofs%rowtype;
begin
  -- SP8 (docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md §4.4):
  -- prova que p_actor_id está autorizado a escrever em p_reserve_id.
  perform assert_actor_in_reserve(p_actor_id, p_reserve_id);

  if p_template_data is null or octet_length(p_template_data) = 0 then
    raise exception 'BIOMETRIC_TEMPLATE_EMPTY' using errcode = 'P0001';
  end if;

  if p_template_hash is null
     or p_template_hash <> 'sha256:' || encode(sha256(p_template_data), 'hex') then
    raise exception 'BIOMETRIC_TEMPLATE_HASH_MISMATCH' using errcode = 'P0001';
  end if;

  if p_quality < 0 or p_quality > 100 or p_finger_index < 1 or p_finger_index > 10 then
    raise exception 'BIOMETRIC_ENROLLMENT_METADATA_INVALID' using errcode = 'P0001';
  end if;

  if p_liveness_passed is false
     or (p_require_liveness and p_liveness_passed is distinct from true) then
    raise exception 'BIOMETRIC_LIVENESS_REQUIRED' using errcode = 'P0001';
  end if;

  -- SP8 §3 D5: equivalente a assert_device_in_reserve(p_device_id, p_reserve_id) +
  -- tenant_id, que o helper genérico não valida — não remover nem "simplificar"
  -- pra chamar o helper sem primeiro conferir que o check de tenant_id continua
  -- coberto.
  if not exists (
    select 1 from biometric_devices d
     where d.id = p_device_id
       and d.tenant_id = p_tenant_id
       and d.reserve_id = p_reserve_id
       and d.status = 'active'
  ) then
    raise exception 'BIOMETRIC_DEVICE_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from profiles p
     where p.id = p_user_id
       and p.default_tenant_id = p_tenant_id
  ) then
    raise exception 'BIOMETRIC_TARGET_USER_SCOPE_INVALID' using errcode = 'P0001';
  end if;

  update biometric_challenges
     set status = 'consumed', consumed_at = now(), device_id = p_device_id
   where id = p_challenge_id
     and tenant_id = p_tenant_id
     and reserve_id = p_reserve_id
     and actor_id = p_actor_id
     and purpose = 'enroll'
     and expected_user_id = p_user_id
     and status = 'pending'
     and expires_at > now()
  returning * into v_challenge;

  if v_challenge.id is null then
    raise exception 'BIOMETRIC_CHALLENGE_NOT_PENDING' using errcode = 'P0001';
  end if;

  insert into biometric_proofs (
    challenge_id, tenant_id, reserve_id, device_id, actor_id,
    matched_user_id, purpose, document_type, document_id, document_hash,
    template_hash, match_score, finger_index, liveness_passed,
    bridge_signature, signature_algorithm, sdk_version, bridge_version,
    result, failure_reason
  ) values (
    v_challenge.id, p_tenant_id, p_reserve_id, p_device_id, p_actor_id,
    p_user_id, 'enroll', v_challenge.document_type, v_challenge.document_id,
    v_challenge.document_hash, p_template_hash, 1, p_finger_index,
    p_liveness_passed, p_bridge_signature, p_signature_algorithm,
    p_sdk_version, p_bridge_version, 'success', null
  )
  returning * into v_proof;

  insert into biometric_templates (
    user_id, tenant_id, template_data, finger_index, registered_by,
    template_hash, format, sdk_version, quality, encryption_key_version,
    enrolled_device_id, revoked_at, revoked_by, revoked_reason
  ) values (
    p_user_id, p_tenant_id, p_template_data, p_finger_index, p_actor_id,
    p_template_hash, p_format, p_sdk_version, p_quality, 1,
    p_device_id, null, null, null
  )
  on conflict on constraint biometric_templates_user_id_finger_index_key do update set
    tenant_id = excluded.tenant_id,
    template_data = excluded.template_data,
    registered_by = excluded.registered_by,
    template_hash = excluded.template_hash,
    format = excluded.format,
    sdk_version = excluded.sdk_version,
    quality = excluded.quality,
    encryption_key_version = excluded.encryption_key_version,
    enrolled_device_id = excluded.enrolled_device_id,
    revoked_at = null,
    revoked_by = null,
    revoked_reason = null;

  update profiles
     set registration_status = 'complete'
   where id = p_user_id
     and default_tenant_id = p_tenant_id
     and registration_status = 'pending_biometric';

  return query select v_proof.id, p_finger_index, p_quality::integer, v_proof.created_at, null::timestamptz;
end;
$function$;

REVOKE ALL ON FUNCTION public.record_biometric_enrollment(uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, text, integer, smallint, boolean, text, text, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- ── 5. record_biometric_proof ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_biometric_proof(p_challenge_id uuid, p_tenant_id uuid, p_reserve_id uuid, p_device_id uuid, p_actor_id uuid, p_matched_user_id uuid, p_purpose text, p_document_type text, p_document_id uuid, p_document_hash text, p_match_score numeric, p_finger_index integer, p_liveness_passed boolean, p_bridge_signature text, p_signature_algorithm text, p_sdk_version text, p_bridge_version text, p_result text, p_failure_reason text)
 RETURNS TABLE(id uuid, challenge_id uuid, result text, matched_user_id uuid, match_score numeric, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_challenge_id uuid;
begin
  -- SP8 (docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md §4.5):
  -- diferente de record_biometric_enrollment, esta função nunca validava p_device_id
  -- antes de persistir — assert_device_in_reserve fecha esse gap (device revogado/de
  -- outra reserva não era rejeitado antes).
  perform assert_actor_in_reserve(p_actor_id, p_reserve_id);
  perform assert_device_in_reserve(p_device_id, p_reserve_id);

  update public.biometric_challenges
    set status = 'consumed',
        consumed_at = now(),
        device_id = p_device_id
  where biometric_challenges.id = p_challenge_id
    and biometric_challenges.tenant_id = p_tenant_id
    and biometric_challenges.reserve_id = p_reserve_id
    and biometric_challenges.actor_id = p_actor_id
    and biometric_challenges.status = 'pending'
    and biometric_challenges.expires_at > now()
  returning biometric_challenges.id into v_challenge_id;

  if v_challenge_id is null then
    raise exception 'BIOMETRIC_CHALLENGE_NOT_PENDING' using errcode = 'P0001';
  end if;

  return query
  insert into public.biometric_proofs (
    challenge_id,
    tenant_id,
    reserve_id,
    device_id,
    actor_id,
    matched_user_id,
    purpose,
    document_type,
    document_id,
    document_hash,
    match_score,
    finger_index,
    liveness_passed,
    bridge_signature,
    signature_algorithm,
    sdk_version,
    bridge_version,
    result,
    failure_reason
  )
  values (
    p_challenge_id,
    p_tenant_id,
    p_reserve_id,
    p_device_id,
    p_actor_id,
    p_matched_user_id,
    p_purpose,
    p_document_type,
    p_document_id,
    p_document_hash,
    p_match_score,
    p_finger_index,
    p_liveness_passed,
    p_bridge_signature,
    p_signature_algorithm,
    p_sdk_version,
    p_bridge_version,
    p_result,
    p_failure_reason
  )
  returning
    biometric_proofs.id,
    biometric_proofs.challenge_id,
    biometric_proofs.result,
    biometric_proofs.matched_user_id,
    biometric_proofs.match_score,
    biometric_proofs.created_at;
end;
$function$;

REVOKE ALL ON FUNCTION public.record_biometric_proof(uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, numeric, integer, boolean, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;

-- ── 6. check_material_validade_vencimento ────────────────────────────
CREATE OR REPLACE FUNCTION public.check_material_validade_vencimento(p_reserve_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_hoje date;
  v_item record;
  v_recipient uuid;
BEGIN
  v_hoje := (now() AT TIME ZONE 'America/Sao_Paulo')::date;

  -- SP8 (docs/superpowers/specs/2026-09-15-isolamento-reserva-sp8-wiring-design.md §4.6,
  -- D3): não é o padrão "ator escreve numa reserva" das outras funções desta migration
  -- — é job de sistema (pg_cron), sem parâmetro de ator, e p_reserve_id pode ser NULL
  -- de propósito (varredura de TODAS as reservas do tenant, uso real do cron hoje).
  -- Guard condicional: só faz sentido checar quando um p_reserve_id específico é
  -- passado; nesse caso, session_user='postgres' (branch já existente no helper desde
  -- o SP8 pt.1) garante que só uma chamada real via pg_cron/psql-como-postgres passa —
  -- defesa em profundidade, não fix de vulnerabilidade conhecida (grant já restringe
  -- a postgres/service_role).
  IF p_reserve_id IS NOT NULL THEN
    PERFORM assert_actor_in_reserve(NULL, p_reserve_id);
  END IF;

  FOR v_item IN
    SELECT mi.id, mi.tenant_id, mi.current_holder_user_id, mi.validade_item,
           mt.nome AS material_nome, mt.reserve_id,
           (mi.validade_item - v_hoje) AS dias_restantes
      FROM material_items mi
      JOIN material_types mt ON mt.id = mi.material_type_id
      JOIN reserves r ON r.id = mt.reserve_id
     WHERE mi.validade_item IS NOT NULL
       AND (p_reserve_id IS NULL OR mt.reserve_id = p_reserve_id)
       AND (mi.validade_item - v_hoje) = ANY(
             COALESCE(NULLIF(mt.validity_alert_days, '{}'), r.material_validity_alert_dias_padrao)
           )
  LOOP
    INSERT INTO material_validity_alert_events (tenant_id, reserve_id, material_item_id, alert_days, validade_item)
    VALUES (v_item.tenant_id, v_item.reserve_id, v_item.id, v_item.dias_restantes, v_item.validade_item)
    ON CONFLICT (material_item_id, alert_days, validade_item) DO NOTHING;

    IF FOUND THEN
      FOR v_recipient IN
        SELECT rm.user_id FROM reserve_memberships rm
         WHERE rm.reserve_id = v_item.reserve_id AND rm.role IN ('admin_reserva', 'armeiro')
        UNION
        SELECT v_item.current_holder_user_id WHERE v_item.current_holder_user_id IS NOT NULL
      LOOP
        INSERT INTO notifications (user_id, tenant_id, type, title, body, metadata)
        VALUES (
          v_recipient, v_item.tenant_id, 'material_validity_warning',
          'Validade de material próxima',
          format('%s vence em %s dia(s) (%s)', v_item.material_nome, v_item.dias_restantes, to_char(v_item.validade_item, 'DD/MM/YYYY')),
          jsonb_build_object('material_item_id', v_item.id)
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_material_validade_vencimento(uuid) FROM PUBLIC, anon, authenticated;

-- ROLLBACK (referência, não executado): git checkout <commit anterior> -- \
--   supabase/migrations/20260916000000_reserve_rpc_guard_wiring_migration_a.sql
-- restaura os 6 CREATE OR REPLACE FUNCTION pros corpos anteriores a esta migration
-- (idênticos aos lidos de PROD em 2026-09-15, documentados na spec §2).
