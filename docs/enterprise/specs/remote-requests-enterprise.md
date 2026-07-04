# Enterprise Spec — Solicitação Remota v2

> **Data:** 2026-07-04  
> **Fase:** Remote Requests Enterprise Overhaul  
> **DoD Canônica:** `docs/enterprise/07-canonical-definition-of-done.md`  
> **Princípios:** SRP, DRY, SSOT, KISS, YAGNI, FailFast, Privilege Ceiling

---

## 1. Contexto e Motivação

A Solicitação Remota (SSA) permite que efetivos (militares) solicitem armamento de reservas fora de sua unidade orgânica. A implementação atual tem falhas críticas de segurança (vazamento cross-tenant), UX ruim (lista plana de reservas), campos faltantes (motivo obrigatório), e features meio-implementadas (allow_remote_requests sem migration SQL).

---

## 2. Estado Atual — Diagnóstico

### 2.1 Fluxo atual (efetivo)

```
OPEN SHEET
  → Step 1 "reserve": lista plana de todas as reservas ativas do tenant
  → Step 2 "materials": lista de materiais agrupados por categoria (sem busca)
  → Step 3 "totp": código TOTP + campo "Observação" OPCIONAL
  → Step 4 "success": ID da solicitação
```

### 2.2 Bugs Críticos (must fix antes de qualquer feature)

| ID | Severidade | Descrição | Arquivo |
|----|-----------|-----------|---------|
| BUG-RR-01 | **CRÍTICO** | Migration SQL de `reserves.allow_remote_requests` nunca aplicada → coluna não existe → queries falham silenciosamente | `apps/bff/src/routes/reserves.ts:102` |
| BUG-RR-02 | **CRÍTICO** | `notifyAllArmeios()` sem filtro `tenant_id` → notificações vazam para armeios de outros tenants | `apps/bff/src/routes/ssa.ts:51-62` |
| BUG-RR-03 | **CRÍTICO** | RLS `ssa_military_select` sem filtro `tenant_id` → armeiro de Tenant A vê requisições de Tenant B | migration `20260629000003` |
| BUG-RR-04 | **ALTO** | `reserve_id` nunca salvo em `material_requests` ao criar (só verificado, nunca persistido) | `apps/bff/src/routes/ssa.ts:281-289` |
| BUG-RR-05 | **ALTO** | Push notification deep link `/efetivo/solicitacoes` para armeios (deve ser `/reserva/solicitacoes`) | `apps/bff/src/routes/ssa.ts:39` |
| BUG-RR-06 | **MÉDIO** | `GET /api/ssa/available-materials` não filtra por `allow_remote_requests` → externos veem materiais de reservas fechadas | `apps/bff/src/routes/ssa.ts:64-101` |
| BUG-RR-07 | **MÉDIO** | `/reserva/solicitacoes/page.tsx` query sem `tenant_id` → armeiro vê pedidos de outros tenants | `apps/web/src/app/(dashboard)/reserva/solicitacoes/page.tsx` |
| BUG-RR-08 | **MÉDIO** | Contagem de pendências no home do armeiro sem `tenant_id` | `apps/web/src/app/(dashboard)/reserva/page.tsx` |
| BUG-RR-09 | **BAIXO** | Sem limite superior na quantidade de material (stepper livre → usuário pede 1000 unidades) | `solicitar-armamento-sheet.tsx` |

---

## 3. Requisitos — 8 Pontos do Usuário

### RR-01 — Dropdown com autocomplete para seleção de reserva

**Status atual:** Lista plana vertical com cards grandes.  
**Requerido:**
- Substituir a lista por um `<select>` estilizado ou Combobox (Radix `Popover + Command`) com search interno
- Mostrar `nome` e `acronym` no dropdown
- Filtrar pelo texto digitado (case-insensitive, sobre `nome` e `acronym`)
- Ordenar alfabeticamente por `nome`
- Se apenas 1 reserva disponível → auto-selecionar e pular para materials (comportamento atual OK, manter)
- Se 0 reservas disponíveis → mostrar estado vazio com mensagem "Nenhuma reserva disponível para solicitação remota"

