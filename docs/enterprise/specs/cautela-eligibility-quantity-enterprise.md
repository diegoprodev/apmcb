# Enterprise Spec — Elegibilidade e Quantidade Reservada para Cautela

> **Data:** 2026-08-18
> **Fase:** Cautela Permanente — Controle de Elegibilidade por Material
> **DoD Canônica:** `docs/enterprise/07-canonical-definition-of-done.md`
> **Princípios:** SRP, DRY, SSOT, KISS, YAGNI, FailFast, Privilege Ceiling

---

## 1. Contexto e Motivação

Pedido do dono do produto (verbatim): "quero opção de incluir checkbox
durante adição de material pelo admin da reserva para incluir ou não
(disponibilizar) esse material para cautela, bem como quantidade
específica."

Hoje, se um material pode ou não ser cautelado é um **acidente** de outra
decisão de cadastro (se ele rastreia número de série/validade), não uma
escolha deliberada do admin_reserva. Isso significa: (a) não há como um
admin dizer "este material NUNCA deve ser cautelado, só sai por
empréstimo diário"; e (b) não há como reservar uma fração do estoque
especificamente para cautela, deixando o restante disponível pro fluxo de
saída diária (`lendings`).

---

## 2. Estado Atual — Diagnóstico (achados de leitura de código, não hipóteses)

### 2.1 Como material_items são criados hoje

`apps/bff/src/routes/arsenal.ts`, função `makePhysicalItems()` (linha
~284): registros individuais em `material_items` (a tabela que
`cautelamentos.item_id` referencia) **só são criados** quando:

```ts
if (!metadata.has_serial_numbers && !metadata.requires_validity && metadata.items.length === 0) return [];
```

Ou seja: um material "bulk" (sem número de série, sem validade
individual — ex: um item genérico de fardamento) nunca ganha nenhuma
linha em `material_items`. Como `cautelamentos.ts` `POST /` (linha ~245)
exige um `item_id` real de `material_items`, **esses materiais já são
implicitamente impossíveis de cautelar hoje** — não por uma decisão
explícita, mas por um efeito colateral de não terem rastreio individual.

### 2.2 Como a criação de material chega até `material_types`

Todo cadastro de material — tanto pelo armeiro (`canRequest`) quanto pelo
**admin_reserva** (`canManageDirectly`) — passa pelo mesmo formulário
(`AddMaterialRequestForm`, `apps/web/src/components/arsenal/
material-detail-sheet.tsx`) e pelo mesmo endpoint,
`POST /api/arsenal/requests` (`apps/bff/src/routes/arsenal.ts` linha
~314), que sempre cria uma linha `pendente` em `admin_approval_requests`
— **mesmo para admin_reserva**, que precisa depois aprovar a própria
solicitação em `PATCH /requests/:id/approve`. Não há hoje um caminho de
criação verdadeiramente direto/síncrono. Isso é uma característica
pré-existente do sistema, fora do escopo desta spec, mas relevante:
qualquer campo novo desta feature precisa passar pelo `payload` JSON da
solicitação e ser aplicado no branch `material_addition` do approve
(linha ~618), não só no formulário do armeiro.

### 2.3 Como um item é selecionado para cautela hoje

`apps/web/src/app/(dashboard)/reserva/cautelas/_cautelas-client.tsx`
busca a lista de itens candidatos via `GET /api/arsenal/items/disponiveis`
(`arsenal.ts` linha ~911) — um autocomplete **plano**, sem nenhum filtro
por elegibilidade de material. O MESMO endpoint também alimenta o
autocomplete do modal "Registrar Ocorrência" (`material-detail-sheet.tsx`
manutenção) — **não pode ganhar um filtro fixo de cautela sem quebrar o
outro consumidor**; precisa de um parâmetro opcional.

### 2.4 Schema atual relevante

```sql
-- material_types (evoluído desde o schema inicial — colunas confirmadas via grep no código)
id, nome, categoria, categoria_slug, category_id, quantidade_total,
descricao, calibre, has_serial_numbers, requires_validity,
requires_vehicle_fields, validity_alert_days, ativo, tenant_id, reserve_id, ...

-- material_items (unidade física individual)
id, tenant_id, material_type_id, tipo_identificador, identificador_principal,
numero_serie, status_operacional ('disponivel'|'em_saida'|'cautelado'|
'manutencao'|'extraviado'|'baixado'|'inapto'), current_holder_user_id,
current_unit_id, validade_item, ...
```

