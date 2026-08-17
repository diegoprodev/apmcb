-- Suporte a anexos de ocorrência no modal "Registrar ocorrência de material"
-- (apps/web/src/app/(dashboard)/reserva/arsenal/manutencao/
-- _registrar-ocorrencia-dialog.tsx): foto opcional da avaria/perda e
-- associação opcional de um militar (matrícula + nome) que estava com o
-- item, para rastreabilidade. PATCH /api/arsenal/items/:id/ocorrencia
-- (apps/bff/src/routes/arsenal.ts) já gravava o texto livre em
-- descricao_adicional — não havia nenhuma coluna pra foto nem pra associar
-- um usuário à ocorrência.
--
-- Decisão de modelagem: NÃO criamos uma tabela de ocorrências separada.
-- public.ocorrencias (20260617000006_ocorrencias.sql) já existe mas é um
-- fluxo DIFERENTE — autorrelato do próprio militar sobre um item que ele
-- tem em cautela/lending (military_id + lending_id obrigatórios) — não
-- serve para este fluxo (armeiro/admin reportando um item achado com
-- problema numa conferência física de estoque, sem lending ativo
-- necessariamente). As colunas abaixo seguem o mesmo padrão já usado por
-- status_operacional/descricao_adicional nesta mesma tabela: refletem o
-- estado da ocorrência MAIS RECENTE do item (sobrescritas a cada nova
-- ocorrência registrada/reclassificada), não um histórico append-only.
-- Cada item físico é sua própria linha, então uma consulta
-- "WHERE ocorrencia_usuario_associado_id = X" ainda devolve corretamente
-- todas as ocorrências de itens DIFERENTES associadas a um mesmo militar ao
-- longo do tempo — é essa consulta que alimenta a página de histórico do
-- usuário (GET /api/usuario/historico, apps/bff/src/routes/usuario.ts).
ALTER TABLE public.material_items
  ADD COLUMN IF NOT EXISTS ocorrencia_foto_url TEXT,
  ADD COLUMN IF NOT EXISTS ocorrencia_usuario_associado_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ocorrencia_registrada_por UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ocorrencia_registrada_em TIMESTAMPTZ;

-- Índice parcial (só linhas com associação) — a página de histórico do
-- usuário filtra exatamente por essa coluna a cada carregamento.
CREATE INDEX IF NOT EXISTS material_items_ocorrencia_usuario_idx
  ON public.material_items (ocorrencia_usuario_associado_id)
  WHERE ocorrencia_usuario_associado_id IS NOT NULL;
