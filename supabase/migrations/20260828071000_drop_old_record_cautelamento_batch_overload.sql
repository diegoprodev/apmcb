-- Achado durante a implementação (2026-08-28): a migration anterior
-- (20260828070000) usou CREATE OR REPLACE FUNCTION com uma assinatura
-- diferente (parâmetro novo p_prazo_devolucao_tipo) — Postgres não
-- substitui a função nesse caso, cria uma SOBRECARGA (overload). Ficaram
-- 2 versões de record_cautelamento_batch (7 e 8 parâmetros), o que
-- PostgREST resolve de forma ambígua/imprevisível em chamadas RPC.
-- A versão de 8 parâmetros (com DEFAULT NULL no novo) é um superset
-- totalmente compatível com todo caller existente — remove a antiga.
DROP FUNCTION IF EXISTS public.record_cautelamento_batch(uuid, uuid, uuid, uuid, uuid, text, jsonb);