Não existe nenhuma coluna hoje relacionando `material_types` a "pode ser
cautelado" ou "quantos podem ser cautelados" (confirmado via busca no
repositório inteiro — zero ocorrências de `cautela_habilitada`,
`quantidade_cautela` ou variantes).

---

## 3. Decisão de Design (assumida — validar com o dono do produto)

O pedido combina "checkbox" + "quantidade específica" num único campo,
mas o comportamento correto **depende do tipo de material**, porque
material_items já é criado de dois jeitos diferentes hoje:

| Cenário | Como material_items existe hoje | O que "quantidade para cautela" significa |
|---|---|---|
| **A — Material com rastreio individual** (`has_serial_numbers=true` ou `requires_validity=true`) | 1 linha de `material_items` por unidade informada em `items[]` no cadastro | Não precisa de um número separado — o checkbox marca **quais dessas unidades já cadastradas** ficam elegíveis (por padrão, todas, mas o admin pode desmarcar unidades específicas depois via edição do item) |
| **B — Material "bulk"** (sem série, sem validade — hoje sem nenhuma `material_items`) | Nenhuma linha existe | O checkbox passa a criar **N linhas sintéticas** de `material_items` (tipo_identificador='interno', mesmo padrão já usado em `makePhysicalItems` para o índice sem série), onde N = a quantidade informada, reservando essa fração do `quantidade_total` exclusivamente para cautela — o restante continua no pool de saída diária (`lendings`) |

Esta spec assume esse desenho (cenário B é o caso principal do pedido,
já que materiais com série/validade normalmente já são individualmente
sensíveis o bastante pra já fazer sentido serem cauteláveis por padrão).
**Pergunta aberta para o dono do produto**: confirmar se, no cenário A,
o padrão deveria ser "todas as unidades elegíveis automaticamente" ou
"nenhuma, até o admin marcar item por item" — esta spec assume a primeira
opção (menor fricção, alinhado ao princípio "defaults inteligentes" do
CLAUDE.md deste projeto).

---

## 4. Requisitos

### CAU-01 — Migration: novas colunas em `material_types`

```sql
ALTER TABLE public.material_types
  ADD COLUMN IF NOT EXISTS cautela_habilitada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quantidade_cautela integer NOT NULL DEFAULT 0
    CHECK (quantidade_cautela >= 0);

-- Nunca reservar mais unidades para cautela do que o total existe —
-- CHECK simples aqui; validação cross-column mais rica (quantidade_cautela
-- <= quantidade_total) fica na camada de aplicação (BFF), porque
-- quantidade_total pode mudar depois via stock_adjustment sem re-passar
-- por este INSERT, e um CHECK de coluna não pode referenciar outra coluna
-- de forma que sobreviva a um UPDATE parcial com segurança de leitura
-- consistente sem uma trigger — YAGNI por ora, revisar se abuso real
-- aparecer.
ALTER TABLE public.material_types
  ADD CONSTRAINT material_types_cautela_habilitada_requires_qty_chk
    CHECK (NOT cautela_habilitada OR quantidade_cautela > 0);
```

### CAU-02 — Validação de aplicação: `quantidade_cautela <= quantidade_total`

Em `apps/bff/src/lib/material-metadata.ts` (`validateMaterialMetadata`,
já é o ponto único de validação de payload de material — reaproveitar,
não duplicar): rejeitar com 400 se `cautela_habilitada=true` e
`quantidade_cautela > quantidade_total`. Mesma validação deve rodar de
novo no branch `material_addition` do approve (`arsenal.ts` linha ~618)
— o payload pode ter ficado obsoleto entre a solicitação e a aprovação
(ex: outro admin reduziu quantidade_total nesse meio tempo via
`stock_adjustment`), então confiar só na validação de criação seria
TOCTOU.

### CAU-03 — UI: checkbox + campo de quantidade no formulário de material

`apps/web/src/components/arsenal/material-detail-sheet.tsx`,
`AddMaterialRequestForm`:

- Novo checkbox: **"Disponibilizar para cautela"** (`data-testid="material-cautela-habilitada"`), com tooltip explicando a diferença entre cautela (custódia de longo prazo, requer assinatura dupla) e saída diária.
- Quando marcado E o material é do **Cenário B** (sem `has_serial_numbers`, sem `requires_validity`): mostra input numérico **"Quantidade reservada para cautela"** (`data-testid="material-cautela-quantidade"`), com validação client-side `1 ≤ valor ≤ quantidade_total` antes de habilitar o botão de submit (mesmo padrão de validação inline já usado no resto do formulário).
- Quando marcado E o material é do **Cenário A** (rastreio individual): sem campo de quantidade — texto informativo: "Todas as N unidades cadastradas ficarão disponíveis para cautela."
- Estado inicial: desmarcado (materiais continuam só-saída-diária por padrão — não muda o comportamento de nenhum material já cadastrado).

