-- ═══════════════════════════════════════════════════════════════════
-- Achado real do usuário (2026-08-29): tela real de Cautelas (armeiro
-- matricula 000002, fixture reaproveitada por TODA a suíte E2E) mostrando
-- dezenas de linhas "E2E .../Teste ..." nunca assinadas, parecendo um bug
-- de assinatura ("como assim pendente do armeiro e minha? como eu assino?
-- houve regressão?"). Não é bug de assinatura — é dado de teste real
-- deixado em produção por specs sem cleanup (cautelamentos-batch.spec.ts,
-- cautelamentos.spec.ts, e o avu-alertas-vencimento.spec.ts desta mesma
-- sessão, todos rodando contra o banco de produção real, nenhum com
-- afterAll cancelando o que criou).
--
-- 134 cautelas "ativa" com motivo_emissao começando em "Teste "/"E2E"/"AVU"
-- — travando 16 ITENS REAIS de inventário (FUZIL ARAD, Espadim, Quepe de
-- Cerimônia, Cinto Branco, Luvas Brancas, Túnica de Gala) como
-- status_operacional='cautelado' sem nenhuma cautela real por trás,
-- reduzindo silenciosamente a contagem de "disponíveis para cautela" que
-- o usuário questionou antes nesta mesma sessão. Os outros 118 itens são
-- material_types sintéticos ("E2E CautelaBatch Eligible...", já isolados,
-- sem impacto em inventário real, mas mesmo assim poluíam a lista visível).
--
-- Cancela via UPDATE direto (não via POST /:id/cancel, que exigiria 134
-- chamadas HTTP autenticadas/rate-limited pra uma limpeza de dado que nunca
-- deveria ter sido criado como definitivo) — motivo_cancelamento deixa
-- rastro claro de que foi limpeza administrativa, não uma cautela real
-- cancelada por engano.
-- ═══════════════════════════════════════════════════════════════════

WITH canceladas AS (
  UPDATE public.cautelamentos
     SET status = 'cancelada',
         motivo_cancelamento = 'Limpeza administrativa: cautela criada por teste automatizado (E2E), nunca deveria ter permanecido em produção.',
         cancelada_em = now(),
         cancelada_por = NULL
   WHERE status = 'ativa'
     AND (motivo_emissao ILIKE 'Teste %' OR motivo_emissao ILIKE 'E2E%' OR motivo_emissao ILIKE 'AVU%')
  RETURNING id, item_id
)
UPDATE public.material_items mi
   SET status_operacional = 'disponivel',
       active_cautelamento_id = NULL
  FROM canceladas c
 WHERE mi.id = c.item_id
   AND mi.active_cautelamento_id = c.id;
