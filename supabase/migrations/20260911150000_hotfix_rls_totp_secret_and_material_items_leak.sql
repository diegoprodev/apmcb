-- Hotfix — 3 falhas de RLS pré-existentes achadas durante o code review do
-- SP3 (baseline de pg_policies expôs o corpo real das policies pela 1ª vez).
-- Regra canônica CLAUDE.md ("Falhas pré-existentes"): corrigir agora, não
-- documentar como débito técnico.
--
-- ROLLBACK:
--   CREATE POLICY totp_owner_read_status ON public.totp_secrets FOR SELECT TO authenticated USING (user_id = auth.uid());
--   CREATE OR REPLACE FUNCTION... (restaurar qual antigo de material_items_usuario_select, ver git log da policy)
--   CREATE POLICY service_role_insert_signatures ON public.document_signatures FOR INSERT TO public WITH CHECK (true);

-- ── 1. totp_secrets: policy achava que RLS é column-level — não é ─────────
-- A policy dizia (comentário original, 20260615000002): "a página do cadete
-- seleciona só id, então expor a existência da linha é seguro". Falso: RLS é
-- row-level; um authenticated com o grant de tabela padrão do PostgREST pode
-- pedir `select=secret` e ler o próprio segredo TOTP em claro, gerando
-- códigos offline e contornando rate-limit/anti-replay do BFF
-- (checkTotpGuard). Grep confirma (2026-09-11): NENHUM código em apps/web
-- consulta totp_secrets diretamente — 100% dos acessos são BFF com
-- service_role (que já bypassa RLS). A policy nunca teve consumidor
-- legítimo. Alinha com o design original documentado em
-- 20260615000001_ssa_schema.sql: "Military users have NO RLS policy to read
-- their own secret".
DROP POLICY IF EXISTS totp_owner_read_status ON public.totp_secrets;

-- ── 2. material_items_usuario_select: EXISTS não correlacionado à linha ───
-- Policy original: (auth_role() = 'usuario') AND EXISTS (SELECT 1 FROM
-- lendings WHERE military_id = auth.uid() AND status_legacy = 'ativo') — o
-- EXISTS não referencia material_items.id nem tenant_id. Qualquer usuário
-- com QUALQUER cautela ativa lê a tabela material_items INTEIRA, de todos os
-- tenants (vazamento cross-tenant, o oposto do que este épico existe pra
-- fechar). Fix: correlaciona via lendings.item_id — usuário só vê o item
-- físico da SUA cautela ativa (comportamento pretendido original).
DROP POLICY IF EXISTS material_items_usuario_select ON public.material_items;
CREATE POLICY material_items_usuario_select ON public.material_items
  FOR SELECT
  USING (
    (auth_role() = 'usuario'::role_enum)
    AND EXISTS (
      SELECT 1 FROM public.lendings l
      WHERE l.item_id = material_items.id
        AND l.military_id = auth.uid()
        AND l.status_legacy = 'ativo'::lending_status_enum
    )
  );

-- ── 3. document_signatures: policy "service_role_insert_signatures" tinha  ──
-- roles=["public"], não service_role (nome mentia sobre o próprio efeito).
-- WITH CHECK true ⇒ qualquer authenticated/anon insere assinatura arbitrária
-- em document_signatures, quebrando a garantia de tamper-evidence (mesma
-- classe de risco endereçada em 20260714000008). Grep confirma: 100% dos
-- inserts em document_signatures são BFF via service_role (que bypassa RLS
-- de qualquer forma) — a policy não tem consumidor legítimo, só ampliava
-- superfície de ataque.
DROP POLICY IF EXISTS service_role_insert_signatures ON public.document_signatures;
