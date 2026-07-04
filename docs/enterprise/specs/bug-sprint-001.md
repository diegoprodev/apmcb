# Bug Sprint 001 — Enterprise Spec

> **Data:** 2026-07-03  
> **Prioridade:** CRÍTICO — todos os itens bloqueiam qualidade enterprise  
> **Princípios:** SRP, DRY, SSOT, KISS, YAGNI + DoD canônica

---

## Contexto dos Bugs (reportados pelo usuário com screenshots)

Screenshots confirmam:
- Checkbox clicável apenas FORA da área abaixo → bug de z-index/pointer-events
- PDF exporta todos os itens da página independentemente da seleção
- PDF sem header profissional (sem logo, sem armeiro, sem hash)
- Movimentações de 02/07 às 17:46 aparecem desagrupadas (cada item em card separado)
- Hora ausente em itens devolvidos no card de grupo
- Autocomplete ausente em páginas de militares/usuários/arsenal
- Filtros avançados (data, status) ausentes no arsenal
- Armeiro não pode solicitar nova categoria

---

## BUG 1: Validação de Agrupamento — Efetivo `/efetivo/historico`

### Comportamento esperado
Items com mesmo `movement_id` devem aparecer em 1 card agrupado.
Items com `movement_id=null` criados na mesma "Nova Saída" (1 item) aparecem individualmente. ✅ CORRETO.

### Root cause observado
`groupByRetirada()` usa `movement_id ?? \`${military.id}_${issued_at}\`` como key.  
Saídas individuais (1 item cada) têm `movement_id=null` → cada uma tem key única → 1 card por saída → CORRETO.

### Fix necessário
- No form de Nova Saída (`_form.tsx`): **sempre gerar `movement_id`** (mesmo para 1 item), garantindo que futuras saídas sempre sejam rastreáveis por transação.
- Nenhum dado histórico é retroativamente agrupado (YAGNI).

### Spec E2E
```
GRP01: /efetivo/historico carrega em modo cards por default
GRP02: cards existentes mostram data+hora no header
GRP03: items com mesmo movement_id aparecem no mesmo card (testar com batch)
GRP04: modo tabela mostra items individuais com coluna de status correto
GRP05: hora exibida em cards devolvidos (não só em ativos)
```

---

## BUG 2: Autocomplete — Todas as Páginas de Listagem

### Páginas afetadas
| Página | Campo autocomplete |
|---|---|
| `/admin/usuarios` | nome_completo, matricula |
| `/reserva/militares` | nome_completo, matricula, posto |
| `/admin/arsenal` | nome material, categoria |
| `/admin/saidas` | nome militar, matricula, material |
| `/reserva/saidas` | nome militar, material |
| `/efetivo/historico` | material |

### Comportamento esperado
- Input de busca com debounce 300ms
- Filtra lista client-side (dados já carregados)
- Limpa com botão X
- Placeholder descritivo: "Buscar por nome ou matrícula..."
- Estado vazio: "Nenhum resultado para [termo]"

### Spec E2E
```
AC01: input de busca visível na página /admin/usuarios
AC02: digitar matrícula filtra lista em <500ms
AC03: digitar nome parcial filtra corretamente
AC04: termo sem resultado → estado vazio com mensagem
AC05: botão X limpa filtro e restaura lista
AC06: busca case-insensitive (maiúsculas/minúsculas)
AC07: busca com acento normalizado (é = e)
```

---

## BUG 3: Filtros Avançados — Arsenal e Materiais

### `/admin/arsenal` — filtros necessários
- **Status**: Todos / Disponível / Em uso / Sem estoque (baseado em `stock_available`)
- **Categoria**: dropdown com categorias existentes
- **Data de cadastro**: range picker (de/até)

### `/reserva/saidas` e `/admin/saidas` — filtros existentes (manter)
- Status (ativo/devolvido), data range, busca

### Spec E2E
```
FLT01: filtro por status "Disponível" mostra apenas materiais com stock_available > 0
FLT02: filtro por categoria filtra corretamente
FLT03: combinar busca + categoria → AND lógico
FLT04: limpar filtros restaura lista completa
FLT05: filtros persistem ao trocar card/table mode
```

---

## BUG 4 (CRÍTICO): Checkbox — Área de Clique Incorreta

### Comportamento observado
O checkbox só é marcado quando o usuário clica na área ABAIXO do elemento `<input type="checkbox">`, não diretamente no checkbox. Indica overflow/sobreposição ou `pointer-events` errado em elemento filho.

### Root cause provável
- O `<input type="checkbox">` tem `size-4` (16×16px) mas está posicionado incorretamente
- OU um elemento irmão/filho está com `pointer-events: auto` sobrepondo o checkbox
- OU o wrapper do card tem `onClick` que intercede antes do checkbox