**Testids:**
- `ssa-reserve-combobox` — o trigger do dropdown
- `ssa-reserve-search` — o input de busca interno
- `ssa-reserve-option-{id}` — cada opção da lista

---

### RR-02 — Filtrar reservas por `allow_remote_requests`

**Status atual:** Retorna TODAS as reservas ativas do tenant, incluindo as que não aceitam remota.  
**Requerido:**
- `GET /api/reserves/mine` deve incluir `allow_remote_requests` na resposta
- Frontend filtra: só exibe reservas onde `allow_remote_requests = true` OU onde o usuário é membro da reserva (`reserve_memberships`)
- Lógica: se user é membro da reserva → sempre pode solicitar (independente da flag)
- Se user NÃO é membro → só pode solicitar se `allow_remote_requests = true`

---

### RR-03 — Painel admin: toggle para permitir requisições remotas por reserva

**Status atual:** UI e BFF implementados, mas **migration SQL faltante** (BUG-RR-01).  
**Requerido:**
- Aplicar migration que adiciona `allow_remote_requests BOOLEAN NOT NULL DEFAULT false` à tabela `reserves`
- O toggle `ReserveRemoteAccessToggle` deve funcionar corretamente após a migration
- Deve ser visível para `admin_reserva` e `admin_global` na página `/reserva`
- RLS: `PATCH /api/reserves/:id/settings` só afeta reservas do próprio tenant

---

### RR-04 — Controle por categoria: quais categorias estão disponíveis para remota

**Status atual:** Não existe. Toda categoria disponível é visível para externos.  
**Requerido:**
- Nova tabela: `reserve_remote_categories` (ou coluna `remote_allowed_categories TEXT[]` em `reserves`)
- Ao criar/editar uma reserva, admin pode marcar quais categorias (arma, farda, acessório, equipamento) estão disponíveis para solicitação remota
- Comportamento padrão: se nenhuma categoria marcada → nenhuma disponível para externos
- `GET /api/ssa/available-materials` deve filtrar por categoria permitida para usuários externos
- UI: checkboxes por categoria no painel de configuração da reserva

**Schema proposto:**
```sql
-- Na tabela reserves, coluna JSONB:
ALTER TABLE reserves ADD COLUMN remote_allowed_categories TEXT[] DEFAULT '{}';
-- Exemplo: '{arma,farda}' significa que armas e fardas estão disponíveis para remota
```

---

### RR-05 — Campo "Motivo" obrigatório para usuários externos

**Status atual:** Campo "Observação" opcional no step TOTP.  
**Requerido:**
- Novo step ou campo antes do step TOTP: "Motivo da Solicitação Remota"
- **Obrigatório** apenas quando o usuário NÃO pertence à reserva selecionada
- **Opcional** quando o usuário É membro da reserva
- Mínimo: 10 caracteres. Máximo: 500 caracteres
- Sugestões de preenchimento (placeholder/label helper):
  - "Serviço na unidade solicitada"
  - "Serviço extra / escala"  
  - "Treinamento externo"
  - "Determinação superior"
- Renomear o campo no BFF: `notes` → aceitar mas também `motivo` (ou adicionar campo separado `remote_reason`)
- Schema: adicionar `remote_reason TEXT NULL` em `material_requests` (distinto de `notes`)
- Validação BFF: se `reserve_id` informado E usuário não é membro da reserva → `remote_reason` é obrigatório (min 10 chars)

---

### RR-06 — Seleção de material com autocomplete (similar ao armeiro)

