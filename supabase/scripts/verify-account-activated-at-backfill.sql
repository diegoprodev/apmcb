-- ═══════════════════════════════════════════════════════════════════
-- Teste manual da migration 20260908010000_account_activated_at_backfill_and_selfheal.sql
--
-- Como usar (Supabase SQL Editor OU branch de teste):
--   1. Rodar a SEÇÃO A (antes) e anotar os números.
--   2. Aplicar a migration 20260908010000.
--   3. Rodar a SEÇÃO B (depois) — os invariantes devem passar (0 linhas
--      "VIOLACAO").
--   4. (Opcional) SEÇÃO C: cenário sintético isolado numa transação com
--      ROLLBACK, sem tocar dados reais.
-- ═══════════════════════════════════════════════════════════════════

-- ─── SEÇÃO A — retrato ANTES ───────────────────────────────────────────
select
  count(*) filter (where p.account_activated_at is null)                        as profiles_sem_timestamp,
  count(*) filter (where p.account_activated_at is null and u.last_sign_in_at is not null)
                                                                                as sem_timestamp_mas_ja_logou,
  count(*) filter (where p.account_activated_at is null and u.last_sign_in_at is null)
                                                                                as sem_timestamp_e_nunca_logou
from public.profiles p
join auth.users u on u.id = p.id;

-- ─── SEÇÃO B — invariantes DEPOIS (0 linhas = OK) ─────────────────────
-- B1: ninguém que já logou pode continuar sem account_activated_at
select 'VIOLACAO B1: logou mas sem timestamp' as check, p.id
from public.profiles p
join auth.users u on u.id = p.id
where p.account_activated_at is null
  and u.last_sign_in_at is not null;

-- B2: quem nunca logou continua sem timestamp (backfill não inventou dado)
select 'VIOLACAO B2: timestamp sem login' as check, p.id
from public.profiles p
join auth.users u on u.id = p.id
where p.account_activated_at is not null
  and u.last_sign_in_at is null
  -- exceção legítima: contas ativadas e depois com last_sign_in_at limpo
  -- não deveriam existir no GoTrue; se aparecer, investigar manualmente.
;

-- B3: para os backfilled, o valor bate com last_sign_in_at
select 'INFO B3: backfilled = last_sign_in_at' as check, count(*)
from public.profiles p
join auth.users u on u.id = p.id
where p.account_activated_at = u.last_sign_in_at;

-- ─── SEÇÃO C — cenário sintético (rodar e dar ROLLBACK) ───────────────
-- Não deixa resíduo. Requer permissão de escrita em auth.users (service role).
--
-- begin;
--   -- cria um profile + user "pré-trigger": logou, mas account_activated_at NULL
--   -- (ajuste os UUIDs/tenant conforme o ambiente)
--   insert into auth.users (id, email, last_sign_in_at)
--     values ('00000000-0000-0000-0000-0000000c0de3', 'backfill-test@apmcb.dev', now() - interval '200 days');
--   insert into public.profiles (id, nome_completo, matricula, role, registration_status, account_activated_at)
--     values ('00000000-0000-0000-0000-0000000c0de3', 'Backfill Test', 'ZZ999', 'usuario', 'complete', null);
--
--   -- aplica o mesmo UPDATE da migration
--   update public.profiles p set account_activated_at = u.last_sign_in_at
--   from auth.users u
--   where p.id = u.id and p.account_activated_at is null and u.last_sign_in_at is not null;
--
--   -- esperado: 1 linha, account_activated_at = now() - 200 days
--   select id, account_activated_at from public.profiles
--   where id = '00000000-0000-0000-0000-0000000c0de3';
-- rollback;

-- ─── SEÇÃO D — trigger endurecido (rodar e dar ROLLBACK) ──────────────
-- Verifica que um login NOVO (não a 1ª transição NULL->não-NULL) agora
-- também grava account_activated_at.
--
-- begin;
--   insert into auth.users (id, email, last_sign_in_at)
--     values ('00000000-0000-0000-0000-0000000c0de4', 'trigger-test@apmcb.dev', now() - interval '10 days');
--   insert into public.profiles (id, nome_completo, matricula, role, registration_status, account_activated_at)
--     values ('00000000-0000-0000-0000-0000000c0de4', 'Trigger Test', 'ZZ998', 'usuario', 'complete', null);
--
--   -- "novo login": last_sign_in_at muda de não-NULL para outro não-NULL
--   update auth.users set last_sign_in_at = now()
--   where id = '00000000-0000-0000-0000-0000000c0de4';
--
--   -- esperado: account_activated_at = agora (trigger antigo NÃO teria feito nada)
--   select id, account_activated_at from public.profiles
--   where id = '00000000-0000-0000-0000-0000000c0de4';
-- rollback;
