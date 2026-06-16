-- ============================================================
-- SSA — Sistema de Solicitação de Armamento
-- 2026-06-15
-- ============================================================
-- Introduces:
--   • material_request_status_enum
--   • totp_secrets table (BFF-only access via service_role)
--   • material_requests + material_request_items tables
--   • Full RLS policies for military/master/admin
--   • Audit trigger for every status transition
--   • expire_material_requests() function (lazy + cron expiry)
--   • Updated material_availability view (+quantidade_reservada)
--   • New notification_type_enum values for SSA events
-- ============================================================

-- ── 1. New enum: material request status ─────────────────────

CREATE TYPE public.material_request_status_enum AS ENUM (
  'pendente',   -- awaiting Reserva de Armamento response
  'aprovado',   -- approved, pickup window open (6h)
  'rejeitado',  -- denied by Reserva de Armamento
  'retirado',   -- material physically collected (+ lending created)
  'expirado',   -- 6h window elapsed without pickup
  'cancelado'   -- cancelled by military or Reserva de Armamento
);

-- ── 2. Extend notification_type_enum ─────────────────────────

ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'armament_requested';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'armament_approved';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'armament_rejected';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'armament_delivered';
ALTER TYPE public.notification_type_enum ADD VALUE IF NOT EXISTS 'armament_expired';

-- ── 3. TOTP secrets table ─────────────────────────────────────
-- Accessed EXCLUSIVELY by the BFF (Hetzner VPS) via service_role.
-- Military users have NO RLS policy to read their own secret.
-- The code is computed server-side and returned to the client — never the raw secret.

CREATE TABLE public.totp_secrets (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  secret              TEXT        NOT NULL,   -- Base32-encoded, 160 bits
  algorithm           TEXT        NOT NULL DEFAULT 'SHA1',
  digits              INTEGER     NOT NULL DEFAULT 6,
  period              INTEGER     NOT NULL DEFAULT 30,  -- seconds
  enabled             BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_validated_at   TIMESTAMPTZ,
  failure_count       INTEGER     NOT NULL DEFAULT 0,
  last_failure_at     TIMESTAMPTZ
);

ALTER TABLE public.totp_secrets ENABLE ROW LEVEL SECURITY;

-- Only service_role (BFF) can access TOTP secrets
CREATE POLICY totp_service_role_all ON public.totp_secrets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ── 4. Material requests table ────────────────────────────────

CREATE TABLE public.material_requests (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  military_id       UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  reserva_id        UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  status            public.material_request_status_enum NOT NULL DEFAULT 'pendente',
  notes             TEXT,           -- optional note from military
  denial_reason     TEXT,           -- required when status = rejeitado/cancelado by Reserva de Armamento
  totp_validated    BOOLEAN     NOT NULL DEFAULT FALSE,
  totp_validated_at TIMESTAMPTZ,
  -- Timeline (all server-side, client cannot set these)
  requested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at       TIMESTAMPTZ,
  rejected_at       TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  cancelled_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,   -- set to approved_at + 6h when approved
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Integrity constraints
  CONSTRAINT denial_requires_rejection CHECK (
    denial_reason IS NULL OR status IN ('rejeitado', 'cancelado')
  ),
  CONSTRAINT expires_requires_approval CHECK (
    expires_at IS NULL OR approved_at IS NOT NULL
  )
);

CREATE TRIGGER ssa_requests_updated_at
  BEFORE UPDATE ON public.material_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Performance indexes
CREATE INDEX ssa_req_military_status_idx
  ON public.material_requests (military_id, status);

CREATE INDEX ssa_req_pending_idx
  ON public.material_requests (status, requested_at DESC)
  WHERE status = 'pendente';

CREATE INDEX ssa_req_approved_expiry_idx
  ON public.material_requests (expires_at)
  WHERE status = 'aprovado';

CREATE INDEX ssa_req_updated_idx
  ON public.material_requests (updated_at DESC);

ALTER TABLE public.material_requests ENABLE ROW LEVEL SECURITY;

-- Military: see own requests
CREATE POLICY ssa_military_select ON public.material_requests
  FOR SELECT
  USING (military_id = auth.uid());

-- Military: create own requests (max 1 pending/approved at a time enforced in BFF + here)
CREATE POLICY ssa_military_insert ON public.material_requests
  FOR INSERT
  WITH CHECK (
    military_id = auth.uid()
    AND auth_role() = 'usuario'::public.role_enum
    AND NOT EXISTS (
      SELECT 1 FROM public.material_requests
      WHERE military_id = auth.uid()
        AND status IN ('pendente', 'aprovado')
    )
  );

-- Military: cancel own PENDING request only
CREATE POLICY ssa_military_cancel ON public.material_requests
  FOR UPDATE
  USING (military_id = auth.uid() AND status = 'pendente')
  WITH CHECK (military_id = auth.uid() AND status = 'cancelado');

-- Reserva de Armamento/Admin: see all requests
CREATE POLICY ssa_staff_select ON public.material_requests
  FOR SELECT
  USING (auth_role() IN ('admin'::public.role_enum, 'master'::public.role_enum));

