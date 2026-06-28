-- Performance indexes for frequently queried tables
-- Skips indexes already created in previous migrations

-- ── Profiles ──────────────────────────────────────────────────────────────────
-- Full-text search on nome_completo (supports ilike via GIN trigram or tsvector)
CREATE INDEX IF NOT EXISTS idx_profiles_nome_completo_gin ON profiles USING GIN (to_tsvector('portuguese', nome_completo));
-- Lookup by matricula (used in login RPC and admin search)
CREATE INDEX IF NOT EXISTS idx_profiles_matricula ON profiles (matricula);
-- Filter by role (admin pages list users by role)
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles (role);
-- Filter by tenant (all tenant-scoped queries)
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id ON profiles (tenant_id);
-- Filter by registration_status (pending approval workflows)
CREATE INDEX IF NOT EXISTS idx_profiles_registration_status ON profiles (registration_status);

-- ── Lendings ──────────────────────────────────────────────────────────────────
-- reserve_id not yet indexed (only item_id, status, tenant_id, issued_at exist)
CREATE INDEX IF NOT EXISTS idx_lendings_reserve_id ON lendings (reserve_id);
-- status_legacy column (the renamed status column); lendings_status_idx covers status but not status_legacy
CREATE INDEX IF NOT EXISTS idx_lendings_status_legacy ON lendings (status_legacy);
-- Composite for reserve + status queries (most common join pattern)
CREATE INDEX IF NOT EXISTS idx_lendings_status_reserve ON lendings (reserve_id, status_legacy);

-- ── Cautelamentos ─────────────────────────────────────────────────────────────
-- reserve_id not yet indexed (status and militar_id already covered)
CREATE INDEX IF NOT EXISTS idx_cautelamentos_reserve_id ON cautelamentos (reserve_id);

-- ── Material Items ────────────────────────────────────────────────────────────
-- reserve_id not yet indexed (status_operacional and tenant_id already covered)
CREATE INDEX IF NOT EXISTS idx_material_items_reserve_id ON material_items (reserve_id);
-- Composite reserve + status (common filter in arsenal views)
CREATE INDEX IF NOT EXISTS idx_material_items_reserve_status ON material_items (reserve_id, status_operacional);

-- ── Service Log Events ────────────────────────────────────────────────────────
-- idx_log_shift covers (shift_id) but ascending happened_at composite is not yet indexed
CREATE INDEX IF NOT EXISTS idx_service_log_events_shift_happened ON service_log_events (shift_id, happened_at ASC);

-- ── Notifications ─────────────────────────────────────────────────────────────
-- Standalone user_id lookup (existing index is composite with read_at / unread filter)
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
-- Composite user + read_at for "unread" queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications (user_id, read_at);

-- ── Ocorrencias ───────────────────────────────────────────────────────────────
-- reserve_id not yet indexed (status and military_id already covered)
CREATE INDEX IF NOT EXISTS idx_ocorrencias_reserve_id ON public.ocorrencias (reserve_id);
-- Standalone status index (existing indexes are composite)
CREATE INDEX IF NOT EXISTS idx_ocorrencias_status ON public.ocorrencias (status);

-- ── Material Requests (SSA) ───────────────────────────────────────────────────
-- status column (idx_material_requests_tenant only covers tenant_id)
CREATE INDEX IF NOT EXISTS idx_material_requests_status ON public.material_requests (status);
-- reserva_id (the reserva/armeiro column; reserve_id does not exist on this table)
CREATE INDEX IF NOT EXISTS idx_material_requests_reserva_id ON public.material_requests (reserva_id);
