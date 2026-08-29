-- ═══════════════════════════════════════════════════════════════════
-- AVU-03 — Backfill: cautelas ativas já existentes sem prazo de devolução
-- ganham 90 dias a partir de HOJE (não da emissão original — decisão
-- confirmada com o dono do produto, evita uma leva inteira virando
-- "vencida" no dia seguinte a esta migration). Roda 1 vez, aqui mesmo
-- (não na function do cron — isto é histórico, não um caso recorrente).
--
-- prazo_devolucao_tipo = '90_dias' (não um valor novo tipo
-- 'backfill_90d'): mesmo valor real já usado quando um armeiro escolhe
-- "90 dias" manualmente — sem consumidor identificado que precise
-- distinguir "foi automático" de "foi escolha humana", então não vale a
-- migração extra de CHECK constraint só pra isso.
-- ═══════════════════════════════════════════════════════════════════

UPDATE public.cautelamentos
   SET prazo_devolucao_tipo = '90_dias',
       prazo_devolucao_data = (now() AT TIME ZONE 'America/Sao_Paulo')::date + 90
 WHERE status = 'ativa' AND prazo_devolucao_data IS NULL;
