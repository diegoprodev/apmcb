# SSA — Lista de Pendências Remotas Sempre Vazia (RLS Obsoleta) — Enterprise Spec

## 1. Contexto e Motivação

Reporte crítico do usuário: solicitação remota (SSA) feita pela matrícula
000003 em 28/07/2026 gerou notificação para o armeiro (000002), o card
"Pendências Remotas" do painel principal mostra a contagem corretamente,
mas `/reserva/solicitacoes` (clicando no card OU na notificação) nunca
mostra nada — "nem antiga nem nova. absolutamente nada." Pedido adicional:
confirmar/garantir suporte a solicitação remota com mais de um material.

## 2. Estado Atual — Diagnóstico

### 2.1 Causa raiz confirmada: RLS obsoleta em `material_request_items`

A policy `ssa_items_staff_all` (criada em `20260615000001_ssa_schema.sql`)
nunca foi atualizada pelas migrations posteriores que corrigiram o mesmo
problema em outras tabelas (`20260625000002`, `20260629000001/3/4`,
`20260711000003`):

```sql
CREATE POLICY ssa_items_staff_all ON public.material_request_items
  FOR ALL
  USING (auth_role() IN ('admin'::role_enum, 'master'::role_enum));
```

`'admin'`/`'master'` são nomes de role **obsoletos** — o sistema atual usa
`admin_global`/`admin_reserva`/`armeiro`/`auditor`. Nenhum usuário real tem
mais essas roles antigas. Resultado: um armeiro nunca conseguia ler os
itens de uma solicitação de outra pessoa (a única outra policy,
`ssa_items_military_select`, só libera para `military_id = auth.uid()` —
nunca verdadeiro para o armeiro revisando a solicitação de um militar).

### 2.2 Por que isso travava a página inteira (não só escondia os itens)

Pra um armeiro, NENHUMA policy PERMISSIVE em `material_request_items`
nunca retornava true — `ssa_items_staff_all` (role obsoleta, nunca bate)
OU `ssa_items_military_select` (correlacionada em `military_id =
auth.uid()`, só verdadeira quando o próprio solicitante lê seus próprios
itens). O join embutido do PostgREST (`items:material_request_items(...)`
em `reserva/solicitacoes/page.tsx`) precisa avaliar essa combinação
sempre-falsa pra CADA linha candidata antes do `LIMIT` ser aplicado —
achado de code review: a policy antiga em si (`ssa_items_staff_all`) não
tinha subquery nenhuma, era um check de role plano; o custo vinha da
combinação com `ssa_items_military_select` (que tem EXISTS correlacionado)
sendo avaliada em cascata sem nunca satisfazer, sem conseguir aproveitar o
`LIMIT` externo pra cortar cedo. Confirmado ao vivo (script Node contra o
banco real, autenticado como o armeiro real):

| Query | Tempo | Resultado |
|---|---|---|
| `material_requests` sem joins | 445ms | OK |
| + join `military:profiles(...)` | 196ms | OK |
| + join `items:material_request_items(...)` | **8.164s** | **`57014 canceling statement due to statement timeout`** |

Com ~1000 linhas de `material_request_items` acumuladas de execuções de
teste (confirmado: 1089 `material_requests` / 997 `material_request_items`
no banco, quase todas do fixture `cadete@apmcb.dev`), a subquery
correlacionada da policy — que nunca passava, pra praticamente nenhuma
linha, já que o `auth_role()` do armeiro nunca batia com `admin`/`master`
— precisava ser avaliada exaustivamente, sem conseguir aproveitar o
`LIMIT` externo pra parar cedo.

### 2.3 Achado secundário: erro engolido silenciosamente

`reserva/solicitacoes/page.tsx` fazia `const { data } = await query`, sem
checar `error`. Um timeout (ou qualquer outra falha transitória de banco)
virava silenciosamente "nenhuma solicitação", indistinguível de "não há
nada pendente de verdade" — o usuário não tinha como saber que era uma
falha, não um estado vazio real.

### 2.4 Multi-item remoto — já funciona

Verificado ao vivo (API real, dois materiais distintos, quantidades
diferentes): `POST /api/ssa/requests` já aceita `items: [...]` com N
materiais desde a implementação original, e `SolicitarArmamentoSheet`
(frontend ativo em `/efetivo`) já permite selecionar múltiplos materiais
via `Map<string, SelectedItem>` antes de avançar pro TOTP. Não há bug
aqui — a capacidade pedida já existe. Adicionado teste E2E pra travar essa
garantia (não havia cobertura antes).

### 2.5 Parte 2 — o fix de RLS-role sozinho não resolveu (causa raiz real)

A migration `20260819010000` (roles obsoletos → roles atuais) foi
aplicada em produção e revalidada ao vivo — o timeout continuou
**idêntico** (8s+, erro 57014). A policy corrigida ainda usava `EXISTS
(SELECT 1 FROM material_requests r WHERE r.id = request_id AND
r.tenant_id = my_tenant_id())` — um EXISTS **correlacionado**, que o
Postgres precisa replanejar/reexecutar pra CADA linha de
`material_request_items`, mesmo com `r.id` sendo PK. Isolado com uma
query direta, sem join nenhum: `SELECT count(*) FROM
material_request_items` (RLS aplicado) também travava em ~8s — não era o
embed do PostgREST, era a avaliação da própria policy, linha a linha.

