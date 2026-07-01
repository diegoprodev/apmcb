-- Migration: tenant-limits
-- Adds max_reserves and max_users columns to tenants table.
-- These limits are set by the superadmin (Nexus) and enforced by the BFF.
-- Admin globals can create reserves up to max_reserves; user registrations are capped at max_users.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS max_reserves INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_users    INTEGER NOT NULL DEFAULT 100;

COMMENT ON COLUMN tenants.max_reserves IS 'Máximo de reservas que o tenant pode ter (definido pelo superadmin)';
COMMENT ON COLUMN tenants.max_users    IS 'Máximo de usuários registrados no tenant (definido pelo superadmin)';
