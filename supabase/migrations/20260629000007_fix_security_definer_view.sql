-- Corrigir linter Supabase: security_definer_view em material_availability
-- A view deve usar SECURITY INVOKER (padrão) para respeitar RLS do usuário chamador,
-- não do criador da view. Isso garante que o filtro de tenant_id nas policies
-- de material_types e lendings seja aplicado corretamente.

DROP VIEW IF EXISTS public.material_availability;
CREATE VIEW public.material_availability
WITH (security_invoker = true)
AS
 SELECT mt.id,
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
    mt.tenant_id,
    mt.reserve_id,
    COALESCE(sum(l.quantidade) FILTER (WHERE l.status_legacy = 'ativo'), 0)::integer AS quantidade_armada,
    COALESCE(sum(ri.requested_quantity) FILTER (WHERE r.status = ANY (ARRAY[
      'pendente'::material_request_status_enum,
      'aprovado'::material_request_status_enum
    ])), 0)::integer AS quantidade_reservada,
    (mt.quantidade_total - COALESCE(sum(l.quantidade) FILTER (WHERE l.status_legacy = 'ativo'), 0))::integer AS quantidade_disponivel,
    mt.ativo
   FROM material_types mt
     LEFT JOIN lendings l ON l.material_type_id = mt.id
     LEFT JOIN material_request_items ri ON ri.material_type_id = mt.id
     LEFT JOIN material_requests r ON r.id = ri.request_id
  WHERE mt.ativo = true
  GROUP BY mt.id, mt.nome, mt.category_id, mt.categoria, mt.categoria_slug, mt.descricao,
           mt.calibre, mt.has_serial_numbers, mt.requires_validity, mt.requires_vehicle_fields,
           mt.validity_alert_days, mt.vehicle_plate, mt.vehicle_color, mt.vehicle_year,
           mt.vehicle_model, mt.quantidade_total, mt.photo_url, mt.tenant_id, mt.reserve_id, mt.ativo;
