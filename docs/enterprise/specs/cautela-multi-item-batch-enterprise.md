# Cautela com Múltiplos Materiais (movement_id) — Enterprise Spec

## 1. Contexto e Motivação

Pedido do usuário: "tb nessa página modal deve ter opção de incluir mais
de uma material igual na saída. assim produzir uma cautela com mais de
um material se possível ok." — o modal "Nova Cautela" (`/reserva/cautelas`)
só permitia cautelar 1 item físico por operação, ao contrário de "Nova
Saída" (`/reserva/saidas/nova`), que já suporta múltiplos materiais numa
única submissão via `movement_id`.

Diagnóstico confirmou: `cautelamentos.item_id` é 1:1 estrito com
`material_items` (um item físico por linha, sem conceito de quantidade —
diferente de `lendings`, que referencia `material_type_id`+quantidade). Não
existia coluna de agrupamento nem tabela de junção. O único mecanismo de
"mudança" pré-existente (`POST /:id/substitute`) troca um item por outro
dentro da mesma custódia lógica — não agrupa N itens simultâneos.

Princípio canônico aplicado a toda a implementação (regra explícita do
usuário): "toda validação de dado sempre deve ser validada pelo servidor e
nunca pelo frontend... nunca devemos confiar no front." Toda elegibilidade,
disponibilidade, validade e escopo de tenant é revalidada dentro das RPCs
transacionais, independente do que o frontend enviar.

## 2. Achado colateral pré-requisito (CMB-00)

Durante a investigação, achado um bug de identidade pré-existente e não
relacionado ao pedido original: `POST /:id/sign-militar` validava
TOTP/biometria contra `c.get("userId")` (quem está logado) em vez de
`cautela.militar_id` (dono da cautela) — quando o armeiro abre
`/reserva/cautelas` e clica "Assinar Usuário" pra **facilitar** a
assinatura de um militar que pode nem estar logado, a chamada sempre
recebia 403 antes de validar qualquer código. Essa função nunca
funcionou. Corrigido via `resolveSigningIdentity()` (allow-list explícita
de roles staff) antes de qualquer trabalho na feature em si — a
assinatura em lote depende de identidade resolvida corretamente.

## 3. Padrão de referência (replicado, não reinventado)

`lendings` + `movement_id`: uma ação do armeiro gera N linhas
independentes compartilhando um `movement_id`, cada uma devolvível/
rastreável sozinha. `POST /api/lendings/batch` delega tudo pra RPC
`record_lending_batch` (transacional, idempotente por `movement_id`,
`FOR UPDATE` por item, insert em lote). Replicado aqui com a
granularidade certa: por item físico (`material_items.id`), não por
tipo+quantidade — cada cautela é sempre exatamente 1 item.

## 4. Decisões de Design

| Ponto | Decisão |
|---|---|
| Endpoint de criação | `POST /api/cautelamentos` (singular) mantido com contrato inalterado — compat retroativa, mensagens de erro pt-BR preservadas (teste `cautela-eligibility.spec.ts` depende de texto literal). Novo `POST /api/cautelamentos/batch` para N itens, delega pra RPC. |
| RPC de criação | `record_cautelamento_batch` — idempotente por `movement_id` (`pg_advisory_xact_lock` serializa concorrência real antes do check de idempotência), `FOR UPDATE` por `material_items.id` em ordem determinística (evita deadlock 40P01 entre lotes concorrentes com itens em ordem inversa), valida `status_operacional`/`cautela_habilitada` (CAU-06)/validade (fuso America/Sao_Paulo), rejeita item duplicado, insert+update atômicos via CTE. |
| Assinatura em lote | 1 verificação de TOTP/biometria (sempre em TypeScript — `checkTotpGuard`/otplib não tem equivalente em PL/pgSQL) cobre N cautelas do mesmo `movement_id`, mas grava N `document_signatures` independentes. RPC `sign_cautelamento_batch` não é tudo-ou-nada — cada linha é resolvida independentemente (skip se já assinada/não-ativa), preservando rastreabilidade individual. |
| Erros do lote | Códigos crus da RPC (`CAUTELA_ITEM_NOT_ELIGIBLE` etc.) traduzidos pra pt-BR no BFF (`CAUTELA_BATCH_ERROR_MESSAGES`) antes de chegar ao frontend — nunca expor código técnico cru em toast. |
| Modal "Nova Cautela" | Migrado de `Autocomplete` local pro `ComboBox` compartilhado; lista dinâmica de linhas (mesmo padrão de `reserva/saidas/nova/_form.tsx`), sem stepper de quantidade (cada linha é 1 item físico). Condição do item aplicada a todos os itens do lote (simplificação de UX — backend valida por item independentemente). |
| Grid | Badge "Lote de N" (contando só cautelas com `status='ativa'` do mesmo `movement_id` — não toda linha visível no filtro atual, pra não superestimar o que a assinatura em lote realmente cobre). Clique em "Assinar" numa linha de um lote abre o `SignDialog` em modo lote (cobre todas as ativas do grupo). |

## 5. Schema (migrations aplicadas)

