-- Adicionar coluna custom_subdomain em tenants (se não existir)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS custom_subdomain TEXT
  UNIQUE
  CHECK (custom_subdomain ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$');

CREATE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(custom_subdomain)
  WHERE custom_subdomain IS NOT NULL;;
