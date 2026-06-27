-- Speed up Reserva > Cautelas: tenant/status filtering with latest-first ordering.
CREATE INDEX IF NOT EXISTS idx_cautelamentos_tenant_status_created
  ON public.cautelamentos (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cautelamentos_tenant_militar_created
  ON public.cautelamentos (tenant_id, militar_id, created_at DESC);