### Fix
1. Investigar todos os checkboxes nas páginas afetadas
2. Garantir `onClick={(e) => e.stopPropagation()}` no container do checkbox
3. Garantir que o `<input>` tem área de clique adequada: `className="size-5 cursor-pointer accent-primary"`
4. Adicionar `<label>` wrapping the input quando apropriado

### Spec E2E
```
CHK01: clicar diretamente no checkbox em /reserva/militares → checked=true
CHK02: clicar no centro exato do checkbox (usando locator.check()) → funciona
CHK03: clicar no card wrapper NÃO marca o checkbox (apenas o checkbox marca)
CHK04: estado indeterminate no header quando seleção parcial
CHK05: deselecionar funciona clicando no checkbox já marcado
```

---

## BUG 5 (CRÍTICO): PDF Export — Enterprise Quality

### Comportamento atual (ERRADO)
- Exporta TODOS os itens da página, independentemente dos selecionados
- Sem logo do tenant
- Sem nome do armeiro
- Sem hora da exportação
- Sem nome da reserva
- Sem hash de integridade

### Comportamento esperado

**Header do PDF:**
```
[LOGO TENANT]    RELATÓRIO DE [TIPO]
                 Reserva: [Nome da Reserva]
                 Armeiro: [Nome do Armeiro]
                 Emitido em: DD/MM/AAAA HH:MM:SS
                 Total: N registro(s) selecionado(s)
─────────────────────────────────────────────────────
```

**Footer do PDF:**
```
─────────────────────────────────────────────────────
Hash de integridade: SHA256-[8chars-do-hash]
Documento gerado automaticamente pelo Sistema de Controle de Bens Sensíveis
```

### Arquitetura do fix

**`/components/shared/grid-pdf-button.tsx`** — refatorar `GridPdfButton`:

```typescript
interface GridPdfButtonProps {
  printTargetId: string;
  label?: string;
  disabled?: boolean;
  selectedCount?: number;
  selectedGroupKeys?: Set<string>;   // filtra grupos para exportar
  // Novos props enterprise:
  reportTitle?: string;              // "SAÍDAS DE MATERIAL" etc
  reserveName?: string;              // nome da reserva ativa
  armeiroName?: string;              // nome do usuário logado
  tenantLogoUrl?: string;            // URL do logo do tenant
}
```

**Algoritmo de print enterprise:**
1. Clone o elemento `#printTargetId`
2. Se `selectedGroupKeys`: remover nós cujo `data-group-key` não está no set
3. Se `selectedIds`: remover linhas de tabela cujo `data-id` não está no set
4. Injetar `<div id="pdf-header">` antes do conteúdo com logo + metadados
5. Gerar hash: `SHA256(JSON.stringify(dados selecionados)).slice(0,8).toUpperCase()`
6. Injetar `<div id="pdf-footer">` após o conteúdo com hash
7. `window.print()` com CSS `@media print { #pdf-header, #pdf-footer { display: block; } }`

### Spec E2E
```
PDF01: selecionar 0 itens → botão PDF desabilitado
PDF02: selecionar 2 itens → PDF contém apenas 2 (verificar count no header)
PDF03: PDF header contém nome do armeiro
PDF04: PDF header contém nome da reserva
PDF05: PDF footer contém hash (8 chars hex)
PDF06: selecionar todos → PDF com todos; desmarcar 1 → PDF com N-1
```

---

## BUG 6 (CRÍTICO): Agrupamento por movement_id Quebrado

### Comportamento observado
Screenshots de 02/07/2026 às 17:46 mostram items como cards/rows individuais, sem agrupamento visual, mesmo items do mesmo militar na mesma hora.

### Root causes identificados

**a) movement_id nunca gerado para saída individual**
```typescript
// apps/web/src/app/(dashboard)/reserva/saidas/nova/_form.tsx:205
const movementId = items.length > 1 ? crypto.randomUUID() : null;
//                                                          ^^^^
// PROBLEMA: saída de 1 item → movement_id=null → fallback usa issued_at individual
```

**b) Fallback key usa issued_at exato**
```typescript
// groupByRetirada():
const key = l.movement_id ?? `${l.military?.id ?? "??"}_${l.issued_at}`;
// Se dois items têm issued_at diferente por milissegundos → chaves diferentes → grupos separados
```

**c) Hora ausente em cards devolvidos**
O header do AdminGroupCard provavelmente não exibe a hora quando `allReturned=true`.

### Fix

**a) Sempre gerar movement_id no form de Nova Saída:**
```typescript
const movementId = crypto.randomUUID(); // sempre, independente da quantidade
```

**b) Melhorar fallback para truncar ao minuto:**
```typescript
// ANTES:
const key = l.movement_id ?? `${l.military?.id ?? "??"}_${l.issued_at}`;
// DEPOIS: truncar issued_at ao minuto para agrupar saídas quasi-simultâneas
const issuedMin = l.issued_at.slice(0, 16); // "2026-07-02T17:46"
const key = l.movement_id ?? `${l.military?.id ?? "??"}_${issuedMin}`;
```

