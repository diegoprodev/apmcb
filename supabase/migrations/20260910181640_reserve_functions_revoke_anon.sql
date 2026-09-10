-- Supabase concede EXECUTE a anon/authenticated por ALTER DEFAULT PRIVILEGES;
-- REVOKE FROM PUBLIC (migração anterior) não pega a grant explícita a anon.
-- anon nunca deve chamar estas funções (retornam NULL/false sem auth.uid(),
-- mas o gate de allowlist do SP3 exige EXECUTE revogado de anon).
REVOKE EXECUTE ON FUNCTION public.my_active_reserve_id()        FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_tenant_isolation_enabled() FROM anon;
REVOKE EXECUTE ON FUNCTION public.user_in_reserve(uuid, uuid)   FROM anon;
