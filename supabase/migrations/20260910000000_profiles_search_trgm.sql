-- ═══════════════════════════════════════════════════════════════════
-- Índices trigram para a busca de militares (GET /api/admin/search-profiles)
-- — nome, matrícula OU e-mail via `ILIKE '%termo%'`.
--
-- Com o volume atual (~1.2k linhas) a busca já é um seq scan sub-ms; estes
-- índices são FUTURO — mantêm a latência plana quando a base crescer (o
-- `ILIKE '%...%'` com curinga à esquerda NÃO usa índice btree comum, só
-- trigram GIN). Três índices separados porque o filtro é
-- `nome.ilike OR matricula.ilike OR email.ilike` sobre colunas distintas —
-- o planner faz bitmap OR entre eles.
--
-- ROLLBACK:
--   DROP INDEX IF EXISTS public.idx_profiles_nome_trgm;
--   DROP INDEX IF EXISTS public.idx_profiles_matricula_trgm;
--   DROP INDEX IF EXISTS public.idx_profiles_email_trgm;
--   -- pg_trgm fica (barato, usado por outros lugares no futuro)
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_profiles_nome_trgm
  ON public.profiles USING gin (nome_completo gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_matricula_trgm
  ON public.profiles USING gin (matricula gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_profiles_email_trgm
  ON public.profiles USING gin (email gin_trgm_ops)
  WHERE email IS NOT NULL;
