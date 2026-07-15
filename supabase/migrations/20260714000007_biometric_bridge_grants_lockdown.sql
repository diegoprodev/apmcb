-- Biometric Bridge: corrige EXECUTE indevido a anon/authenticated.
--
-- Achado real durante o deploy de 2026-07-15: as migrations anteriores
-- (20260714000002, 20260714000004, 20260714000005, 20260714000006) usaram
-- "revoke all on function ... from public" para trancar as RPCs
-- SECURITY DEFINER que controlam custódia de armamento. Esse padrão NÃO
-- funciona neste projeto: o Supabase concede EXECUTE diretamente aos papéis
-- anon/authenticated/service_role em toda função nova do schema public via
-- ALTER DEFAULT PRIVILEGES (confirmado em pg_default_acl) — não é uma
-- concessão herdada de PUBLIC, então "revoke ... from public" é um no-op
-- para esses papéis.
--
-- Resultado antes deste fix: record_biometric_proof, record_biometric_enrollment,
-- record_lending_batch e record_lending_returns — todas SECURITY DEFINER,
-- todas controlando saída/devolução/cadastro biométrico real de armamento —
-- eram chamáveis por qualquer cliente com a anon key, direto via PostgREST
-- (`supabase.rpc(...)`), sem passar pela validação de sessão, tenant, reserve
-- ou anti-replay do BFF.

revoke execute on function public.record_biometric_proof(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, uuid, text,
  numeric, integer, boolean, text, text, text, text, text, text
) from anon, authenticated;

revoke execute on function public.record_biometric_enrollment(
  uuid, uuid, uuid, uuid, uuid, uuid, bytea, text, text, integer,
  smallint, boolean, text, text, text, text
) from anon, authenticated;

revoke execute on function public.record_lending_batch(
  uuid, uuid, uuid, uuid, uuid, text, text, uuid, jsonb
) from anon, authenticated;

revoke execute on function public.record_lending_returns(
  uuid, uuid, uuid, uuid, uuid[], text, uuid, uuid
) from anon, authenticated;

-- Funções de trigger (não chamáveis via RPC normal — retornam o pseudo-tipo
-- "trigger" — mas fechadas por higiene/defesa em profundidade, mesma causa raiz).
revoke execute on function public.assert_biometric_bridge_scope()
  from anon, authenticated;

revoke execute on function public.assert_biometric_proof_consumption_scope()
  from anon, authenticated;
