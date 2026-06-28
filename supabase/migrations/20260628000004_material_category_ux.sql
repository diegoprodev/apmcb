-- Material category UX: reusable category profiles and vehicle metadata.

DROP VIEW IF EXISTS public.material_availability;

ALTER TABLE public.material_categories
  ADD COLUMN IF NOT EXISTS reserve_id UUID REFERENCES public.reserves(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS slug TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS requires_caliber BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_validity BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS default_has_serial_numbers BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validity_alert_days INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS requires_vehicle_fields BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.material_categories
SET slug = regexp_replace(
    lower(translate(nome, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
    '[^a-z0-9]+',
    '-',
    'g'
  )
WHERE slug IS NULL OR slug = '';

UPDATE public.material_categories
SET
  requires_caliber = CASE WHEN slug = 'arma' THEN true ELSE requires_caliber END,
  requires_validity = CASE WHEN slug = 'colete' THEN true ELSE requires_validity END,
  default_has_serial_numbers = CASE
    WHEN slug IN ('arma', 'colete', 'radio') THEN true
    ELSE default_has_serial_numbers
  END,
  validity_alert_days = CASE
    WHEN slug = 'colete' AND validity_alert_days = '{}'::INTEGER[] THEN ARRAY[365, 180, 90]
    ELSE validity_alert_days
  END,
  requires_vehicle_fields = CASE WHEN slug = 'veiculo' THEN true ELSE requires_vehicle_fields END;

WITH category_seed AS (
  SELECT DISTINCT
    mt.tenant_id,
    mt.reserve_id,
    mt.categoria AS nome,
    mt.categoria_slug AS slug,
    CASE WHEN mt.categoria_slug = 'arma' THEN true ELSE false END AS requires_caliber,
    CASE WHEN mt.categoria_slug = 'colete' THEN true ELSE false END AS requires_validity,
    CASE WHEN mt.categoria_slug IN ('arma', 'colete', 'radio') THEN true ELSE false END AS default_has_serial_numbers,
    CASE WHEN mt.categoria_slug = 'colete' THEN ARRAY[365, 180, 90] ELSE '{}'::INTEGER[] END AS validity_alert_days,
    CASE WHEN mt.categoria_slug = 'veiculo' THEN true ELSE false END AS requires_vehicle_fields
  FROM public.material_types mt
  WHERE mt.tenant_id IS NOT NULL
    AND mt.categoria IS NOT NULL
    AND mt.categoria_slug IS NOT NULL
)
INSERT INTO public.material_categories (
  tenant_id,
  reserve_id,
  nome,
  slug,
  requires_caliber,
  requires_validity,
  default_has_serial_numbers,
  validity_alert_days,
  requires_vehicle_fields
)
SELECT
  tenant_id,
  reserve_id,
  nome,
  slug,
  requires_caliber,
  requires_validity,
  default_has_serial_numbers,
  validity_alert_days,
  requires_vehicle_fields
FROM category_seed
ON CONFLICT (tenant_id, nome) DO NOTHING;

ALTER TABLE public.material_types
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.material_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requires_vehicle_fields BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vehicle_plate TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_color TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_year INTEGER,
  ADD COLUMN IF NOT EXISTS vehicle_model TEXT;

UPDATE public.material_types
SET calibre = CASE
  WHEN nome ~* '(^|[^0-9])9\s*mm([^0-9]|$)' THEN '9mm'
  WHEN nome ~* '\.40|40\s*s&w' THEN '.40'
  WHEN nome ~* '5\.56|556' THEN '5.56'
  WHEN nome ~* '7\.62|762' THEN '7.62'
  WHEN nome ~* '12\s*(ga|cal|gauge)?' THEN '12'
  ELSE 'Nao informado'
END
WHERE categoria_slug = 'arma'
  AND (calibre IS NULL OR length(trim(calibre)) = 0);

UPDATE public.material_types mt
SET category_id = mc.id
FROM public.material_categories mc
WHERE mt.category_id IS NULL
  AND mc.tenant_id = mt.tenant_id
  AND mc.slug = mt.categoria_slug
  AND (mc.reserve_id = mt.reserve_id OR mc.reserve_id IS NULL);

UPDATE public.material_types
SET requires_vehicle_fields = true
WHERE categoria_slug = 'veiculo';

ALTER TABLE public.material_types
  DROP CONSTRAINT IF EXISTS material_types_vehicle_fields_required;

ALTER TABLE public.material_types
  ADD CONSTRAINT material_types_vehicle_fields_required
  CHECK (
    requires_vehicle_fields = false
    OR (
      vehicle_plate IS NOT NULL
      AND length(trim(vehicle_plate)) > 0
      AND vehicle_model IS NOT NULL
      AND length(trim(vehicle_model)) > 0
    )
  ) NOT VALID;

ALTER TABLE public.material_types
  DROP CONSTRAINT IF EXISTS material_types_vehicle_year_valid;

ALTER TABLE public.material_types
  ADD CONSTRAINT material_types_vehicle_year_valid
  CHECK (
    vehicle_year IS NULL
    OR (vehicle_year BETWEEN 1900 AND 2100)
  );

ALTER TABLE public.material_categories
  DROP CONSTRAINT IF EXISTS material_categories_alert_days_allowed;

ALTER TABLE public.material_categories
  ADD CONSTRAINT material_categories_alert_days_allowed
  CHECK (validity_alert_days <@ ARRAY[365, 180, 90]::INTEGER[]);

CREATE INDEX IF NOT EXISTS idx_material_categories_scope
  ON public.material_categories(tenant_id, reserve_id, active, nome);

CREATE INDEX IF NOT EXISTS idx_material_categories_scope_slug
  ON public.material_categories(tenant_id, reserve_id, slug)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS idx_material_types_category_id
  ON public.material_types(category_id);

CREATE INDEX IF NOT EXISTS idx_material_types_vehicle_plate
  ON public.material_types(tenant_id, vehicle_plate)
  WHERE vehicle_plate IS NOT NULL;

DROP POLICY IF EXISTS material_categories_staff_insert ON public.material_categories;
CREATE POLICY material_categories_staff_insert
  ON public.material_categories FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.reserve_id = material_categories.reserve_id
        AND rm.user_id = auth.uid()
        AND rm.role = 'admin_reserva'
    )
  );

DROP POLICY IF EXISTS material_categories_staff_update ON public.material_categories;
CREATE POLICY material_categories_staff_update
  ON public.material_categories FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.reserve_id = material_categories.reserve_id
        AND rm.user_id = auth.uid()
        AND rm.role = 'admin_reserva'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.reserve_id = material_categories.reserve_id
        AND rm.user_id = auth.uid()
        AND rm.role = 'admin_reserva'
    )
  );

