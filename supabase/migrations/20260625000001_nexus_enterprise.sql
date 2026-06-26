-- Fase 5B — Nexus Enterprise: branding por tenant + subdomain
-- Nota: tenant_branding já existe do harness 7B (criada em 2026-06-22)
-- Esta migration apenas adiciona o custom_subdomain e garante índice

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_subdomain TEXT
  UNIQUE
  CHECK (custom_subdomain ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');

CREATE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(custom_subdomain)
  WHERE custom_subdomain IS NOT NULL;