**Status atual:** Lista agrupada por categoria sem busca.  
**Requerido:**
- Adicionar `<input placeholder="Buscar material..." />` no topo do step de materiais
- Filtro client-side sobre `nome` (case-insensitive, debounce 200ms)
- Quando o filtro está ativo: mostrar apenas materiais que batem, remover headers de categoria que ficam vazios
- Manter o toggle de seleção e o stepper de quantidade (comportamento atual OK)
- Material bloqueado (indisponível) deve continuar aparecendo na lista mas não ser filtrável para seleção
- `data-testid="ssa-material-search"` no input

---

### RR-07 — Armeiro: notificações + fluxo de aprovação

**Status atual:** Notificações implementadas mas com vazamento cross-tenant (BUG-RR-02).  
**Requerido:**

**Notificações:**
- Corrigir `notifyAllArmeios()` adicionando filtro `tenant_id` E filtro por `reserve_id` (só notificar armeios DA reserva solicitada)
- Corrigir deep link push: `/reserva/solicitacoes` (não `/efetivo/solicitacoes`)
- Badge no sino da navbar do armeiro: conta de requisições pendentes em tempo real (polling 30s)

**Card "Solicitações Remotas" no `/reserva`:**
- Já existe — verificar se o count está correto com filtro tenant (BUG-RR-08)
- Link direto para `/reserva/solicitacoes?tab=pendentes`

**Página `/reserva/solicitacoes`:**
- Corrigir query SSR para incluir `tenant_id` filter (BUG-RR-07)
- Adicionar coluna "Reserva" na listagem (agora que `reserve_id` será salvo — BUG-RR-04)
- Mostrar o campo `remote_reason` (motivo informado pelo efetivo) na expansão do card
- Mostrar se o solicitante é membro da reserva ou externo (badge "Membro" / "Externo")

**Ações do armeiro:**
- Aprovar (com nota opcional `armeiro_nota`) → status `aprovado`, TTL 6h
- Rejeitar (com motivo obrigatório ≥ 10 chars) → status `rejeitado`
- Cancelar (mesmo se aprovado, com motivo obrigatório) → status `cancelado`
- Confirmar retirada → status `retirado`, cria `lendings`

---

### RR-08 — Efetivo: cancelamento com motivo

**Status atual:** Não existe cancelamento pelo efetivo.  
**Requerido:**
- No card "Solicitação Remota" em `/efetivo`: botão "Cancelar" visível para solicitações com status `pendente` ou `aprovado`
- Ao clicar: dialog de confirmação com campo "Motivo do cancelamento" (obrigatório, min 10 chars)
- `PATCH /api/ssa/requests/:id/cancel` (nuevo endpoint no BFF) — só o próprio `military_id` pode cancelar
- BFF: valida que `cancellation_reason` ≥ 10 chars, atualiza status para `cancelado`, notifica armeiro
- Armeiro recebe notificação: "Solicitação #ID cancelada pelo solicitante: [motivo]"
- Sincronização: a página do armeiro (`/reserva/solicitacoes`) atualiza via polling ou websocket

---

## 4. Schema — Migrations SQL Necessárias

### Migration A — `allow_remote_requests` (corrige BUG-RR-01)
```sql
-- 20260704000001_reserves_allow_remote_requests.sql
ALTER TABLE reserves
  ADD COLUMN IF NOT EXISTS allow_remote_requests BOOLEAN NOT NULL DEFAULT false;

-- Índice para filtros de busca eficientes
CREATE INDEX IF NOT EXISTS idx_reserves_allow_remote 
  ON reserves(tenant_id, allow_remote_requests) 
  WHERE status = 'ativa';

COMMENT ON COLUMN reserves.allow_remote_requests IS 
  'Quando true, permite que militares externos ao reserve solicitem armamento remotamente.';
```

### Migration B — `remote_allowed_categories` (RR-04)
```sql
-- 20260704000002_reserves_remote_categories.sql
ALTER TABLE reserves
  ADD COLUMN IF NOT EXISTS remote_allowed_categories TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN reserves.remote_allowed_categories IS 
  'Categorias disponíveis para solicitação remota. Vazio = nenhuma. Ex: {arma,farda}';
```

