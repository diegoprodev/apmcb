-- Achado real (mesma classe de bug já corrigida em 20260819020000/
-- 20260822000000 para material_request_items, agora encontrado em
-- material_availability): GET de /admin/arsenal e /reserva/arsenal como
-- admin_reserva (adminreserva@apmcb.dev) retorna a view material_availability
-- vazia — não "sem materiais", um erro Postgres 57014 "canceling statement
-- due to statement timeout", silenciosamente descartado pelo destructuring
-- `{ data: materials }` sem checar `error` (mesma classe de bug já
-- documentada nos comentários de e2e/global-teardown.ts). Confirmado ao vivo:
-- 652 material_types reais existem para o tenant do usuário (via service
-- role, bypassando RLS) — não é ausência de dado, é a query nunca terminar
-- sob RLS.
--
-- material_availability (security_invoker) faz JOIN de material_types +
-- lendings + material_request_items + material_requests com GROUP BY. As
-- policies SELECT de material_types (materials_select) e lendings
-- (lendings_select) — diferente de profiles_select/my_tenant_id(), que já
-- usam a função STABLE SECURITY DEFINER auth_role()/my_tenant_id() desde
-- 20260629000006 — ainda usam
-- `EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND ...)`
-- inline: Postgres reavalia auth.uid() (chamada de função, não uma
-- constante) e a subquery correlacionada por LINHA de material_types/
-- lendings, não uma vez por statement. Com 626+ materiais e o volume de
-- lendings acumulado por meses de teste neste projeto compartilhado, essa
-- reavaliação por linha, multiplicada pelo GROUP BY sobre os 2 LEFT JOINs,
-- estoura o timeout — mesma causa raiz documentada em 20260819020000
-- ("RLS combina todas as policies PERMISSIVE via OR — Postgres ainda
-- precisa avaliar a subquery correlacionada linha a linha").
--
-- Fix: mesma técnica já validada (my_tenant_id()/auth_role(), STABLE +
-- SECURITY DEFINER — avaliadas uma vez por statement, não por linha) em vez
-- da EXISTS correlacionada. Equivalência de null-safety confirmada: se
-- auth.uid() não casar nenhuma linha de profiles, tanto o EXISTS quanto
-- my_tenant_id()/auth_role() retornam "sem match" (false / NULL) —
-- comportamento de negação preservado.
--
-- ssa_military_select (material_requests) recebe o mesmo tratamento por
-- estar no mesmo JOIN da view, mesmo sem confirmação de que sozinha já
-- estourava o timeout — mesma classe de bug, mesma tabela envolvida na
-- causa raiz, corrigir as duas evita reabrir este mesmo incidente daqui a
-- pouco quando o volume de material_requests também crescer.

DROP POLICY IF EXISTS materials_select ON material_types;
CREATE POLICY materials_select ON material_types FOR SELECT USING (
  tenant_id = my_tenant_id()
);

DROP POLICY IF EXISTS lendings_select ON lendings;
CREATE POLICY lendings_select ON lendings FOR SELECT USING (
  military_id = auth.uid()
  OR (
    auth_role() = ANY (ARRAY['admin_global'::role_enum, 'admin_reserva'::role_enum, 'armeiro'::role_enum, 'auditor'::role_enum])
    AND tenant_id = my_tenant_id()
  )
);

DROP POLICY IF EXISTS ssa_military_select ON material_requests;
CREATE POLICY ssa_military_select ON material_requests FOR SELECT USING (
  military_id = auth.uid()
  OR (
    auth_role() = ANY (ARRAY['admin_global'::role_enum, 'armeiro'::role_enum, 'admin_reserva'::role_enum, 'auditor'::role_enum])
    AND tenant_id = my_tenant_id()
  )
);
