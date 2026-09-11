-- ═══════════════════════════════════════════════════════════════════
-- SP1 — fixes do review final.
--   • MENOR: profiles_validate_active_reserve também no INSERT (não só UPDATE OF).
--   • MENOR: REVOKE EXECUTE FROM PUBLIC nas 3 funções antes do GRANT explícito
--     (Postgres concede a PUBLIC por padrão → a GRANT sozinha dava falsa
--     sensação de restrição; o gate de allowlist do SP3 depende disto).
-- NÃO adiciona `OF role` ao trigger: validar no role-change bloquearia
-- promoção/rebaixamento de admin com active_reserve_id stale (ARCH-v4 ALTO-6).
-- A limpeza de active_reserve_id no role-change é feita no BFF (SP2).
-- ═══════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS profiles_validate_active_reserve ON public.profiles;
CREATE TRIGGER profiles_validate_active_reserve
  BEFORE INSERT OR UPDATE OF active_reserve_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_validate_active_reserve();

REVOKE EXECUTE ON FUNCTION public.my_active_reserve_id()          FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_tenant_isolation_enabled()   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.user_in_reserve(uuid, uuid)     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.my_active_reserve_id()          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.my_tenant_isolation_enabled()   TO authenticated;
GRANT  EXECUTE ON FUNCTION public.user_in_reserve(uuid, uuid)     TO authenticated;
