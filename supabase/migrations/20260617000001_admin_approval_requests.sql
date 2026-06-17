-- Admin Approval Requests
-- Covers: stock_adjustment (armeiro asks to change quantidade_total)
--         material_addition (armeiro asks to add a new material type)
-- Admin approves → action executed automatically; rejects → denied with note.

CREATE TABLE public.admin_approval_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            TEXT NOT NULL CHECK (type IN ('stock_adjustment', 'material_addition')),
  requestor_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  material_type_id UUID REFERENCES public.material_types(id) ON DELETE SET NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  -- stock_adjustment payload: { new_quantity, notes }
  -- material_addition payload: { nome, categoria, quantidade_total, notes }
  status          TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  admin_note      TEXT,
  reviewed_by     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.aar_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER aar_updated_at
  BEFORE UPDATE ON public.admin_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.aar_set_updated_at();

CREATE INDEX aar_status_idx    ON public.admin_approval_requests (status, created_at DESC);
CREATE INDEX aar_requestor_idx ON public.admin_approval_requests (requestor_id, created_at DESC);

ALTER TABLE public.admin_approval_requests ENABLE ROW LEVEL SECURITY;

-- Armeiro/master: ver/inserir próprias solicitações
CREATE POLICY aar_own_select ON public.admin_approval_requests
  FOR SELECT USING (requestor_id = auth.uid());

CREATE POLICY aar_own_insert ON public.admin_approval_requests
  FOR INSERT WITH CHECK (
    requestor_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('master', 'admin'))
  );

-- Admin: ver e atualizar tudo
CREATE POLICY aar_admin_select ON public.admin_approval_requests
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY aar_admin_update ON public.admin_approval_requests
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Auditoria automática em aprovação/rejeição
CREATE OR REPLACE FUNCTION public.audit_approval_request()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    VALUES (
      COALESCE(NEW.reviewed_by, NEW.requestor_id),
      'arsenal.' || NEW.type || '.' || NEW.status,
      'admin_approval_requests',
      NEW.id,
      jsonb_build_object(
        'type', NEW.type,
        'requestor_id', NEW.requestor_id,
        'material_type_id', NEW.material_type_id,
        'payload', NEW.payload,
        'admin_note', NEW.admin_note,
        'status_anterior', OLD.status
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER aar_audit
  AFTER UPDATE ON public.admin_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_approval_request();