**c) Exibir hora sempre (ativo e devolvido):**
Garantir que `issued_at` formatado com hora aparece em todos os cards, não só nos ativos.

### Spec E2E
```
MOV01: Nova Saída com 1 item → movement_id gerado (não null) no banco
MOV02: Nova Saída com 3 items → todos compartilham mesmo movement_id
MOV03: /reserva/saidas: items do mesmo movimento em 1 card
MOV04: /admin/saidas: idem
MOV05: /efetivo/historico: card mostra hora em items devolvidos
MOV06: table mode mostra coluna "Hora" com valor preenchido
```

---

## BUG 7: Armeiro — Solicitar Nova Categoria

### Comportamento esperado
Na página `/reserva/arsenal` (aba Categorias), o armeiro vê um botão "Solicitar Categoria" ao lado do título "Categorias operacionais". Ao clicar:

1. Modal com form: nome da categoria, slug, ícone, campos obrigatórios
2. Cria registro na tabela `category_requests` com `status='pendente'`
3. Admin recebe notificação (ou vê na fila de aprovações)
4. Ao aprovar, a categoria é criada em `material_categories` com `tenant_id` correto
5. Categoria fica disponível para todos os armeiros e admins da reserva

### Arquitetura

**Migration:**
```sql
CREATE TABLE category_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  reserve_id uuid REFERENCES reserves(id),
  requested_by uuid REFERENCES profiles(id),
  nome text NOT NULL,
  slug text NOT NULL,
  icon_name text,
  status text DEFAULT 'pendente' CHECK (status IN ('pendente','aprovado','rejeitado')),
  reviewed_by uuid REFERENCES profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
-- RLS: armeiro vê suas próprias requests; admin_global vê todas do tenant
```

**BFF routes:**
```
POST /api/categories/request   → criar solicitação (armeiro)
GET  /api/categories/requests  → listar pendentes (admin)
POST /api/categories/requests/:id/approve → aprovar (admin)
POST /api/categories/requests/:id/reject  → rejeitar (admin)
```

**UI:**
- Botão minimalista `variant="ghost"` com ícone `+` e texto "Solicitar" no header da seção
- RBAC: visível para `armeiro`, `admin_reserva`, `admin_global`
- Modal de confirmação antes de aprovar

### Spec E2E
```
CAT01: armeiro vê botão "Solicitar Categoria" na aba Categorias
CAT02: clicar abre modal com form nome/slug/ícone
CAT03: submit cria request no banco com status='pendente'
CAT04: admin vê lista de requests pendentes em /admin/categorias
CAT05: admin aprova → categoria criada em material_categories
CAT06: categoria aprovada aparece para todos armeiros da reserva
CAT07: armeiro não pode aprovar request própria
```

---

## BUG 8: Feature Parity — `/efetivo` Pages

### Páginas efetivo com gaps
- `/efetivo/historico`: falta autocomplete por material, falta filtro por status (ativo/devolvido)
- `/efetivo/minhas-cautelas`: falta filtro por status, falta busca por material

### Adições necessárias
- Autocomplete client-side (já carregou dados via BFF)
- Toggle status: Todos / Ativos / Devolvidos
- Pagination "Ver mais" (já existe, verificar)

### Spec E2E
```
EF01: /efetivo/historico tem input de busca por material
EF02: filtrar por "Ativo" mostra apenas saídas ativas
EF03: filtrar por "Devolvido" mostra apenas devolvidas
EF04: busca + filtro status combinados (AND)
EF05: /efetivo/minhas-cautelas tem input de busca
```

---

## Ordem de Execução

| # | Tarefa | Arquivo principal | Prioridade |
|---|---|---|---|
| 1 | Bug 8: movement_id sempre gerado | `_form.tsx` + `groupByRetirada` | CRÍTICO |
| 2 | Bug 4: checkbox click area | todos os `*-client.tsx` | CRÍTICO |
| 3 | Bug 5: PDF enterprise | `grid-pdf-button.tsx` | ALTO |
| 4 | Bug 2/3: autocomplete + filtros | todos os `*-filters.tsx` | ALTO |
| 5 | Bug 6: feature parity efetivo | `_historico-client.tsx` etc | MÉDIO |
| 6 | Bug 7: armeiro categoria | migration + BFF + UI | MÉDIO |
| 7 | E2E specs Playwright | `e2e/*.spec.ts` | MÉDIO |

---

## Definition of Done

- [ ] `tsc --noEmit` sem erros em `apps/web` e `apps/bff`
- [ ] `pnpm test:e2e` passando 0 falhas para todos os specs novos
- [ ] Validação visual Playwright para cada bug fix
- [ ] BFF deployado no Hetzner com `docker compose build && up -d`
- [ ] CHANGELOG atualizado com versão incrementada
- [ ] Push para `main`