### Migration C — `reserve_id` + `remote_reason` em `material_requests` (BUG-RR-04 + RR-05)
```sql
-- 20260704000003_material_requests_remote_fields.sql
ALTER TABLE material_requests
  ADD COLUMN IF NOT EXISTS reserve_id UUID REFERENCES reserves(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remote_reason TEXT,
  ADD COLUMN IF NOT EXISTS is_external_request BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_material_requests_reserve 
  ON material_requests(reserve_id);

COMMENT ON COLUMN material_requests.reserve_id IS 'Reserva para a qual a solicitação foi direcionada.';
COMMENT ON COLUMN material_requests.remote_reason IS 'Motivo da solicitação remota (obrigatório para externos).';
COMMENT ON COLUMN material_requests.is_external_request IS 'True quando o solicitante não é membro da reserva.';
COMMENT ON COLUMN material_requests.cancellation_reason IS 'Motivo do cancelamento (pelo efetivo ou armeiro).';
```

### Migration D — RLS Fix (BUG-RR-03 + BUG-RR-07)
```sql
-- 20260704000004_fix_material_requests_rls_tenant.sql

-- Remover políticas sem tenant filter
DROP POLICY IF EXISTS ssa_military_select ON material_requests;
DROP POLICY IF EXISTS ssa_staff_select ON material_requests;

-- Efetivo: só vê os próprios pedidos
CREATE POLICY ssa_military_select ON material_requests
  FOR SELECT TO authenticated
  USING (
    military_id = auth.uid()
    AND tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1)
  );

-- Staff: vê todos do próprio tenant
CREATE POLICY ssa_staff_select ON material_requests
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1)
    AND (
      SELECT role FROM profiles WHERE id = auth.uid() LIMIT 1
    ) IN ('armeiro', 'admin_reserva', 'admin_global', 'superadmin')
  );
```

---

## 5. BFF — Mudanças por Endpoint

### 5.1 `GET /api/reserves/mine`
- Adicionar `allow_remote_requests`, `remote_allowed_categories` na resposta
- Filtrar membership: para cada reserva, verificar se user é membro via `reserve_memberships`
- Retornar `{ reserves: [..., is_member: bool, allow_remote: bool, allowed_categories: string[] } ]`

### 5.2 `GET /api/ssa/available-materials`
- Verificar se user é membro da reserva alvo
- Se NÃO é membro: filtrar por `remote_allowed_categories` da reserva
- Se é membro: retornar todos os materiais disponíveis (comportamento atual)

### 5.3 `POST /api/ssa/requests`
- Salvar `reserve_id` no insert (BUG-RR-04)
- Validar `remote_reason` obrigatório quando usuário é externo (RR-05)
- Salvar `is_external_request = true` quando externo
- Notificar armeios DA reserva (não todos os armeios do tenant) — BUG-RR-02
- Corrigir deep link push para `/reserva/solicitacoes` — BUG-RR-05

### 5.4 `PATCH /api/ssa/requests/:id/cancel` (novo)
- Apenas `military_id` do request pode cancelar
- Status deve ser `pendente` ou `aprovado` (não pode cancelar `rejeitado`, `retirado`, `expirado`)
- Aceita `{ cancellation_reason: string (min 10) }`
- Atualiza status → `cancelado`, `cancellation_reason`, `cancelled_at = now()`
- Notifica armeiro da reserva com motivo

### 5.5 `notifyAllArmeios()` → `notifyArmeiosOfReserve(reserveId, tenantId, ...)`
- Adicionar filtro `tenant_id` E `reserve_id` via `reserve_memberships`

---

## 6. Frontend — Mudanças por Componente

### 6.1 `solicitar-armamento-sheet.tsx` (arquivo principal)

