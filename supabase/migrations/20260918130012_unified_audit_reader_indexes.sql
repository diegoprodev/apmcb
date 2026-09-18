-- Fase 5 da spec de rastreabilidade enterprise (camada de leitura
-- unificada em apps/bff/src/lib/unified-audit-reader.ts). Achado ALTO de
-- code review: nem `audit_events` nem `audit_logs` têm índice composto
-- pro padrão de acesso real desta camada (filtra por tenant_id e/ou
-- actor_id, ordena por created_at DESC + id DESC, corta em `limit`).
-- Sem isso, o planner ordena em memória o subconjunto filtrado inteiro —
-- custo cresce com o tamanho da trilha do tenant/ator, não com `limit`.
-- Índices simples já existentes (tenant_id, actor_id, created_at) não
-- resolvem isso sozinhos. Aplicado agora, antes de qualquer endpoint
-- real consumir esta camada (mais barato hoje, banco pequeno, do que
-- depois com volume real).

CREATE INDEX idx_audit_events_tenant_created
  ON public.audit_events (tenant_id, created_at DESC, id DESC);
CREATE INDEX idx_audit_events_actor_created
  ON public.audit_events (actor_id, created_at DESC, id DESC);

CREATE INDEX idx_audit_logs_tenant_created
  ON public.audit_logs (tenant_id, created_at DESC, id DESC);
CREATE INDEX idx_audit_logs_actor_created
  ON public.audit_logs (actor_id, created_at DESC, id DESC);
