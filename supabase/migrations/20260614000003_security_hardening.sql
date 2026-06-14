-- ============================================================
-- APMCB Security Hardening — 2026-06-14
-- ============================================================

-- ── 1. CRITICAL: Prevent military from escalating own role ──
-- Previous policy had no WITH CHECK, allowing military users to
-- submit UPDATE setting role='admin' on their own profile row.

ALTER POLICY profiles_update ON public.profiles
  USING (
    (auth_role() = 'admin'::role_enum)
    OR ((auth.uid() = id) AND (auth_role() = 'military'::role_enum))
  )
  WITH CHECK (
    (auth_role() = 'admin'::role_enum)
    OR (
      (auth.uid() = id)
      AND (auth_role() = 'military'::role_enum)
      -- Military cannot change their own role or registration_status
      AND (role = (SELECT role FROM public.profiles WHERE id = auth.uid()))
      AND (registration_status = (SELECT registration_status FROM public.profiles WHERE id = auth.uid()))
    )
  );

-- ── 2. Missing performance indexes ──────────────────────────

-- notifications: ordered by user + time (main query pattern)
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON public.notifications (user_id, created_at DESC);

-- lendings: FK lookup by material_type_id
CREATE INDEX IF NOT EXISTS lendings_material_type_idx
  ON public.lendings (material_type_id);

-- profiles: email lookup for auth
CREATE INDEX IF NOT EXISTS profiles_email_idx
  ON public.profiles (email)
  WHERE email IS NOT NULL;

-- audit_logs: filtered by resource_type + time
CREATE INDEX IF NOT EXISTS audit_logs_resource_type_idx
  ON public.audit_logs (resource_type, created_at DESC);

-- ── 3. Explicit INSERT policy for notifications ──────────────
-- Currently relies on service_role bypass. Explicit policy makes
-- intent clear and allows future non-service-role inserts (e.g. Edge Fn).

CREATE POLICY notifications_insert_service
  ON public.notifications FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ── 4. push_subscriptions table for PWA Web Push ────────────

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth_key      TEXT NOT NULL,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users manage their own subscriptions
CREATE POLICY push_sub_select ON public.push_subscriptions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY push_sub_insert ON public.push_subscriptions
  FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY push_sub_delete ON public.push_subscriptions
  FOR DELETE USING (user_id = auth.uid());

-- Service role reads all (to send pushes)
CREATE POLICY push_sub_service_select ON public.push_subscriptions
  FOR SELECT TO service_role USING (true);

-- Index for fast lookup when sending pushes
CREATE INDEX IF NOT EXISTS push_sub_user_idx
  ON public.push_subscriptions (user_id);

-- ── 5. Audit trail for push subscriptions ────────────────────

CREATE OR REPLACE FUNCTION public.audit_push_subscription()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    VALUES (NEW.user_id, 'push.subscribed', 'push_subscriptions', NEW.id,
            jsonb_build_object('endpoint_hash', md5(NEW.endpoint)));
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    VALUES (OLD.user_id, 'push.unsubscribed', 'push_subscriptions', OLD.id, '{}'::jsonb);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER push_subscription_audit
  AFTER INSERT OR DELETE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.audit_push_subscription();
