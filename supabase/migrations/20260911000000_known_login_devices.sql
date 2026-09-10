-- ═══════════════════════════════════════════════════════════════════
-- known_login_devices — dispositivos de login já vistos por usuário
-- (Fase 3 do e-mail transacional: alerta de novo acesso).
--
-- O BFF (lib/login-device.ts) grava aqui a cada login/exchange bem-sucedido.
-- `device_hash` = HMAC-SHA256(LOGIN_DEVICE_HASH_PEPPER, user_id|ua_norm|ip_prefix).
-- Se o hash é novo (e não é o 1º device do usuário, nem logo após ativação) →
-- dispara o e-mail `new_login`.
--
-- Privacidade (honesta): `device_hash` é irreversível SÓ enquanto o pepper não
-- vaza — o espaço de entrada (ip_prefix /24 + ua_family grosseiro) é pequeno o
-- bastante para força-bruta se o pepper vazar. `ip_prefix`/`ua_family` ficam em
-- claro na linha. Mitigação real: RLS sem policy (só service_role) + retenção
-- curta (90d), não o hash.
--
-- ROLLBACK:
--   SELECT cron.unschedule('cleanup-known-login-devices');
--   DROP TABLE IF EXISTS public.known_login_devices;
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.known_login_devices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  device_hash    TEXT NOT NULL,
  ua_family      TEXT,                  -- ex: "Chrome em Windows" (grosseiro)
  ip_prefix      TEXT,                  -- /24 (v4) ou /48 (v6); NULL se IP não confiável
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_hash)
);

CREATE INDEX IF NOT EXISTS idx_kld_user ON public.known_login_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_kld_last_seen ON public.known_login_devices(last_seen_at);

ALTER TABLE public.known_login_devices ENABLE ROW LEVEL SECURITY;
-- sem policy: apenas service_role (BFF) enxerga/escreve.

COMMENT ON TABLE public.known_login_devices IS
  'Dispositivos de login já vistos por usuário (Fase 3 e-mail). device_hash = HMAC(pepper, user_id|ua_norm|ip_prefix). RLS sem policy: só service_role.';

-- Retenção 90 dias.
SELECT cron.schedule(
  'cleanup-known-login-devices',
  '17 4 * * *',
  $$DELETE FROM public.known_login_devices WHERE last_seen_at < now() - interval '90 days'$$
);
