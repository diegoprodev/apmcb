-- ═══════════════════════════════════════════════════════════════════════
-- Livro Digital de Serviço — fecha race condition em abertura de turno
--
-- POST /api/shifts/open já fazia um SELECT (existe turno ativo do mesmo
-- armeiro? / existe turno ativo nesta reserva?) antes do INSERT, mas sem
-- constraint no banco isso é um clássico TOCTOU: dois requests concorrentes
-- (dois cliques, duas abas, dois armeiros abrindo turno na mesma reserva no
-- mesmo instante) podem passar pelos dois SELECTs antes de qualquer um dos
-- dois fazer o INSERT, resultando em dois turnos "ativo" simultâneos — para
-- o mesmo armeiro ou para a mesma reserva.
--
-- Os índices únicos parciais abaixo são a barreira real (atômica, garantida
-- pelo Postgres); o BFF (apps/bff/src/routes/shifts.ts) mantém os SELECTs
-- prévios apenas para dar uma mensagem amigável no caminho feliz e trata o
-- 23505 (unique_violation) como fallback de conflito no caminho raro da
-- corrida.
-- ═══════════════════════════════════════════════════════════════════════

-- Um armeiro não pode ter dois turnos "ativo" simultâneos (em qualquer reserva).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_armeiro_ativo
  ON service_shifts (armeiro_id)
  WHERE status = 'ativo';

-- Uma reserva não pode ter dois turnos "ativo" simultâneos (de armeiros diferentes).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_reserve_ativo
  ON service_shifts (reserve_id)
  WHERE status = 'ativo';