- `20260821000000_cautelamentos_batch_movement_id.sql` — `ALTER TABLE
  cautelamentos ADD COLUMN movement_id uuid` + índice único
  `(movement_id, item_id) WHERE movement_id IS NOT NULL` + índice simples.
  Aditivo, sem backfill — cautelas antigas (`movement_id IS NULL`)
  continuam válidas, cada uma seu próprio "lote de 1".
- `20260821000001_cautelamentos_batch_rpc.sql` — `record_cautelamento_batch`.
- `20260821000002_cautelamentos_batch_sign_rpc.sql` — `sign_cautelamento_batch`.

## 6. Requisitos (CMB)

- **CMB-00**: fix de identidade em `sign-militar` (pré-requisito, ver §2).
- **CMB-01**: `POST /api/cautelamentos/batch` cria N cautelas atomicamente
  com o mesmo `movement_id`.
- **CMB-02**: item duplicado no mesmo lote é rejeitado, nada persistido.
- **CMB-03**: item não elegível (CAU-06) dentro do lote derruba o lote
  inteiro (atomicidade real via transação + locks, não best-effort).
- **CMB-04**: lote de 1 item continua funcionando via `/batch` (regressão
  de granularidade) — `POST /` singular também continua funcionando sem
  nenhuma mudança de contrato.
- **CMB-05**: devolver/substituir 1 cautela do lote não afeta as outras.
- **CMB-06/07**: assinatura em lote (armeiro e facilitação da assinatura
  do militar) cria N `document_signatures` independentes.
- **CMB-08/09**: replay do mesmo `movement_id` é idempotente se os itens
  batem; rejeitado se divergem.
- **CMB-10**: duas assinaturas concorrentes com o mesmo código TOTP — só
  uma vence (prova de atomicidade real, não sequencial).
- **CMB-11**: `SHIFT_REQUIRED` nos 3 endpoints novos de lote, mesmo gate
  do fluxo singular.

## 7. Processo — achados de revisão incorporados

Este trabalho passou por: 2 agentes Explore (padrões existentes), 1 agente
Plan (desenho), 1 revisão adversarial do plano (achou 1 CRÍTICO de
compat de mensagens de erro + 4 ALTO de atomicidade/identidade,
incorporados antes de implementar), e 3 rodadas de code review sênior
durante a implementação (BFF/RPCs, frontend, e uma revisão de
concorrência dedicada ao fix de TOTP) — que encontraram e corrigiram:

- **CRÍTICO real**: a suíte de testes mutava permanentemente
  `material_types.cautela_habilitada` de tipos REAIS e pré-existentes do
  banco compartilhado (ambiente "local" usa o mesmo Supabase de
  produção) — corrigido pra sempre criar material sintético via o fluxo
  real de aprovação (`POST /api/arsenal/requests` + approve), nunca mais
  `UPDATE` em linhas pré-existentes.
- **ALTO**: ordem de lock não determinística (risco de deadlock 40P01)
  na RPC de criação; race de idempotência sob concorrência real (não só
  replay sequencial) resolvida com `pg_advisory_xact_lock`; códigos de
  erro crus vazando pro toast do usuário; contagem do badge "Lote de N"
  podia superestimar cobertura da assinatura em lote; zero cobertura E2E
  de UI real pro modal (só testes de API).
- **MÉDIO/BAIXO**: early-exit antes de gastar TOTP num lote já resolvido;
  atomicidade do consumo de TOTP em si (`validateTotp` — achado que
  motivou hardening independente da feature, aplicado a todos os fluxos
  de assinatura de cautela); testId único por linha do formulário; reset
  de estado do `SignDialog` entre aberturas.

## 8. Testes

- `apps/web/e2e/cautelamentos-batch.spec.ts` (novo, API-level): CMB01-CMB11.
- `apps/web/e2e/cautelamentos.spec.ts` (CT01-CT08 + CT05b/c/d): fix de
  identidade CMB-00, migrado pra material sintético.
- `apps/web/e2e/cautelas-ui.spec.ts` (CAUUI05, novo): fluxo de UI real via
  Playwright — 2 linhas, exclusão cruzada, submit em lote, badge.
- `apps/web/e2e/livro-digital.spec.ts` (LDS21/22): ajustados pra
  interceptar `/batch` (não mais a rota singular) e digitar antes de
  buscar no `ComboBox` (contrato diferente do `Autocomplete` removido).

## 9. Definition of Done

- [x] CMB-00 corrigido e testado (CT05b/c/d).
- [x] Migrations aplicadas manualmente no Supabase Dashboard (Fases 1-3).
- [x] RPCs transacionais, revisadas e corrigidas (lock ordering,
      advisory lock, cast `inet`, alias pra evitar ambiguidade de nome
      de coluna com parâmetro de saída).
- [x] Endpoints BFF (`/batch`, `/batch/:id/sign-armeiro`,
      `/batch/:id/sign-militar`) com tradução de erro pt-BR.
- [x] Modal "Nova Cautela" com lista dinâmica de itens.
- [x] Testes E2E (API + UI real) — todos passando contra o banco real
      via localhost.
- [x] Code review sênior (múltiplas rodadas, achados incorporados).
- [ ] Deploy do BFF (Hetzner) + frontend (Cloudflare Pages) e validação
      final ao vivo contra produção — pendente, aguardando decisão do
      usuário sobre o momento do deploy.
