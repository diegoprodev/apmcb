-- Achado real, GRAVE (relatado pelo usuário: página inicial do armeiro
-- travando ~9s no login/navegação, confirmado ao vivo contra produção via
-- trace de rede: GET /reserva demora ~9s pra responder). Investigação
-- isolou a causa: uma das 9 queries paralelas de
-- (dashboard)/reserva/page.tsx — contagem de `lendings` com
-- status_legacy='ativo' — levava consistentemente 6.5-7.5s SOZINHA, mesmo
-- a tabela tendo só 104 linhas no total (confirmado: não é volume de dados).
--
-- Causa raiz: EU MESMO deixei essa correção incompleta na migration de hoje
-- (20260823000000_fix_material_availability_rls_timeout.sql) — corrigi as
-- policies SELECT (materials_select, lendings_select, ssa_military_select)
-- trocando EXISTS correlacionado por my_tenant_id()/auth_role(), mas
-- esqueci que `lendings_staff_write` (FOR ALL, definida em
-- 20260711000003) e `materials_write` (FOR ALL, mesma migration) TAMBÉM
-- se aplicam a comandos SELECT — no Postgres, uma policy `FOR ALL` cobre
-- SELECT/INSERT/UPDATE/DELETE, e quando existe MAIS de uma policy
-- PERMISSIVE aplicável ao mesmo comando (aqui: a _select dedicada E a
-- _write FOR ALL), o Postgres as combina via OR — ou seja, mesmo com
-- lendings_select já rápida, o Postgres ainda precisa avaliar
-- lendings_staff_write (que continuava com o EXISTS correlacionado caro)
-- pra CADA linha, porque ela também "vota" no resultado do SELECT via OR.
-- Confirmado: são as DUAS únicas policies restantes com esse padrão que
-- ainda cobrem SELECT (ssa_staff_insert/ssa_staff_update são FOR
-- INSERT/UPDATE apenas, não afetam leitura).
--
-- Fix: mesma técnica já usada nas outras 3 (my_tenant_id()/auth_role(),
-- STABLE + SECURITY DEFINER, avaliadas uma vez por statement).
-- Equivalência de null-safety e de semântica de autorização preservada —
-- só troca COMO a mesma checagem é feita, não o que ela permite.

DROP POLICY IF EXISTS lendings_staff_write ON lendings;
CREATE POLICY lendings_staff_write ON lendings FOR ALL USING (
  auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum])
  AND tenant_id = my_tenant_id()
);

DROP POLICY IF EXISTS materials_write ON material_types;
CREATE POLICY materials_write ON material_types FOR ALL USING (
  auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum])
  AND tenant_id = my_tenant_id()
);
