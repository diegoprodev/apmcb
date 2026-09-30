CREATE INDEX IF NOT EXISTS idx_cautelamentos_shift_id_emissao
  ON public.cautelamentos (shift_id_emissao)
  WHERE shift_id_emissao IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cautelamentos_shift_id_devolucao
  ON public.cautelamentos (shift_id_devolucao)
  WHERE shift_id_devolucao IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lendings_shift_id_emissao
  ON public.lendings (shift_id_emissao)
  WHERE shift_id_emissao IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lendings_shift_id_devolucao
  ON public.lendings (shift_id_devolucao)
  WHERE shift_id_devolucao IS NOT NULL;