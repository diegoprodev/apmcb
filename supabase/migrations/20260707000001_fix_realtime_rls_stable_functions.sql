-- Fix: substituir auth_role() e auth_tenant_id() (STABLE functions) por EXISTS inline
-- no SELECT policy de material_requests e lendings.
--
-- Funções STABLE têm resultados cacheados no contexto WAL do Supabase Realtime,
-- retornando NULL e bloqueando a entrega de eventos para assinantes autenticados.
-- EXISTS inline faz a query sem cache para cada row, resolvendo o problema.
-- Semanticamente idêntico ao policy anterior.

-- 1. material_requests SELECT
DROP POLICY IF EXISTS "ssa_military_select" ON public.material_requests;
CREATE POLICY "ssa_military_select" ON public.material_requests
  FOR SELECT USING (
    military_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = ANY (ARRAY['admin_global','armeiro','admin_reserva','superadmin','auditor']::role_enum[])
        AND p.default_tenant_id = material_requests.tenant_id
    )
  );

-- 2. lendings SELECT (também usa auth_role() — fix preventivo para RT-04)
DROP POLICY IF EXISTS "lendings_select" ON public.lendings;
CREATE POLICY "lendings_select" ON public.lendings
  FOR SELECT USING (
    military_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = ANY (ARRAY['admin_global','superadmin']::role_enum[])
          OR (
            p.role = ANY (ARRAY['admin_reserva','armeiro','auditor']::role_enum[])
            AND p.default_tenant_id = lendings.tenant_id
          )
        )
    )
  );
