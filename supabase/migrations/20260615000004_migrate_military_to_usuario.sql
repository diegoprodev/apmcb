-- Step 2 of 2: DML + policy updates (uses 'usuario' enum value added in previous migration)
-- Migrate all existing military users to usuario
UPDATE public.profiles SET role = 'usuario' WHERE role = 'military';

-- Update SSA INSERT policy that checks military role
DROP POLICY IF EXISTS ssa_military_insert ON public.material_requests;
CREATE POLICY ssa_military_insert ON public.material_requests
  FOR INSERT WITH CHECK (
    military_id = auth.uid()
    AND auth_role() = 'usuario'::public.role_enum
    AND NOT EXISTS (
      SELECT 1 FROM public.material_requests
      WHERE military_id = auth.uid()
        AND status IN ('pendente', 'aprovado')
    )
  );