### CAU-04 — BFF: aceitar os novos campos no payload de `POST /api/arsenal/requests`

`apps/bff/src/routes/arsenal.ts`, dentro do branch `else` (material
addition, linha ~366): adicionar `cautela_habilitada`/`quantidade_cautela`
ao objeto `items[]` e ao `NormalizedMaterialMetadata` retornado por
`validateMaterialMetadata` (`material-metadata.ts`) — mesmo objeto
percorre create → payload → approve, então adicionar aqui uma vez cobre
os dois pontos de uso.

### CAU-05 — BFF: aplicar no approve (`material_addition`)

No branch `material_addition` de `PATCH /requests/:id/approve`
(`arsenal.ts` linha ~618):

1. Incluir `cautela_habilitada`/`quantidade_cautela` no `rows.push(...)`
   que insere em `material_types` (linha ~647).
2. Estender `makePhysicalItems()` (linha ~284): a condição de early-return
   passa a ser `if (!has_serial_numbers && !requires_validity && items.length === 0 && !cautela_habilitada) return [];` — quando `cautela_habilitada=true` e nenhum dos outros gatilhos se aplica (Cenário B), gerar `quantidade_cautela` linhas sintéticas com o mesmo padrão de `identificador_principal` já usado pro índice sem série (`${categoria_slug}-${materialTypeId}-${index+1}`), tipo_identificador='interno'.
3. Cenário A não precisa de mudança em `makePhysicalItems` — as unidades já seriam criadas; só o flag `cautela_habilitada` em `material_types` muda o que `cautelamentos.ts` aceita (ver CAU-06).

### CAU-06 — BFF: `cautelamentos.ts` `POST /` só aceita item de material elegível

`apps/bff/src/routes/cautelamentos.ts`, linha ~245 (SELECT do item):
estender o `select` para trazer `material_type:material_types(cautela_habilitada)`
e, após o check de `status_operacional !== 'disponivel'` (linha ~253),
adicionar:

```ts
const materialType = Array.isArray(item.material_type) ? item.material_type[0] : item.material_type;
if (!materialType?.cautela_habilitada) {
  return c.json({ error: "Este material não está habilitado para cautela." }, 409);
}
```

Isso é a fronteira de segurança real desta feature — sem isto, o checkbox
seria só decoração de UI (o backend continuaria aceitando qualquer
`item_id` disponível). Mesmo raciocínio de "nunca confiar só no frontend"
já aplicado em toda fronteira de permissão deste repositório.

### CAU-07 — BFF: `GET /api/arsenal/items/disponiveis` ganha filtro opcional

`arsenal.ts` linha ~911: novo query param `?for=cautela`. Quando
presente, adiciona `.eq("material_types.cautela_habilitada", true)` via
join (mesmo padrão `!inner` já usado em outras rotas deste arquivo pra
filtrar por coluna de tabela relacionada). Sem o parâmetro, comportamento
atual preservado — o modal de "Registrar Ocorrência" continua vendo
todos os itens disponíveis, não só os cauteláveis.

`_cautelas-client.tsx` passa a chamar
`GET /api/arsenal/items/disponiveis?for=cautela` (troca de uma linha) —
o autocomplete de seleção de item na criação de cautela só mostra itens
de materiais habilitados, eliminando a fricção de escolher um item e só
descobrir o bloqueio depois do submit (mesmo princípio de UX já aplicado
ao hover-alert de desativação de categoria nesta mesma sessão).

### CAU-08 — Painel de edição: permitir alternar `cautela_habilitada` depois do cadastro

Materiais já cadastrados precisam poder ganhar/perder elegibilidade sem
recriar o material do zero. `_category-manager.tsx`/tela de edição de
material do admin_reserva (`canManageDirectly`) — adicionar o mesmo
checkbox+quantidade ao formulário de edição direta
(`PATCH /api/arsenal/:id` — **rota que hoje não existe ainda para edição
direta de material_type, só delete; confirmar se deve ser criada nesta
mesma spec ou é additive/out-of-scope** — ver seção 6, pergunta aberta).

Regra de segurança ao **desabilitar** (`cautela_habilitada: true → false`):
bloquear com 409 se existirem `material_items` desse tipo com
`status_operacional='cautelado'` (mesmo padrão 409-com-contagem já usado
em `DELETE /api/categories/:id` e `DELETE /api/arsenal/:id`) — não dá pra
"desabilitar" um material que já está em custódia de longo prazo com
alguém sem primeiro resolver essas cautelas.