**Step 1 — Reserve (redesign completo):**
- Substituir lista de cards por `Combobox` (Radix `Popover + Command`)
- Filtrar reservas por `allow_remote_requests || is_member`
- Trigger: botão com ícone Building2 + nome selecionado ou "Selecione uma reserva..."
- Lista: filtro por nome/acronym com input interno
- Mostrar badge "Você é membro" para reservas onde `is_member = true`

**Step 1.5 — Motivo (novo step para externos):**
- Inserir step `"motivo"` entre `"reserve"` e `"materials"`
- Mostrar apenas quando user não é membro da reserva selecionada
- Label: "Por que você precisa de armamento nesta unidade?"
- Placeholder: "Ex: Serviço extra, treinamento externo, escala..."
- `Textarea` com contador de caracteres (10-500)
- Botão "Próximo" habilitado apenas quando `motivo.trim().length >= 10`

**Step 2 — Materials (adicionar busca):**
- Input `[data-testid="ssa-material-search"]` no topo
- Filter client-side debounced 200ms
- Manter grupos de categoria mas esconder grupos sem resultados

**Step 3 — TOTP:**
- Remover o campo "Observação" daqui
- Adicionar apenas: TOTP input + lista resumo de materiais
- Mover campo de observação genérica para o step "motivo" (se membro) ou remover (já tem o motivo obrigatório)

### 6.2 `solicitacao-status-card.tsx` (card no /efetivo)
- Botão "Cancelar" visível para status `pendente` ou `aprovado`
- Dialog de cancelamento com `Textarea` motivo (min 10 chars)
- Call `PATCH /api/ssa/requests/:id/cancel`
- Após cancelamento: atualizar estado local + mostrar toast de confirmação

### 6.3 `/reserva/solicitacoes/_solicitacoes-client.tsx`
- Mostrar coluna "Reserva" na listagem
- Mostrar `remote_reason` no painel de detalhes expandido
- Badge "Externo" / "Membro" por solicitação
- Ação "Cancelar" disponível para o armeiro com campo motivo
- Polling 30s para atualização automática

### 6.4 `/reserva/page.tsx`
- Corrigir query de count pendente adicionando `tenant_id` filter — BUG-RR-08
- Verificar que `ReserveRemoteAccessToggle` funciona após migration

### 6.5 `ReserveRemoteAccessToggle` + painel de configuração da reserva
- Adicionar checkboxes de categoria: arma, farda, acessório, equipamento
- Salvar via `PATCH /api/reserves/:id/settings` com `{ remote_allowed_categories: string[] }`

---

## 7. E2E Tests — IDs

### 7.1 Reservas e Disponibilidade

| ID | Descrição |
|----|-----------|
| RR01 | Sheet abre em step "reserve" com combobox visível |
| RR02 | Combobox filtra reservas por texto |
| RR03 | Apenas reservas com allow_remote ou membro aparecem |
| RR04 | 1 reserva → pula direto para materials |
| RR05 | 0 reservas → estado vazio com mensagem |

### 7.2 Motivo da Solicitação

| ID | Descrição |
|----|-----------|
| RR06 | Step "motivo" aparece para usuário externo à reserva |
| RR07 | Step "motivo" NÃO aparece para membro da reserva |
| RR08 | Botão "Próximo" desabilitado com motivo < 10 chars |
| RR09 | Botão "Próximo" habilitado com motivo ≥ 10 chars |
| RR10 | Motivo é enviado no POST /api/ssa/requests |

### 7.3 Seleção de Material

| ID | Descrição |
|----|-----------|
| RR11 | Input de busca visível no step materials |
| RR12 | Digitar filtra materiais em < 300ms |
| RR13 | Busca sem resultado → "Nenhum material encontrado" |
| RR14 | Limpar busca restaura lista completa |
| RR15 | Materiais filtram por categoria remota (externos não veem arma se não liberada) |

### 7.4 Cancelamento pelo Efetivo