DROP POLICY IF EXISTS material_categories_staff_delete ON public.material_categories;
CREATE POLICY material_categories_staff_delete
  ON public.material_categories FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.reserve_memberships rm
      WHERE rm.reserve_id = material_categories.reserve_id
        AND rm.user_id = auth.uid()
        AND rm.role = 'admin_reserva'
    )
  );

CREATE OR REPLACE VIEW public.material_availability AS
SELECT
  mt.id,
  mt.nome,
  mt.category_id,
  mt.categoria,
  mt.categoria_slug,
  mt.descricao,
  mt.calibre,
  mt.has_serial_numbers,
  mt.requires_validity,
  mt.requires_vehicle_fields,
  mt.validity_alert_days,
  mt.vehicle_plate,
  mt.vehicle_color,
  mt.vehicle_year,
  mt.vehicle_model,
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
GROUP BY
  mt.id,
  mt.nome,
  mt.category_id,
  mt.categoria,
  mt.categoria_slug,
  mt.descricao,
  mt.calibre,
  mt.has_serial_numbers,
  mt.requires_validity,
  mt.requires_vehicle_fields,
  mt.validity_alert_days,
  mt.vehicle_plate,
  mt.vehicle_color,
  mt.vehicle_year,
  mt.vehicle_model,
  mt.quantidade_total,
  mt.photo_url,
  mt.ativo;
