-- ═══════════════════════════════════════════════════════════════════
-- Fix: 12 funções sem search_path fixo (search_path hijacking)
-- ═══════════════════════════════════════════════════════════════════
-- Achado do Supabase Security Advisor (lint 0011_function_search_path_mutable),
-- rodado via MCP em 2026-08-28 logo após validar o fix de RLS de
-- material-photos (supabase/migrations/20260828000000_fix_material_photos_cross_tenant_rls.sql).
--
-- Mesma classe de risco que my_tenant_id()/auth_role()/can_read_material_photo()
-- já mitigam corretamente desde 20260629000006_fix_auth_role_recursion.sql
-- (`SET search_path = public, pg_temp`) — sem essa trava, uma função pode
-- resolver um nome de objeto (tabela, outra função) contra um schema
-- diferente do esperado se o search_path da SESSÃO que a chama for
-- manipulado, potencialmente executando lógica de um objeto forjado em vez
-- do real. Risco mais alto em funções SECURITY DEFINER (rodam com os
-- privilégios do dono, não de quem chama) — 5 das 12 abaixo são DEFINER
-- (audit_approval_request, audit_material_request, audit_push_subscription,
-- expire_material_requests, has_totp); as outras 7 são SECURITY INVOKER,
-- corrigidas pela mesma razão (defesa em profundidade e consistência —
-- nenhuma função nova deste projeto deveria ficar sem essa trava).
--
-- Todas as 12 têm zero argumentos (confirmado via pg_get_function_identity_arguments
-- antes de escrever esta migration — sem overload, sem ambiguidade de
-- assinatura pro ALTER FUNCTION).
--
-- ALTER (não CREATE OR REPLACE): preserva o corpo/lógica de cada função
-- exatamente como está — só adiciona a trava de search_path, mesmo padrão
-- já usado em 20260629000006_fix_auth_role_recursion.sql pra auth_role().
-- ═══════════════════════════════════════════════════════════════════

ALTER FUNCTION update_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION audit_material_request() SET search_path = public, pg_temp;
ALTER FUNCTION audit_approval_request() SET search_path = public, pg_temp;
ALTER FUNCTION audit_push_subscription() SET search_path = public, pg_temp;
ALTER FUNCTION has_totp() SET search_path = public, pg_temp;
ALTER FUNCTION expire_material_requests() SET search_path = public, pg_temp;
ALTER FUNCTION fn_check_reserve_org_unit_tenant() SET search_path = public, pg_temp;
ALTER FUNCTION _block_signature_update() SET search_path = public, pg_temp;
ALTER FUNCTION _block_signature_delete() SET search_path = public, pg_temp;
ALTER FUNCTION _update_cautelamentos_timestamp() SET search_path = public, pg_temp;
ALTER FUNCTION aar_set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION set_updated_at_tenant_branding() SET search_path = public, pg_temp;

-- Rollback de emergência, se alguma dessas funções depender implicitamente
-- de um schema fora de public/pg_temp no search_path (não identificado na
-- investigação, mas documentado por precaução):
--
--   ALTER FUNCTION <nome>() RESET search_path;
