-- Rastreabilidade cross-turno da devolução: quem armou pode ser diferente de
-- quem devolveu, e podem ser turnos (service_shifts) diferentes, às vezes
-- dias depois. Pedido do dono do produto (2026-09-22): "nas devoluções deve
-- constar tanto com quem se armou como com quem devolveu... pode acontecer
-- de se armar agora e o usuario só desarmar em dois dias depois, com outro
-- armeiro. isso tudo deve ser rastreável e auditável". Aplica-se aos dois
-- sistemas de custódia (cautelamentos = médio/longo prazo com assinatura
-- dupla; lendings = saída simples de curto prazo) — mesmo gap estrutural
-- nos dois: só existia "quem emitiu" (armeiro_id / master_id), nunca "quem
-- devolveu".
--
-- Sem CHECK de consistência com status: mesmo padrão já usado por
-- condicao_devolucao/data_devolucao nessas tabelas (nullable até a
-- devolução acontecer, sem enforcement de banco) — evita problema de dados
-- históricos pré-migration sob constraint rígida. Preenchimento correto é
-- responsabilidade do BFF (mesma rota que já seta status='devolvida'/
-- status_legacy='devolvido' passa a setar estes campos no mesmo UPDATE).

ALTER TABLE public.cautelamentos
  ADD COLUMN IF NOT EXISTS devolucao_processada_por uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS shift_id_emissao   uuid REFERENCES public.service_shifts(id),
  ADD COLUMN IF NOT EXISTS shift_id_devolucao uuid REFERENCES public.service_shifts(id);

CREATE INDEX IF NOT EXISTS idx_cautelamentos_devolucao_processada_por
  ON public.cautelamentos (devolucao_processada_por)
  WHERE devolucao_processada_por IS NOT NULL;

-- Achado MÉDIO de review (2026-09-23): consulta natural desta feature
-- ("todos os movimentos deste turno") faria sequential scan sem estes 2.
CREATE INDEX IF NOT EXISTS idx_cautelamentos_shift_id_emissao
  ON public.cautelamentos (shift_id_emissao)
  WHERE shift_id_emissao IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cautelamentos_shift_id_devolucao
  ON public.cautelamentos (shift_id_devolucao)
  WHERE shift_id_devolucao IS NOT NULL;

ALTER TABLE public.lendings
  ADD COLUMN IF NOT EXISTS returned_by uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS shift_id_emissao   uuid REFERENCES public.service_shifts(id),
  ADD COLUMN IF NOT EXISTS shift_id_devolucao uuid REFERENCES public.service_shifts(id);

CREATE INDEX IF NOT EXISTS idx_lendings_returned_by
  ON public.lendings (returned_by)
  WHERE returned_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lendings_shift_id_emissao
  ON public.lendings (shift_id_emissao)
  WHERE shift_id_emissao IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lendings_shift_id_devolucao
  ON public.lendings (shift_id_devolucao)
  WHERE shift_id_devolucao IS NOT NULL;

-- Rollback:
-- DROP INDEX IF EXISTS idx_lendings_shift_id_devolucao;
-- DROP INDEX IF EXISTS idx_lendings_shift_id_emissao;
-- DROP INDEX IF EXISTS idx_lendings_returned_by;
-- ALTER TABLE public.lendings DROP COLUMN IF EXISTS shift_id_devolucao;
-- ALTER TABLE public.lendings DROP COLUMN IF EXISTS shift_id_emissao;
-- ALTER TABLE public.lendings DROP COLUMN IF EXISTS returned_by;
-- DROP INDEX IF EXISTS idx_cautelamentos_shift_id_devolucao;
-- DROP INDEX IF EXISTS idx_cautelamentos_shift_id_emissao;
-- DROP INDEX IF EXISTS idx_cautelamentos_devolucao_processada_por;
-- ALTER TABLE public.cautelamentos DROP COLUMN IF EXISTS shift_id_devolucao;
-- ALTER TABLE public.cautelamentos DROP COLUMN IF EXISTS shift_id_emissao;
-- ALTER TABLE public.cautelamentos DROP COLUMN IF EXISTS devolucao_processada_por;
