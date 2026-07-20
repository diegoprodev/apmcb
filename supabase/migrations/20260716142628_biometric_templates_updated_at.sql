-- Biometric Bridge Phase 1B: biometric_templates.updated_at.
--
-- Sem esta coluna, GET /api/biometric-bridge/templates/sync?since=... (sync
-- incremental do bridge Windows) não tem como saber quais templates mudaram
-- desde a última sincronização — o RPC record_biometric_enrollment já existente
-- faz ON CONFLICT ... DO UPDATE em re-cadastro, mas sem updated_at esse UPDATE
-- não deixava rastro temporal algum.
--
-- Reaproveita o trigger genérico public.update_updated_at() já usado em
-- outras tabelas do projeto (não cria função nova).
--
-- Nota: aplicada em produção via MCP execute_sql em 2026-07-16 (migration
-- "biometric_templates_updated_at", version 20260716142628) antes deste
-- arquivo existir no repo — commitado agora para manter o histórico de
-- migrations consistente entre repo e produção.

alter table biometric_templates
  add column if not exists updated_at timestamptz not null default now();

create trigger biometric_templates_set_updated_at
  before update on public.biometric_templates
  for each row execute function update_updated_at();
