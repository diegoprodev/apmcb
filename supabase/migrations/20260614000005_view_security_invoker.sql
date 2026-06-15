-- Fix security advisor warning: recreate material_availability with security_invoker = on
-- This ensures the view respects the RLS policies of the QUERYING user,
-- not the view creator's elevated privileges.
CREATE OR REPLACE VIEW public.material_availability
  WITH (security_invoker = on)
AS
SELECT
  mt.id,
  mt.nome,
  mt.categoria,
  mt.quantidade_total,
  COALESCE(sum(l.quantidade) FILTER (WHERE l.status = 'ativo'::lending_status_enum), 0)::integer AS quantidade_armada,
  COALESCE(sum(ri.requested_quantity) FILTER (WHERE r.status = ANY (ARRAY['pendente'::material_request_status_enum, 'aprovado'::material_request_status_enum])), 0)::integer AS quantidade_reservada,
  (mt.quantidade_total - COALESCE(sum(l.quantidade) FILTER (WHERE l.status = 'ativo'::lending_status_enum), 0))::integer AS quantidade_disponivel,
  mt.ativo
FROM material_types mt
LEFT JOIN lendings l ON l.material_type_id = mt.id
LEFT JOIN material_request_items ri ON ri.material_type_id = mt.id
LEFT JOIN material_requests r ON r.id = ri.request_id
WHERE mt.ativo = true
GROUP BY mt.id, mt.nome, mt.categoria, mt.quantidade_total, mt.ativo;
