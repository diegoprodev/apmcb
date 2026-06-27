-- Material photos, category table fallback, and arsenal approval RBAC.

ALTER TABLE public.material_types
  ADD COLUMN IF NOT EXISTS photo_url TEXT,
  ADD COLUMN IF NOT EXISTS photo_storage_path TEXT;

CREATE TABLE IF NOT EXISTS public.material_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);

ALTER TABLE public.material_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_categories_tenant_select ON public.material_categories;
CREATE POLICY material_categories_tenant_select
  ON public.material_categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = material_categories.tenant_id
        AND tm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS material_categories_staff_insert ON public.material_categories;
CREATE POLICY material_categories_staff_insert
  ON public.material_categories FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = material_categories.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('admin_global', 'admin_reserva')
    )
  );

DROP POLICY IF EXISTS material_categories_staff_delete ON public.material_categories;
CREATE POLICY material_categories_staff_delete
  ON public.material_categories FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.tenant_memberships tm
      WHERE tm.tenant_id = material_categories.tenant_id
        AND tm.user_id = auth.uid()
        AND tm.role IN ('admin_global', 'admin_reserva')
    )
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'material-photos',
  'material-photos',
  true,
  5242880,
  ARRAY['image/jpeg','image/jpg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS profile_photos_authenticated_insert ON storage.objects;
CREATE POLICY profile_photos_authenticated_insert
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'profile-photos');

DROP POLICY IF EXISTS profile_photos_authenticated_update ON storage.objects;
CREATE POLICY profile_photos_authenticated_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'profile-photos');

DROP POLICY IF EXISTS material_photos_staff_write ON storage.objects;
CREATE POLICY material_photos_staff_write
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'material-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_global', 'admin_reserva', 'armeiro', 'admin', 'master')
    )
  );

DROP POLICY IF EXISTS material_photos_staff_update ON storage.objects;
CREATE POLICY material_photos_staff_update
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'material-photos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('admin_global', 'admin_reserva', 'armeiro', 'admin', 'master')
    )
  );

DROP POLICY IF EXISTS material_photos_public_read ON storage.objects;
CREATE POLICY material_photos_public_read
  ON storage.objects FOR SELECT
  USING (bucket_id = 'material-photos');

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.admin_approval_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%stock_adjustment%'
    AND pg_get_constraintdef(oid) LIKE '%material_addition%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.admin_approval_requests DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE public.admin_approval_requests
  ADD CONSTRAINT admin_approval_requests_type_check
  CHECK (type IN ('stock_adjustment', 'material_addition', 'material_deactivation'));

DROP VIEW IF EXISTS public.material_availability;

CREATE OR REPLACE VIEW public.material_availability AS
SELECT
  mt.id,
  mt.nome,
  mt.categoria,
  mt.quantidade_total,
  mt.photo_url,
  COALESCE(
    SUM(l.quantidade) FILTER (WHERE l.status_legacy = 'ativo'), 0
  )::INTEGER AS quantidade_armada,
  COALESCE(
    SUM(ri.requested_quantity) FILTER (
      WHERE r.status IN ('pendente', 'aprovado')
    ), 0
  )::INTEGER AS quantidade_reservada,
  (
    mt.quantidade_total
    - COALESCE(SUM(l.quantidade) FILTER (WHERE l.status_legacy = 'ativo'), 0)
  )::INTEGER AS quantidade_disponivel,
  mt.ativo
FROM public.material_types mt
LEFT JOIN public.lendings l ON l.material_type_id = mt.id
LEFT JOIN public.material_request_items ri ON ri.material_type_id = mt.id
LEFT JOIN public.material_requests r ON r.id = ri.request_id
WHERE mt.ativo = TRUE
GROUP BY mt.id, mt.nome, mt.categoria, mt.quantidade_total, mt.photo_url, mt.ativo;