Causa raiz real: `material_request_items` já tem coluna `tenant_id`
própria (desde a fundação multi-tenant), nunca populada de forma
consistente no INSERT (631 de 1005 linhas com `tenant_id` NULL,
confirmado). Fix: (1) `apps/bff/src/routes/ssa.ts` populando `tenant_id`
nos 2 pontos de INSERT (fluxo remoto padrão + "Modo A" — saída presencial
por código de acesso); (2) migration `20260819020000` faz backfill,
adiciona índice em `tenant_id`, e reescreve a policy pra comparação
direta `tenant_id = my_tenant_id()` (sem subquery) — mesmo padrão já
comprovadamente rápido que `material_requests` (a tabela pai) já usa.

**Achado ALTO de code review, corrigido**: os dois pontos de INSERT
aceitavam `tenant_id: tenantId ?? null` sem guarda — o BFF usa a service
role key (ignora RLS inteiramente), então nada impedia gravar uma
solicitação órfã se `c.get("tenantId")` fosse `null` (possível no caminho
Bearer token do `authMiddleware`, que não tem o mesmo fallback pra
`profiles.default_tenant_id` que o caminho iron-session tem). Uma linha
órfã reintroduziria o mesmo bug crítico aos poucos, um request de cada
vez, sem nenhum sinal de erro. Adicionado `if (!tenantId) return
403` nos dois pontos, mesmo padrão já usado em `GET
/available-materials`.

**Achado MÉDIO de code review, não bloqueante**: a ordem de deploy
importa — se a migration for aplicada antes do código do BFF corrigido
ir pro ar, qualquer solicitação criada nessa janela nasce órfã de novo.
Aplicar o deploy do BFF (`apps/bff/src/routes/ssa.ts`) e a migration na
mesma janela, não em momentos separados.

## 3. Requisitos

- **RRQ-01**: corrigir `ssa_items_staff_all` para os roles atuais,
  seguindo o mesmo desenho de privilégio mínimo de `material_requests`
  (leitura: admin_global/admin_reserva/armeiro/auditor; escrita: sem
  auditor) — tenant-scoped via subquery em `material_requests`
  (`material_request_items.tenant_id` não é populado no INSERT hoje).
- **RRQ-02**: `reserva/solicitacoes/page.tsx` passa a checar `error` da
  query e mostra um banner visível em vez de silenciosamente "nenhuma
  solicitação" quando a busca falha.
- **RRQ-03**: E2E prova que um armeiro vê (na lista, não só no card) uma
  solicitação remota criada por outro usuário — cobertura que não existia
  e teria pego este bug antes de chegar em produção.
- **RRQ-04**: E2E prova que uma solicitação remota com 2+ materiais
  distintos é criada e persistida corretamente (documenta que a
  capacidade já existe, sem precisar de mudança de código).

## 4. Fora de Escopo

- Popular `material_request_items.tenant_id` no INSERT (não necessário
  pro fix — a policy usa subquery em `material_requests`, que já tem
  `tenant_id` correto).
- Auditoria completa de outras policies RLS por nomes de role obsoletos —
  busca dirigida (`grep`) não encontrou nenhuma outra policy órfã com
  `'admin'`/`'master'` que não tenha sido corrigida por uma migration
  posterior; esta era a única sobrevivente.
- Índices adicionais em `material_requests`/`material_request_items` — o
  fix de RLS já resolve o timeout (subquery correlacionada rápida via PK
  lookup); não há evidência de que falte índice depois do fix.

## 5. E2E Test IDs

- `SSAQ01` — armeiro vê, na lista de `/api/ssa/requests` (ou query
  equivalente), uma solicitação remota pendente feita por outro usuário do
  mesmo tenant (prova o fix de RLS/timeout).
- `SSAQ02` — solicitação remota com 2 materiais distintos é criada com
  201 e ambos os itens persistidos com as quantidades corretas.

## 6. Ordem de Execução

1. Migration `20260819010000_fix_ssa_items_staff_rls_obsolete_roles.sql`.
2. `reserva/solicitacoes/page.tsx` — checagem de erro + banner (RRQ-02).
3. E2E (SSAQ01/02) + validação ao vivo contra localhost.
4. Code review obrigatório (≥9.5) + CHANGELOG + commit + push.

## 7. Definition of Done

- [ ] Migration aplicada
- [ ] Timing revalidado ao vivo pós-aplicação (mesmo script: sem join /
      com join profiles / com join items) — a query com items precisa
      voltar a ser rápida, não só "não dar erro". Achado de code review:
      a suposição de performance não verificada foi a causa do bug
      original; não repetir o mesmo erro no próprio fix.
- [ ] `SSAQ01` passando contra o banco real pós-migration
- [ ] `tsc --noEmit` em `apps/bff` e `apps/web` — 0 erros
- [ ] Banner de erro visível testado (simular falha de query)
- [ ] E2E `SSAQ01`/`SSAQ02` criados e passando
- [ ] Code review sênior ≥9.5/10
