-- Material metadata: free categories, caliber, serial policy, validity alerts.

DROP VIEW IF EXISTS public.material_availability;

ALTER TABLE public.material_types
  ALTER COLUMN categoria TYPE TEXT USING categoria::TEXT;

ALTER TABLE public.material_types
  ADD COLUMN IF NOT EXISTS categoria_slug TEXT,
  ADD COLUMN IF NOT EXISTS calibre TEXT,
  ADD COLUMN IF NOT EXISTS has_serial_numbers BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_validity BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS validity_alert_days INTEGER[] NOT NULL DEFAULT '{}';

UPDATE public.material_types
SET categoria_slug = CASE
  WHEN lower(translate(categoria, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) ~ '(^|\m)(arma|armas|armamento|pistola|fuzil|revolver|espingarda)(\M|$)' THEN 'arma'
  WHEN lower(translate(categoria, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) ~ '(^|\m)(colete|coletes|balistico|balistica)(\M|$)' THEN 'colete'
  WHEN lower(translate(categoria, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) ~ '(^|\m)(radio|radios|ht|comunicador)(\M|$)' THEN 'radio'
  ELSE regexp_replace(lower(translate(categoria, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', '-', 'g')
END
WHERE categoria_slug IS NULL OR categoria_slug = '';

UPDATE public.material_types
SET requires_validity = true,
    validity_alert_days = CASE
      WHEN validity_alert_days = '{}'::INTEGER[] THEN ARRAY[365, 180, 90]
      ELSE validity_alert_days
    END
WHERE categoria_slug = 'colete';

DO $$
BEGIN
  ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'material_validity_warning';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.material_types
  DROP CONSTRAINT IF EXISTS material_types_arma_requires_calibre;

ALTER TABLE public.material_types
  ADD CONSTRAINT material_types_arma_requires_calibre
  CHECK (
    categoria_slug <> 'arma'
    OR (calibre IS NOT NULL AND length(trim(calibre)) > 0)
  ) NOT VALID;

ALTER TABLE public.material_types
  DROP CONSTRAINT IF EXISTS material_types_alert_days_allowed;

ALTER TABLE public.material_types
  ADD CONSTRAINT material_types_alert_days_allowed
  CHECK (
    validity_alert_days <@ ARRAY[365, 180, 90]::INTEGER[]
  );

CREATE INDEX IF NOT EXISTS idx_material_types_tenant_reserve_category
  ON public.material_types(tenant_id, reserve_id, categoria_slug);

CREATE INDEX IF NOT EXISTS idx_material_types_tenant_calibre
  ON public.material_types(tenant_id, calibre)
  WHERE calibre IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.material_validity_alert_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reserve_id UUID REFERENCES public.reserves(id) ON DELETE CASCADE,
  material_item_id UUID NOT NULL REFERENCES public.material_items(id) ON DELETE CASCADE,
  alert_days INTEGER NOT NULL CHECK (alert_days IN (90, 180, 365)),
  validade_item DATE NOT NULL,
  notification_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (material_item_id, alert_days, validade_item)
);

ALTER TABLE public.material_validity_alert_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS material_validity_alert_events_reserve_staff_select
  ON public.material_validity_alert_events;

CREATE POLICY material_validity_alert_events_reserve_staff_select
  ON public.material_validity_alert_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.reserve_memberships rm
      WHERE rm.reserve_id = material_validity_alert_events.reserve_id
        AND rm.user_id = auth.uid()
        AND rm.role IN ('admin_reserva', 'armeiro', 'auditor_reserva')
    )
  );

CREATE INDEX IF NOT EXISTS idx_material_validity_alert_events_scope
  ON public.material_validity_alert_events(tenant_id, reserve_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_material_validity_alert_events_item
  ON public.material_validity_alert_events(material_item_id);

CREATE OR REPLACE VIEW public.material_availability AS
SELECT
  mt.id,
  mt.nome,
  mt.categoria,
  mt.categoria_slug,
  mt.descricao,
  mt.calibre,
  mt.has_serial_numbers,
  mt.requires_validity,
  mt.validity_alert_days,
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
  mt.categoria,
  mt.categoria_slug,
  mt.descricao,
  mt.calibre,
  mt.has_serial_numbers,
  mt.requires_validity,
  mt.validity_alert_days,
  mt.quantidade_total,
  mt.photo_url,
  mt.ativo;
