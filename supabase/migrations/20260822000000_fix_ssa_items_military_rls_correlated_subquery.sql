-- Achado real (continuação de 20260819020000): aquele fix corrigiu a
-- policy de STAFF (ssa_items_staff_select/write) para comparação direta de
-- tenant_id, mas o timeout de 8s+ em material_request_items continuou
-- IDÊNTICO em produção depois de aplicado (revalidado ao vivo: 336 linhas
-- órfãs restantes não bastam para explicar 8s de timeout numa comparação
-- direta). Causa raiz real, confirmada consultando pg_policy ao vivo: existe
-- uma SEGUNDA dupla de policies PERMISSIVE na mesma tabela,
-- ssa_items_military_select (FOR SELECT) e ssa_items_military_insert (FOR
-- INSERT), nunca tocadas por nenhuma das duas migrations anteriores
-- (20260819010000/020000, que só miravam as policies "staff"), ainda usando
-- EXISTS CORRELACIONADO:
--
--   EXISTS (SELECT 1 FROM material_requests r
--            WHERE r.id = material_request_items.request_id
--              AND r.military_id = auth.uid())
--
-- RLS combina todas as policies PERMISSIVE de um mesmo comando via OR — o
-- Postgres ainda precisa avaliar essa subquery correlacionada linha a
-- linha mesmo com a policy de staff já corrigida ao lado. Mesma causa raiz
-- documentada em 20260819020000, mesma tabela, policy diferente que não
-- tinha sido auditada da vez anterior.
--
-- Fix: mesma técnica já validada para tenant_id — material_request_items
-- ganha uma coluna military_id própria (denormalizada do pai
-- material_requests), populada nos 2 pontos de INSERT em
-- apps/bff/src/routes/ssa.ts (mesmo commit desta migration), e as policies
-- passam a comparar direto (military_id = auth.uid()), sem subquery.

ALTER TABLE public.material_request_items
  ADD COLUMN IF NOT EXISTS military_id uuid REFERENCES public.profiles(id);

UPDATE public.material_request_items mri
SET military_id = mr.military_id
FROM public.material_requests mr
WHERE mri.request_id = mr.id
  AND mri.military_id IS NULL
  AND mr.military_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_material_request_items_military
  ON public.material_request_items (military_id);

DROP POLICY IF EXISTS ssa_items_military_select ON public.material_request_items;
DROP POLICY IF EXISTS ssa_items_military_insert ON public.material_request_items;

CREATE POLICY ssa_items_military_select ON public.material_request_items
  FOR SELECT
  USING (military_id = auth.uid());

-- Achado de code review: WITH CHECK só com `military_id = auth.uid()`
-- regride a semântica de segurança — `military_id` é coluna do próprio
-- payload do INSERT, controlada por quem chama, então sozinha essa
-- checagem não amarra a linha à `request_id` real (um chamador poderia
-- inserir um item forjado dentro da solicitação de OUTRA pessoa, só
-- preenchendo `military_id` com o próprio uid). Mantém o EXISTS
-- correlacionado aqui: INSERT roda uma linha por vez (nunca contra milhares
-- de linhas acumuladas como o SELECT problemático original), então o custo
-- é irrelevante — o timeout que motivou esta migration inteira estava no
-- lado da leitura, não da escrita.
CREATE POLICY ssa_items_military_insert ON public.material_request_items
  FOR INSERT
  WITH CHECK (
    military_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.material_requests r
      WHERE r.id = request_id AND r.military_id = auth.uid()
    )
  );
