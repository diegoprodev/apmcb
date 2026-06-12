-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE posto_enum AS ENUM (
  'cadete','aspirante','segundo_tenente','primeiro_tenente',
  'capitao','major','tenente_coronel','coronel'
);

CREATE TYPE role_enum AS ENUM ('admin','master','military');

CREATE TYPE registration_status_enum AS ENUM (
  'pending_biometric','complete','inactive'
);

CREATE TYPE material_category_enum AS ENUM (
  'arma','farda','acessorio','equipamento'
);

CREATE TYPE lending_status_enum AS ENUM ('ativo','devolvido');

CREATE TYPE notification_type_enum AS ENUM (
  'material_issued','material_returned',
  'account_created','biometric_registered'
);

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE profiles (
  id                  UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  matricula           TEXT NOT NULL UNIQUE,
  nome_completo       TEXT NOT NULL,
  posto               posto_enum NOT NULL DEFAULT 'cadete',
  turma               TEXT,
  foto_url            TEXT,
  role                role_enum NOT NULL DEFAULT 'military',
  registration_status registration_status_enum NOT NULL DEFAULT 'pending_biometric',
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- BIOMETRIC TEMPLATES
-- ============================================================
CREATE TABLE biometric_templates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  template_data BYTEA NOT NULL,
  finger_index  SMALLINT NOT NULL CHECK (finger_index BETWEEN 1 AND 10),
  registered_by UUID NOT NULL REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, finger_index)
);

-- ============================================================
-- MATERIAL TYPES
-- ============================================================
CREATE TABLE material_types (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome             TEXT NOT NULL,
  categoria        material_category_enum NOT NULL,
  quantidade_total INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_total >= 0),
  descricao        TEXT,
  ativo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- LENDINGS
-- ============================================================
CREATE TABLE lendings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_type_id UUID NOT NULL REFERENCES material_types(id),
  military_id      UUID NOT NULL REFERENCES profiles(id),
  master_id        UUID NOT NULL REFERENCES profiles(id),
  quantidade       SMALLINT NOT NULL DEFAULT 1 CHECK (quantidade > 0),
  status           lending_status_enum NOT NULL DEFAULT 'ativo',
  issued_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  returned_at      TIMESTAMPTZ,
  notes            TEXT
);

CREATE INDEX lendings_military_id_idx ON lendings(military_id);
CREATE INDEX lendings_status_idx ON lendings(status);
CREATE INDEX lendings_issued_at_idx ON lendings(issued_at DESC);

CREATE VIEW material_availability AS
SELECT
  mt.id,
  mt.nome,
  mt.categoria,
  mt.quantidade_total,
  COALESCE(SUM(l.quantidade) FILTER (WHERE l.status = 'ativo'), 0)::INTEGER AS quantidade_armada,
  mt.quantidade_total - COALESCE(SUM(l.quantidade) FILTER (WHERE l.status = 'ativo'), 0)::INTEGER AS quantidade_disponivel
FROM material_types mt
LEFT JOIN lendings l ON l.material_type_id = mt.id
WHERE mt.ativo = TRUE
GROUP BY mt.id;

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type       notification_type_enum NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  read_at    TIMESTAMPTZ,
  metadata   JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notifications_user_id_unread_idx
  ON notifications(user_id) WHERE read_at IS NULL;

-- ============================================================
-- AUDIT LOGS (immutable)
-- ============================================================
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID REFERENCES profiles(id),
  action        TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id   UUID,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX audit_logs_created_at_idx ON audit_logs(created_at DESC);
CREATE INDEX audit_logs_actor_id_idx ON audit_logs(actor_id);

CREATE RULE no_update_audit AS ON UPDATE TO audit_logs DO INSTEAD NOTHING;
CREATE RULE no_delete_audit AS ON DELETE TO audit_logs DO INSTEAD NOTHING;