---

## 5. E2E Tests — IDs propostos

### 5.1 Cadastro com elegibilidade

- `CAUELIG01` — checkbox desmarcado por padrão ao abrir o form de novo material.
- `CAUELIG02` — marcar checkbox em material sem série/validade exibe campo de quantidade.
- `CAUELIG03` — marcar checkbox em material com série/validade NÃO exibe campo de quantidade (mostra texto informativo).
- `CAUELIG04` — quantidade > quantidade_total bloqueia submit com mensagem clara.
- `CAUELIG05` — após aprovação da solicitação, `material_types.cautela_habilitada`/`quantidade_cautela` persistidos corretamente.
- `CAUELIG06` — após aprovação, exatamente N `material_items` sintéticos criados para material Cenário B.

### 5.2 Enforcement na cautela

- `CAUELIG07` — autocomplete de item em `/reserva/cautelas` só mostra itens de materiais habilitados (com `?for=cautela`).
- `CAUELIG08` — `POST /api/cautelamentos` com `item_id` de material NÃO habilitado retorna 409, mesmo manipulando o payload diretamente (bypass da UI).
- `CAUELIG09` — modal "Registrar Ocorrência" continua mostrando itens de materiais NÃO habilitados para cautela (não regride CAU-07).

### 5.3 Edição/desabilitação

- `CAUELIG10` — desabilitar `cautela_habilitada` com cautelas ativas existentes → 409 com contagem.
- `CAUELIG11` — desabilitar sem cautelas ativas → sucesso.

---

## 6. Perguntas Abertas (decisão do dono do produto antes de implementar)

1. **Cenário A, default de elegibilidade**: todas as unidades já cadastradas ficam automaticamente elegíveis quando o checkbox é marcado, ou o admin precisa marcar item a item? (Esta spec assume "todas".)
2. **Edição de material existente**: hoje não existe `PATCH /api/arsenal/:id` para edição direta de um `material_type` já ativo (só `DELETE`, soft-delete). Esta feature deveria vir junto com a criação desse endpoint de edição (CAU-08 completo), ou fica restrita a "só na criação" nesta primeira entrega, com edição posterior sendo um follow-up?
3. **Materiais já cadastrados hoje** (antes desta feature existir): ficam todos com `cautela_habilitada=false` por padrão (nenhuma cautela nova neles até alguém habilitar explicitamente) — isso é aceitável, ou é necessário um script de backfill que habilite automaticamente materiais que JÁ têm cautelas ativas hoje (senão essas cautelas ficam "órfãs" de uma regra que não existia quando foram criadas)? Recomendação desta spec: backfill automático para materiais com cautela ativa existente, setando `quantidade_cautela` = contagem atual de `material_items` cauteladas desse tipo — evita quebrar custódias já em andamento.

---

## 7. Ordem de Execução

1. Migration SQL (CAU-01) + backfill (pergunta 3, se aprovado)
2. BFF: `material-metadata.ts` — novos campos + validação (CAU-02, CAU-04)
3. BFF: `makePhysicalItems` + branch `material_addition` do approve (CAU-05)
4. BFF: enforcement em `cautelamentos.ts` `POST /` (CAU-06) — **fronteira de segurança, não pode esperar o frontend**
5. BFF: `GET /items/disponiveis?for=cautela` (CAU-07)
6. Frontend: checkbox + quantidade no formulário de material (CAU-03)
7. Frontend: `_cautelas-client.tsx` usa `?for=cautela` (CAU-07)
8. (Se aprovado na pergunta 2) BFF+Frontend: edição de material existente (CAU-08)
9. E2E: suite completa (CAUELIG01..11)
10. Code review obrigatório (≥9.5) + CHANGELOG + deploy

---

## 8. Definition of Done

- [ ] Migration aplicada e validada
- [ ] `tsc --noEmit` em `apps/bff` e `apps/web` — 0 erros
- [ ] Checkbox + quantidade funcionais no cadastro, com as 2 variações (Cenário A/B)
- [ ] `POST /api/cautelamentos` rejeita item de material não-habilitado mesmo via payload direto (CAUELIG08)
- [ ] Autocomplete de cautela filtra corretamente; modal de ocorrência não regride
- [ ] Desabilitar com cautelas ativas bloqueado com 409+contagem
- [ ] E2E suite `CAUELIG01..11` criada e passando
- [ ] Code review sênior ≥9.5/10
- [ ] CHANGELOG atualizado