| ID | Descrição |
|----|-----------|
| RR16 | Botão "Cancelar" visível em solicitação pendente |
| RR17 | Botão "Cancelar" visível em solicitação aprovada |
| RR18 | Dialog de cancelamento pede motivo (obrigatório) |
| RR19 | Cancelamento sem motivo → botão desabilitado |
| RR20 | Cancelamento com motivo → status muda para cancelado |

### 7.5 Fluxo do Armeiro

| ID | Descrição |
|----|-----------|
| RR21 | Armeiro vê solicitações do seu tenant (não de outros) |
| RR22 | Aprovar solicitação → status aprovado + notificação ao efetivo |
| RR23 | Rejeitar com motivo → status rejeitado |
| RR24 | Rejeitar sem motivo → erro de validação |
| RR25 | Confirmar retirada → status retirado + lendings criados |

### 7.6 Notificações

| ID | Descrição |
|----|-----------|
| RR26 | Armeiro recebe notificação ao criar solicitação |
| RR27 | Deep link da notificação → /reserva/solicitacoes |
| RR28 | Efetivo recebe notificação ao ser aprovado |
| RR29 | Efetivo recebe notificação ao ser rejeitado |
| RR30 | Armeiro recebe notificação ao efetivo cancelar |

### 7.7 Segurança (tenant isolation)

| ID | Descrição |
|----|-----------|
| SEC-RR01 | Armeiro de Tenant A NÃO vê solicitações de Tenant B |
| SEC-RR02 | Efetivo de Tenant A NÃO vê materiais de Tenant B |
| SEC-RR03 | notifyAllArmeios isolado por tenant |
| SEC-RR04 | PATCH /cancel só funciona para o próprio military_id |
| SEC-RR05 | reserve_id salvo e visível na solicitação |

### 7.8 Admin Controls

| ID | Descrição |
|----|-----------|
| ADM-RR01 | Toggle allow_remote visível para admin_reserva |
| ADM-RR02 | Toggle liga/desliga allow_remote via API |
| ADM-RR03 | Checkboxes de categoria visíveis no painel |
| ADM-RR04 | Categoria desabilitada → material dessa categoria não aparece para externo |
| ADM-RR05 | Privilégio: usuário (role) não pode alterar configurações da reserva |

---

## 8. Ordem de Execução

1. **Migrations SQL** (A→B→C→D) — sem isso, nada funciona
2. **BFF: corrigir bugs** (BUG-RR-01..09)
3. **BFF: POST /cancel** (novo endpoint)
4. **BFF: notifyArmeiosOfReserve** (substituir notifyAllArmeios)
5. **Frontend: step "reserve" — combobox** (RR-01, RR-02)
6. **Frontend: filtro allow_remote** (RR-03)
7. **Frontend: step "motivo"** (RR-05, RR-06..RR-10)
8. **Frontend: busca de material** (RR-06, RR-11..RR-14)
9. **Frontend: cancelamento no efetivo** (RR-08, RR-16..RR-20)
10. **Frontend: fix armeiro** (RR-07, RR-21..RR-25)
11. **Frontend: checkboxes de categoria** (RR-04, ADM-RR03, ADM-RR04)
12. **E2E: suite completa** (RR01..SEC-RR05..ADM-RR05)
13. **Deploy BFF + CF Pages**

---

## 9. Definition of Done

- [ ] Migrations aplicadas e validadas via `supabase migration list`
- [ ] `tsc --noEmit` em `apps/bff` e `apps/web` — 0 erros
- [ ] `pnpm test:e2e --project=remote-requests-suite` — 0 falhas
- [ ] Armeiro de Tenant A NÃO recebe notificação de Tenant B (SEC-RR01 passando)
- [ ] Campo `remote_reason` salvo no banco para solicitações externas
- [ ] `reserve_id` salvo em `material_requests` (verificar via Supabase MCP)
- [ ] Deep link push aponta para `/reserva/solicitacoes`
- [ ] CHANGELOG v9 atualizado
