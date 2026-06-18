-- Ocorrências: militares reportam problemas com materiais

DO $$ BEGIN
  CREATE TYPE ocorrencia_status_enum AS ENUM ('aberta','em_analise','resolvida','improcedente');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'ocorrencia_aberta';
EXCEPTION WHEN others THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE notification_type_enum ADD VALUE IF NOT EXISTS 'ocorrencia_resolvida';
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.ocorrencias (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  military_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  lending_id            UUID REFERENCES public.lendings(id) ON DELETE SET NULL,
  material_type_id      UUID REFERENCES public.material_types(id) ON DELETE SET NULL,
  material_nome_snapshot TEXT,
  titulo                TEXT NOT NULL CHECK (char_length(titulo) >= 5),
  descricao             TEXT NOT NULL CHECK (char_length(descricao) >= 10),
  status                ocorrencia_status_enum NOT NULL DEFAULT 'aberta',
  resolvida_por         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolvida_em          TIMESTAMPTZ,
  resolucao             TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ocorrencias ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY occ_military_select ON public.ocorrencias
    FOR SELECT USING (military_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY occ_military_insert ON public.ocorrencias
    FOR INSERT WITH CHECK (military_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY occ_staff ON public.ocorrencias
    FOR ALL USING (auth_role() IN ('master','admin'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE TRIGGER ocorrencias_updated_at
  BEFORE UPDATE ON public.ocorrencias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX IF NOT EXISTS ocorrencias_military_idx ON public.ocorrencias (military_id, status);
CREATE INDEX IF NOT EXISTS ocorrencias_status_idx   ON public.ocorrencias (status, created_at DESC);