-- Reserva de Armamento/Admin: update status (approve, reject, deliver, cancel)
CREATE POLICY ssa_staff_update ON public.material_requests
  FOR UPDATE
  USING (auth_role() IN ('admin'::public.role_enum, 'master'::public.role_enum))
  WITH CHECK (auth_role() IN ('admin'::public.role_enum, 'master'::public.role_enum));

-- ── 5. Material request items table ──────────────────────────

CREATE TABLE public.material_request_items (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id                    UUID        NOT NULL REFERENCES public.material_requests(id) ON DELETE CASCADE,
  material_type_id              UUID        NOT NULL REFERENCES public.material_types(id) ON DELETE RESTRICT,
  -- Snapshot for historical accuracy (immutable after creation)
  material_nome_snapshot        TEXT        NOT NULL,
  material_categoria_snapshot   TEXT        NOT NULL,
  -- Quantity chosen by military (never sees total stock, just availability)
  requested_quantity            INTEGER     NOT NULL DEFAULT 1 CHECK (requested_quantity > 0),
  -- Quantity actually delivered (set by Reserva de Armamento at delivery time)
  delivered_quantity            INTEGER     CHECK (delivered_quantity > 0),
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ssa_items_request_idx  ON public.material_request_items (request_id);
CREATE INDEX ssa_items_material_idx ON public.material_request_items (material_type_id);

ALTER TABLE public.material_request_items ENABLE ROW LEVEL SECURITY;

-- Military: see items in own requests
CREATE POLICY ssa_items_military_select ON public.material_request_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.material_requests r
      WHERE r.id = request_id AND r.military_id = auth.uid()
    )
  );

-- Military: insert items into own requests
CREATE POLICY ssa_items_military_insert ON public.material_request_items
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.material_requests r
      WHERE r.id = request_id AND r.military_id = auth.uid()
    )
  );

-- Reserva de Armamento/Admin: full access to items
CREATE POLICY ssa_items_staff_all ON public.material_request_items
  FOR ALL
  USING (auth_role() IN ('admin'::public.role_enum, 'master'::public.role_enum));

-- ── 6. Audit trigger for material_requests ───────────────────

CREATE OR REPLACE FUNCTION public.audit_material_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
  VALUES (
    COALESCE(NEW.reserva_id, NEW.military_id),
    CASE TG_OP
      WHEN 'INSERT' THEN 'ssa.solicitado'
      ELSE 'ssa.' || NEW.status::text
    END,
    'material_requests',
    COALESCE(NEW.id, OLD.id),
    jsonb_build_object(
      'status_anterior',  CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END,
      'status_novo',      NEW.status,
      'military_id',      NEW.military_id,
      'reserva_id',       NEW.reserva_id,
      'denial_reason',    NEW.denial_reason,
      'totp_validated',   NEW.totp_validated,
      'expires_at',       NEW.expires_at
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER ssa_request_audit
  AFTER INSERT OR UPDATE ON public.material_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_material_request();

-- ── 7. Auto-expiry function ───────────────────────────────────
-- Called lazily from BFF list endpoints AND by cron Edge Function.
-- Returns the count of requests just expired.

CREATE OR REPLACE FUNCTION public.expire_material_requests()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  expired_count INTEGER;
BEGIN
  UPDATE public.material_requests
  SET status = 'expirado', updated_at = now()
  WHERE status = 'aprovado'
    AND expires_at < now();
  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;

-- ── 8. RPC: has_totp() — safe status check without exposing secret ──

CREATE OR REPLACE FUNCTION public.has_totp()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.totp_secrets
    WHERE user_id = auth.uid() AND enabled = TRUE
  );
$$;

-- ── 9. Update material_availability view (+quantidade_reservada) ──

DROP VIEW IF EXISTS public.material_availability;

CREATE OR REPLACE VIEW public.material_availability AS
SELECT
  mt.id,
  mt.nome,
  mt.categoria,
  mt.quantidade_total,
  COALESCE(
    SUM(l.quantidade) FILTER (WHERE l.status = 'ativo'), 0
  )::INTEGER AS quantidade_armada,
  COALESCE(
    SUM(ri.requested_quantity) FILTER (
      WHERE r.status IN ('pendente', 'aprovado')
    ), 0
  )::INTEGER AS quantidade_reservada,
  (
    mt.quantidade_total
    - COALESCE(SUM(l.quantidade) FILTER (WHERE l.status = 'ativo'), 0)
  )::INTEGER AS quantidade_disponivel,
  mt.ativo
FROM public.material_types mt
LEFT JOIN public.lendings       l  ON l.material_type_id = mt.id
LEFT JOIN public.material_request_items ri ON ri.material_type_id = mt.id
LEFT JOIN public.material_requests      r  ON r.id = ri.request_id
WHERE mt.ativo = TRUE
GROUP BY mt.id, mt.nome, mt.categoria, mt.quantidade_total, mt.ativo;
