-- Achado real e GRAVE (relatado pelo usuário: "que confusão é essa" no
-- Almoxarifado — um item ("Cinto Branco") exibindo quantidade_disponivel =
-- -5906 e "5963 em uso" para um quantidade_total de 49).
--
-- Causa raiz confirmada ao vivo: a view material_availability (definida em
-- 20260629000007/20260818110000) faz LEFT JOIN de material_types com DUAS
-- relações 1:N INDEPENDENTES na MESMA query plana — lendings (N saídas por
-- material) e material_request_items+material_requests (N solicitações
-- pendentes/aprovadas por material) — sem agregar cada uma separadamente
-- primeiro. Isso produz um PRODUTO CARTESIANO antes do GROUP BY: cada linha
-- de lendings é multiplicada por CADA linha de material_request_items do
-- mesmo material_type_id, e só então SUM(l.quantidade) é aplicado sobre o
-- resultado já multiplicado.
--
-- Confirmado numericamente para "Cinto Branco" (id 825bf248-2e76-420e-b3ea-
-- fc019a91042e): 21 lendings reais com status_legacy='ativo' (soma real =
-- 21) × 300 linhas em material_request_items para o mesmo material = 6300,
-- exatamente o valor corrompido que a view retornava como
-- quantidade_armada. O erro escala com o volume de material_request_items
-- acumulado por material — por isso alguns materiais mostravam números
-- "só um pouco errados" e outros (com muito volume de solicitações de
-- teste acumuladas ao longo de meses) mostravam números absurdos como este.
--
-- Fix: agregar lendings e material_request_items+material_requests em CTEs
-- SEPARADAS (1 linha por material_type_id cada) ANTES de juntar com
-- material_types — elimina o produto cartesiano por construção, sem GROUP
-- BY nenhum na query final (join 1:1:1 puro). Mesmas 20 colunas de saída,
-- mesma fórmula de quantidade_disponivel (total - armada - cautela),
-- mesmos filtros de status (lendings ativo; requests pendente/aprovado).

DROP VIEW IF EXISTS public.material_availability;
CREATE VIEW public.material_availability
WITH (security_invoker = true)
AS
WITH lending_totals AS (
  SELECT material_type_id, SUM(quantidade)::integer AS qtd_ativa
  FROM lendings
  WHERE status_legacy = 'ativo'
  GROUP BY material_type_id
),
request_totals AS (
  SELECT ri.material_type_id, SUM(ri.requested_quantity)::integer AS qtd_reservada
  FROM material_request_items ri
  JOIN material_requests r ON r.id = ri.request_id
  WHERE r.status = ANY (ARRAY[
    'pendente'::material_request_status_enum,
    'aprovado'::material_request_status_enum
  ])
  GROUP BY ri.material_type_id
)
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
  mt.tenant_id,
  mt.reserve_id,
  COALESCE(lt.qtd_ativa, 0)::integer AS quantidade_armada,
  COALESCE(rt.qtd_reservada, 0)::integer AS quantidade_reservada,
  (mt.quantidade_total - COALESCE(lt.qtd_ativa, 0)::integer - mt.quantidade_cautela)::integer AS quantidade_disponivel,
  mt.cautela_habilitada,
  mt.quantidade_cautela,
  mt.ativo
FROM material_types mt
LEFT JOIN lending_totals lt ON lt.material_type_id = mt.id
LEFT JOIN request_totals rt ON rt.material_type_id = mt.id
WHERE mt.ativo = true;
