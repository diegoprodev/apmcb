-- Cautela com múltiplos materiais — Fase 3: RPC de assinatura em lote
-- Ver docs/enterprise/specs/cautela-multi-item-batch-enterprise.md (CMB).
--
-- Filosofia igual a record_lending_returns: 1 verificação de identidade
-- (TOTP/biometria, feita no BFF em TypeScript — checkTotpGuard/otplib não
-- tem equivalente em PL/pgSQL) cobre N linhas atualizadas atomicamente
-- aqui dentro. Diferente da RPC de criação (Fase 2), esta NÃO é
-- tudo-ou-nada: cada cautela do lote é resolvida independentemente —
-- pular uma já assinada individualmente antes não derruba as outras N-1
-- (uma cautela do lote pode ter sido assinada via a rota singular antes
-- do armeiro clicar "assinar todas").
--
-- A consumo único do código TOTP em si já foi endurecido separadamente
-- (ver validateTotp em apps/bff/src/routes/cautelamentos.ts — UPDATE
-- condicional atômico) — o BFF só chama esta RPC DEPOIS de validar com
-- sucesso, uma única vez, contra a identidade certa (armeiro ou o militar
-- dono do lote, nunca as duas ao mesmo tempo).

create or replace function public.sign_cautelamento_batch(
  p_tenant_id uuid,
  p_movement_id uuid,
  p_signer_role text,
  p_signer_id uuid,
  p_auth_method text,
  p_ip text default null
)
returns table (
  cautelamento_id uuid,
  signature_id uuid,
  skipped boolean,
  skip_reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cautela record;
  v_sig_id uuid;
begin
  if p_tenant_id is null or p_movement_id is null or p_signer_id is null
     or p_signer_role not in ('armeiro', 'militar')
     or p_auth_method not in ('totp', 'biometric') then
    raise exception 'CAUTELA_SIGN_BATCH_INPUT_INVALID' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from cautelamentos c
     where c.tenant_id = p_tenant_id and c.movement_id = p_movement_id
  ) then
    raise exception 'CAUTELA_MOVEMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  for v_cautela in
    select c.id, c.status, c.document_hash, c.armeiro_signature_id, c.militar_signature_id
      from cautelamentos c
     where c.tenant_id = p_tenant_id and c.movement_id = p_movement_id
     order by c.id
     for update of c
  loop
    if v_cautela.status <> 'ativa' then
      cautelamento_id := v_cautela.id; signature_id := null;
      skipped := true; skip_reason := 'not_active';
      return next;
      continue;
    end if;

    if p_signer_role = 'armeiro' then
      if v_cautela.armeiro_signature_id is not null then
        cautelamento_id := v_cautela.id; signature_id := v_cautela.armeiro_signature_id;
        skipped := true; skip_reason := 'already_signed';
        return next;
        continue;
      end if;

      insert into document_signatures (
        tenant_id, document_id, document_type, signer_id, signer_role,
        signed_at, document_hash, signature_proof, ip,
        totp_verified, biometric_verified
      ) values (
        p_tenant_id, v_cautela.id, 'handover', p_signer_id, 'armeiro',
        now(), v_cautela.document_hash,
        v_cautela.document_hash || ':' || p_signer_id || ':armeiro', p_ip,
        p_auth_method = 'totp', p_auth_method = 'biometric'
      ) returning id into v_sig_id;

      update cautelamentos c set armeiro_signature_id = v_sig_id
       where c.id = v_cautela.id and c.tenant_id = p_tenant_id
         and c.status = 'ativa' and c.armeiro_signature_id is null;

      cautelamento_id := v_cautela.id; signature_id := v_sig_id;
      skipped := false; skip_reason := null;
      return next;

    else -- militar
      if v_cautela.militar_signature_id is not null then
        cautelamento_id := v_cautela.id; signature_id := v_cautela.militar_signature_id;
        skipped := true; skip_reason := 'already_signed';
        return next;
        continue;
      end if;
      if v_cautela.armeiro_signature_id is null then
        cautelamento_id := v_cautela.id; signature_id := null;
        skipped := true; skip_reason := 'armeiro_pending';
        return next;
        continue;
      end if;

      insert into document_signatures (
        tenant_id, document_id, document_type, signer_id, signer_role,
        signed_at, document_hash, signature_proof, ip,
        totp_verified, biometric_verified
      ) values (
        p_tenant_id, v_cautela.id, 'handover', p_signer_id, 'militar',
        now(), v_cautela.document_hash,
        v_cautela.document_hash || ':' || p_signer_id || ':militar', p_ip,
        p_auth_method = 'totp', p_auth_method = 'biometric'
      ) returning id into v_sig_id;

      update cautelamentos c set militar_signature_id = v_sig_id
       where c.id = v_cautela.id and c.tenant_id = p_tenant_id
         and c.status = 'ativa' and c.militar_signature_id is null;

      cautelamento_id := v_cautela.id; signature_id := v_sig_id;
      skipped := false; skip_reason := null;
      return next;
    end if;
  end loop;
end;
$$;

revoke execute on function public.sign_cautelamento_batch(
  uuid, uuid, text, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.sign_cautelamento_batch(
  uuid, uuid, text, uuid, text, text
) to service_role;
