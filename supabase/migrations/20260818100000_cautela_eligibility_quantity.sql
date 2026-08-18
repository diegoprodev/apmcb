-- Elegibilidade e quantidade reservada para cautela — controle deliberado
-- por material, em vez de um acidente de outra decisão de cadastro.
-- Ver docs/enterprise/specs/cautela-eligibility-quantity-enterprise.md.
--
-- Contexto (achado real, seção 2.1 da spec): hoje, se um material_type PODE
-- ou não ser cautelado é um efeito colateral de ele rastrear ou não número
-- de série/validade (has_serial_numbers/requires_validity) — materiais
-- "bulk" nunca ganham nenhuma linha em material_items e por isso já são
-- implicitamente impossíveis de cautelar, sem que nenhum admin tenha
-- decidido isso deliberadamente. Esta migration adiciona um controle
-- explícito: cautela_habilitada (o admin decide se este material pode ser
-- cautelado) + quantidade_cautela (quantas unidades ficam reservadas
-- exclusivamente para o fluxo de cautela, deixando o restante do
-- quantidade_total disponível só para o fluxo de saída diária/lendings).
--
-- CAU-01
ALTER TABLE public.material_types
  ADD COLUMN IF NOT EXISTS cautela_habilitada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quantidade_cautela integer NOT NULL DEFAULT 0
    CHECK (quantidade_cautela >= 0);

-- Nunca reservar mais unidades para cautela do que quantidade_total existe —
-- CHECK simples aqui; a validação cross-column mais rica
-- (quantidade_cautela <= quantidade_total) fica na camada de aplicação
-- (apps/bff/src/lib/material-metadata.ts, validateMaterialMetadata), porque
-- quantidade_total pode mudar depois via stock_adjustment sem re-passar por
-- este INSERT, e um CHECK de coluna não pode referenciar outra coluna de
-- forma que sobreviva a um UPDATE parcial com segurança de leitura
-- consistente sem uma trigger — YAGNI por ora, revisar se abuso real
-- aparecer (ver comentário completo na spec, seção CAU-01).
ALTER TABLE public.material_types
  ADD CONSTRAINT material_types_cautela_habilitada_requires_qty_chk
    CHECK (NOT cautela_habilitada OR quantidade_cautela > 0);

-- Backfill (decisão de produto — pergunta aberta 3 da spec, resolvida como
-- "sim, backfill automático"): para todo material_type que HOJE já tem
-- material_items com status_operacional='cautelado', habilita
-- cautela_habilitada e grava quantidade_cautela = contagem atual de itens
-- cautelados desse tipo. Sem isso, o enforcement novo em
-- apps/bff/src/routes/cautelamentos.ts POST / (CAU-06) passaria a rejeitar
-- SUBSTITUIÇÃO/histórico de custódias que já estavam em andamento antes
-- desta feature existir — essas cautelas não são "órfãs" de uma regra que
-- não existia quando foram criadas, mas o material continuaria sem
-- elegibilidade explícita se não fizermos isso agora.
--
-- CTE agrega por material_type_id: COUNT(*) nunca é zero aqui (o JOIN só
-- traz material_types que têm ao menos 1 item cautelado), então o UPDATE
-- sempre grava quantidade_cautela > 0 junto com cautela_habilitada = true
-- na MESMA instrução — não pode violar o CHECK acima adicionado logo antes.
--
-- Achado de code review: `WHERE mt.cautela_habilitada = false` abaixo
-- torna este backfill idempotente por conteúdo, não só por não-erro — sem
-- essa cláusula, reaplicar esta migration (ex: reset manual de ambiente)
-- recalcularia quantidade_cautela pela contagem ATUAL de cauteladas,
-- sobrescrevendo silenciosamente um valor que um admin já possa ter
-- ajustado deliberadamente depois do backfill original.
WITH cautela_counts AS (
  SELECT material_type_id, COUNT(*) AS qty
  FROM public.material_items
  WHERE status_operacional = 'cautelado'
  GROUP BY material_type_id
)
UPDATE public.material_types mt
SET cautela_habilitada = true,
    quantidade_cautela = cautela_counts.qty
FROM cautela_counts
WHERE mt.id = cautela_counts.material_type_id
  AND mt.cautela_habilitada = false;
