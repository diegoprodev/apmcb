# Fase 5 — Cautela Permanente + Saída Diária Enterprise

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-5  
> **Premissa:** Fase 4 concluída — assinatura eletrônica Nível 1 funcionando e SIG01-SIG06 passando

---

## Distinção Fundamental de Domínio

Esta fase implementa **dois fluxos completamente distintos** que existem na operação real de qualquer reserva de armamento:

---

### SAÍDA DIÁRIA (`lendings` — dinâmica)

> "Pego a pistola para fazer o serviço. Devolvo ao terminar o turno."

- Item emprestado para o turno de serviço
- Retorno **obrigatório** ao fim do turno
- Fluxo rápido, repetível, diário
- O armeiro controla a saída e a devolução
- Já existe na tabela `lendings` (existente em produção)
- Nesta fase: adicionar assinatura digital e PDF ao fluxo existente

---

### CAUTELA POR TEMPO INDETERMINADO (`cautelamentos` — nova tabela)

> "Estou cautelado com uma pistola Glock e um colete balístico no meu nome.  
> O colete só devolvo quando vencer. A pistola troco quando quiser uma nova."

- Item atribuído **pessoalmente** ao militar via documento formal (Termo de Cautela)
- **Sem prazo determinado** — fica sob responsabilidade do militar até devolução, substituição ou encerramento
- **Conferência periódica obrigatória** — mesmo sem devolução, o item deve ser conferido periodicamente
- Militar assina **assumindo responsabilidade legal** pela guarda, conservação e uso correto
- Devolução/substituição ocorre por: vencimento do item, pedido do militar, transferência, licença, desligamento
- Fluxo diferente, tabela diferente, documento diferente
- **Novo em produção nesta fase**
- A posse do item é registrada em `material_items.status_operacional = 'cautelado'`
- **BLOQUEIO DE BANCO:** item `cautelado` não pode entrar em saída diária (trigger MI03-MI05)

---

## Objetivo da Fase

1. **Saída diária**: completar o fluxo de `lendings` com status machine enterprise, assinatura digital e PDF de comprovante
2. **Cautela permanente**: criar a entidade `cautelamentos` com Termo de Cautela assinado digitalmente, histórico de item e histórico de militar

---

## Escopo

### Saída Diária (lendings)
- Adicionar coluna `status` com status machine enterprise (renomear `status_legacy` de volta ao uso canônico)
- Adicionar `item_id UUID REFERENCES material_items(id)` — vincula a saída ao item físico individual
- Endpoints: confirm, sign, return com divergência
- PDF de comprovante de saída com QR Code
- Bucket `saidas-docs` no Supabase Storage
- Toda criação/devolução de saída atualiza `material_items.status_operacional` atomicamente

### Cautela por Tempo Indeterminado (cautelamentos)
- Nova tabela `cautelamentos` referenciando `material_items.id` via `item_id`
- `material_type_id` e `numero_serie` removidos de `cautelamentos` — estão em `material_items`
- Endpoints CRUD + assinar + devolver/substituir
- PDF de Termo de Cautela com assinatura digital do militar
- Bucket `cautelas-docs` no Supabase Storage
- Histórico de item: todos os cautelamentos de `material_items.id`
- Histórico de militar: todos os cautelamentos ativos e históricos de um militar
- Toda criação/encerramento de cautela atualiza `material_items.status_operacional` atomicamente

---

## Fora do Escopo

- ❌ SSA (sistema de solicitação) — já existente, não alterar
- ❌ Inventário periódico — Fase 8
- ❌ UI de histórico consolidado com filtros avançados (apenas cards básicos)
- ❌ Notificações push para vencimento de cautela (Fase 7 dashboard cards)
- ❌ Integração com RH / escala de serviço

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase 4 completa — SIG01-SIG06 passando | `pnpm test:e2e --project=signature-suite` |
| P2 | Fase 1 — `lendings.status_legacy` existe (renomeado) | `SELECT status_legacy FROM lendings LIMIT 1` |
| P3 | `hashDocument()` e `computeSignatureProof()` funcionando | Teste unitário |
| P4 | `document_signatures` com RULE imutável ativa | AT03/AT04 passando |

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/routes/lendings.ts` — adicionar endpoints enterprise para saída diária
- `apps/bff/src/routes/cautelamentos.ts` — CRIAR (CRUD de cautela permanente)
- `apps/bff/src/lib/pdf/saida-pdf.ts` — CRIAR (PDF de comprovante de saída)
- `apps/bff/src/lib/pdf/cautela-pdf.ts` — CRIAR (PDF de Termo de Cautela)
- `apps/bff/src/lib/storage.ts` — CRIAR ou atualizar (upload para Supabase Storage)

**Frontend:**
- `apps/web/src/app/(dashboard)/reserva/saidas/page.tsx` — renomear/atualizar para saída diária
- `apps/web/src/app/(dashboard)/reserva/cautelas/page.tsx` — CRIAR para cautela permanente
- `apps/web/src/components/reserva/cautela-card.tsx` — CRIAR
- `apps/web/src/components/reserva/saida-status-badge.tsx` — badge de status de saída
- `apps/web/src/app/(dashboard)/cadete/minhas-cautelas/page.tsx` — CRIAR (militar vê suas cautelas)

**Database:**
- `supabase/migrations/20260620000005_saida_enterprise.sql` — status machine de saída
- `supabase/migrations/20260620000005b_cautelamentos.sql` — nova tabela

**Testes:**
- `apps/web/e2e/saidas.spec.ts` — saída diária (renomear e ampliar custody.spec.ts)
- `apps/web/e2e/cautelamentos.spec.ts` — cautela permanente
- `apps/web/playwright.config.ts` — `saida-suite` e `cautelamento-suite`

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `supabase/migrations/20260615*.sql` | SSA schema — não alterar |
| `apps/bff/src/routes/ssa.ts` | SSA separada — não tocar |
| `apps/web/src/components/ui/*.tsx` | Design system |
| `apps/bff/src/lib/document-hash.ts` | Já testado — não alterar |

---

## Tabelas Permitidas

| Tabela | Operação | Justificativa |
|---|---|---|
| `material_items` | USE (criada Fase 1) | Rastreamento de estado operacional por item |
| `lendings` | ALTER ADD COLUMN | Status machine enterprise + item_id |
| `cautelamentos` | CREATE | Nova tabela de cautela por tempo indeterminado |

## Tabelas Proibidas

| Tabela | Motivo |
|---|---|
| `material_requests` | SSA — não tocar |
| `document_signatures` | Usar apenas via API — não alterar schema |

---

## Migration 1 — Saída Diária Enterprise

**Arquivo:** `supabase/migrations/20260620000005_saida_enterprise.sql`

```sql
-- Completar a máquina de estados da saída diária em lendings
-- A Fase 1 já renomeou "status" → "status_legacy"
-- Aqui adicionamos "status" com os valores canônicos do fluxo enterprise

ALTER TABLE lendings
  -- Item físico individual (obrigatório — toda saída é sobre um item concreto)
  ADD COLUMN IF NOT EXISTS item_id UUID REFERENCES material_items(id),
  -- Status machine canônico de saída diária
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'emitida'
    CHECK (status IN ('emitida','aguardando_confirmacao','ativa','devolvida','divergencia','cancelada')),
  -- Colunas de suporte enterprise
  ADD COLUMN IF NOT EXISTS unidade_id UUID REFERENCES unidades(id),
  ADD COLUMN IF NOT EXISTS prazo_devolucao TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS observacao_emissao TEXT,
  ADD COLUMN IF NOT EXISTS observacao_devolucao TEXT,
  ADD COLUMN IF NOT EXISTS armeiro_signature_id UUID REFERENCES document_signatures(id),
  ADD COLUMN IF NOT EXISTS militar_signature_id UUID REFERENCES document_signatures(id),
  ADD COLUMN IF NOT EXISTS document_hash TEXT,
  ADD COLUMN IF NOT EXISTS pdf_storage_path TEXT;

-- Migrar status_legacy para o novo campo status
UPDATE lendings SET status = 'ativa'      WHERE status_legacy IN ('active', 'ativo');
UPDATE lendings SET status = 'devolvida'  WHERE status_legacy IN ('returned', 'devolvido');
UPDATE lendings SET status = 'emitida'    WHERE status IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lendings_status  ON lendings(status);
CREATE INDEX IF NOT EXISTS idx_lendings_item    ON lendings(item_id);
CREATE INDEX IF NOT EXISTS idx_lendings_prazo   ON lendings(prazo_devolucao)
  WHERE status = 'ativa';
```

---

## Migration 2 — Cautela Permanente

**Arquivo:** `supabase/migrations/20260620000005b_cautelamentos.sql`

```sql
-- Nova tabela: cautelamentos (cautela por tempo indeterminado com conferência periódica)
-- Cada cautela referencia um item físico individual via item_id.
-- material_type_id e numero_serie NÃO estão aqui — estão em material_items.
CREATE TABLE IF NOT EXISTS cautelamentos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id),
  unidade_id          UUID NOT NULL REFERENCES unidades(id),
  -- Item físico individual (obrigatório — cautela sempre é sobre um item concreto)
  item_id             UUID NOT NULL REFERENCES material_items(id),
  militar_id          UUID NOT NULL REFERENCES profiles(id),   -- responsável pela guarda
  armeiro_id          UUID NOT NULL REFERENCES profiles(id),   -- quem emitiu a cautela
  -- Condição do item nos eventos
  condicao_emissao    TEXT NOT NULL DEFAULT 'bom'
    CHECK (condicao_emissao IN ('novo','bom','regular','ruim')),
  condicao_devolucao  TEXT
    CHECK (condicao_devolucao IN ('bom','regular','ruim','inapto')),
  motivo_emissao      TEXT NOT NULL,   -- ex: "Pistola de uso pessoal", "Colete de proteção"
  -- Controle de tempo indeterminado e conferência periódica
  data_emissao        TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_devolucao      TIMESTAMPTZ,
  data_ultima_conferencia TIMESTAMPTZ,  -- data da última conferência periódica realizada
  prazo_proxima_conferencia DATE,        -- prazo para próxima conferência obrigatória
  data_substituicao   TIMESTAMPTZ,
  -- Encadeamento de substituições
  substituido_por     UUID REFERENCES cautelamentos(id),  -- nova cautela que substituiu esta
  substitui           UUID REFERENCES cautelamentos(id),  -- cautela que esta substitui
  -- Status
  status              TEXT NOT NULL DEFAULT 'ativa'
    CHECK (status IN ('ativa','devolvida','substituida','em_revisao','cancelada')),
  motivo_devolucao    TEXT,
  -- Assinaturas (Termo de Cautela por Tempo Indeterminado)
  militar_signature_id  UUID REFERENCES document_signatures(id),
  armeiro_signature_id  UUID REFERENCES document_signatures(id),
  document_hash         TEXT NOT NULL,   -- hash do Termo no momento da emissão
  pdf_storage_path      TEXT,
  -- Auditoria
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cautelamentos_tenant     ON cautelamentos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_cautelamentos_item       ON cautelamentos(item_id);
CREATE INDEX IF NOT EXISTS idx_cautelamentos_militar    ON cautelamentos(militar_id);
CREATE INDEX IF NOT EXISTS idx_cautelamentos_status     ON cautelamentos(status);
CREATE INDEX IF NOT EXISTS idx_cautelamentos_conferencia ON cautelamentos(prazo_proxima_conferencia)
  WHERE status = 'ativa';

-- FK lógica: atualizar referências no material_items agora que cautelamentos existe
-- (as colunas active_lending_id e active_cautelamento_id são referências lógicas,
--  não FK físicas, para evitar dependência circular)

-- RLS: isolamento por tenant
ALTER TABLE cautelamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_cautelamentos" ON cautelamentos
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);

-- Militar vê apenas suas próprias cautelas via anon key
CREATE POLICY "militar_sees_own_cautelamentos" ON cautelamentos
  FOR SELECT USING (
    militar_id = auth.uid()
    OR (SELECT role FROM profiles WHERE id = auth.uid())
      IN ('admin_global','admin_reserva','armeiro','auditor','superadmin')
  );
```

---

## Transação Atômica Obrigatória

Toda criação ou encerramento de saída/cautela deve ocorrer em **uma única transação de banco**. Nenhum estado intermediário pode ser visível.

### Fluxo: Emitir Saída Diária

```typescript
// apps/bff/src/routes/saidas.ts — POST /api/saidas
await supabase.rpc('begin_transaction'); // ou client.begin()

// 1. Ler item e validar estado atual
const { data: item } = await supabase
  .from('material_items')
  .select('status_operacional')
  .eq('id', body.item_id)
  .single();

if (item.status_operacional !== 'disponivel') {
  throw new HTTPException(409, { message: `Item não disponível: ${item.status_operacional}` });
}

// 2. Criar registro em lendings
const { data: lending } = await supabase
  .from('lendings')
  .insert({ item_id: body.item_id, militar_id: body.militar_id, ... })
  .select().single();

// 3. Atualizar material_items atomicamente (trigger valida a transição)
await supabase.from('material_items').update({
  status_operacional: 'em_saida',
  current_holder_user_id: body.militar_id,
  current_unit_id: session.unidadeId,
  active_lending_id: lending.id,
}).eq('id', body.item_id);
// Se status não era 'disponivel', o trigger dispara ERRCODE P0001 → 409

// 4. Registrar audit_event
await recordAuditEvent({ action: 'saida.created', item_id: body.item_id, ... });

await supabase.rpc('commit_transaction');
```

### Fluxo: Emitir Cautela por Tempo Indeterminado

```typescript
// apps/bff/src/routes/cautelamentos.ts — POST /api/cautelamentos
// Mesma sequência:
// 1. Validar item.status_operacional === 'disponivel'
// 2. Criar registro em cautelamentos
// 3. UPDATE material_items SET status_operacional='cautelado', active_cautelamento_id=...
//    → trigger valida; se não era 'disponivel' → ERRCODE P0001 → 409
// 4. Registrar audit_event action='cautelamento.created'
// Tudo em transação única
```

### Fluxo: Devolução / Encerramento

```typescript
// Saída diária devolvida:
// 1. UPDATE lendings SET status='devolvida'
// 2. UPDATE material_items SET status_operacional='disponivel'
//    → trigger limpa holder, active_lending_id automaticamente
// 3. audit_event action='saida.returned'

// Cautela encerrada normalmente:
// 2. UPDATE material_items SET status_operacional='disponivel'

// Cautela encerrada com item inapto/extraviado:
// 2. UPDATE material_items SET status_operacional='inapto' (ou 'extraviado')
//    → item NÃO volta para disponivel; vai para manutenção/descarte
// 3. audit_event action='cautelamento.returned' + reason
```

**Regra de implementação:** O BFF valida antes de tentar (`status !== 'disponivel'` → 409 imediato). O trigger valida novamente no banco. As duas camadas garantem mensagens de erro claras e impossibilidade de race condition em saídas concorrentes.

---

## Status Machine — Saída Diária (lendings)

```
[emitida]
    │ armeiro confirma emissão → armeiro_signature_id preenchido
    ▼
[aguardando_confirmacao]    ← militar ainda não confirmou recebimento
    │ militar assina confirmação → militar_signature_id preenchido
    ▼
[ativa]
    │ PATCH /return (sem divergência)       │ PATCH /return (com divergência)
    ▼                                        ▼
[devolvida]                            [divergencia]
    
[qualquer estado anterior a "ativa"] → [cancelada]
```

**Transições inválidas → 422**

---

## Status Machine — Cautela Permanente (cautelamentos)

```
[ativa]
    │ Devolução normal          │ Substituição            │ Revisão solicitada
    ▼                           ▼                          ▼
[devolvida]              [substituida]                [em_revisao]
                          + nova cautela               → [ativa] após revisão
                          com substitui=id_antigo
```

**Substituição**: o militar troca a pistola por uma nova. A cautela antiga fica `substituida`, uma nova é criada com `substitui = id_antiga`.

---

## Endpoints — Saída Diária

| Método | Path | Role | Ação |
|---|---|---|---|
| `GET` | `/api/saidas` | armeiro, admin_reserva | Listar saídas ativas |
| `POST` | `/api/saidas` | armeiro, admin_reserva | Emitir saída |
| `POST` | `/api/saidas/:id/sign-armeiro` | armeiro | Assinar emissão (TOTP) |
| `POST` | `/api/saidas/:id/confirm` | usuario | Confirmar recebimento |
| `POST` | `/api/saidas/:id/sign-militar` | usuario | Assinar confirmação (TOTP) |
| `PATCH` | `/api/saidas/:id/return` | armeiro, admin_reserva | Devolver |
| `GET` | `/api/saidas/:id/pdf` | armeiro, admin_reserva, usuario | PDF comprovante |

*Nota: os endpoints atuais em `/api/lendings` continuam funcionando para compatibilidade. Novos endpoints em `/api/saidas` usam o nome de domínio correto.*

---

## Endpoints — Cautela Permanente

| Método | Path | Role | Ação |
|---|---|---|---|
| `GET` | `/api/cautelamentos` | armeiro, admin_reserva, auditor | Listar cautelas |
| `POST` | `/api/cautelamentos` | armeiro, admin_reserva | Emitir Termo de Cautela |
| `POST` | `/api/cautelamentos/:id/sign-armeiro` | armeiro | Assinar emissão (TOTP) |
| `POST` | `/api/cautelamentos/:id/sign-militar` | usuario | Militar assina aceitando responsabilidade (TOTP) |
| `POST` | `/api/cautelamentos/:id/return` | armeiro, admin_reserva | Registrar devolução |
| `POST` | `/api/cautelamentos/:id/substitute` | armeiro, admin_reserva | Substituir item |
| `GET` | `/api/cautelamentos/:id/pdf` | armeiro, admin_reserva, usuario | Baixar Termo de Cautela |
| `GET` | `/api/cautelamentos/history/item/:material_id` | armeiro, auditor | Histórico de um item |
| `GET` | `/api/cautelamentos/history/militar/:user_id` | armeiro, admin_reserva | Tudo do militar |
| `GET` | `/api/cautelamentos/ativos` | usuario | Minhas cautelas ativas |

---

## PDF — Termo de Cautela

**Conteúdo obrigatório:**

```
TERMO DE CAUTELA
[Brasão/Logo do órgão]

IDENTIFICAÇÃO
Número de controle: CAU-{ano}-{sequencial}
Data de emissão: DD/MM/AAAA HH:MM

ITEM CAUTELADO
Descrição: [ex: Pistola Semiautomática Glock G17]
Número de série: [número]
Condição na emissão: [Bom/Regular/Com avaria]
Validade do item: [DD/MM/AAAA ou "Indeterminado"]

RESPONSÁVEL PELA GUARDA
Nome: [nome completo]
Matrícula: [número]
Graduação/Posto: [posto]
Unidade: [unidade]

ARMEIRO RESPONSÁVEL PELA EMISSÃO
Nome: [nome completo]
Matrícula: [número]

TERMOS DE RESPONSABILIDADE
Declaro que recebi o item acima descrito e me responsabilizo pela sua 
guarda, conservação e uso correto, conforme regulamento interno.

ASSINATURAS
Armeiro: ____________________________  Data: ___________
Militar: ____________________________  Data: ___________

[QR CODE de verificação]
Hash: {primeiros 16 chars do document_hash}

Documento gerado eletronicamente pela Plataforma de Governança de Bens Sensíveis.
Verifique a autenticidade em: https://[dominio]/v/{id}
```

---

## Testes E2E

### Suite de Saída Diária

**Arquivo:** `apps/web/e2e/saidas.spec.ts` | **Projeto:** `saida-suite`

| ID | Teste | Critério |
|---|---|---|
| SD01 | Emitir saída de material disponível | 201; status=emitida |
| SD02 | Emitir saída de item já em saída ativa | 409 Conflict |
| SD03 | Armeiro assina com TOTP → status=aguardando_confirmacao | status atualizado; signature criada |
| SD04 | Militar confirma recebimento → status=ativa | status=ativa |
| SD05 | Devolução sem divergência → status=devolvida | status=devolvida |
| SD06 | Devolução com divergência → status=divergencia + ocorrência | ocorrencias+1 |

### Suite de Cautela por Tempo Indeterminado

**Arquivo:** `apps/web/e2e/cautelamentos.spec.ts` | **Projeto:** `cautelamento-suite`

| ID | Teste | Critério |
|---|---|---|
| CT01 | Emitir cautela de item `disponivel` | 201; cautelamentos+1; material_items.status=cautelado |
| CT02 | Emitir cautela de item `em_saida` → bloqueado por trigger | 409; ERRCODE P0001 |
| CT03 | Emitir cautela de item `cautelado` → bloqueado por trigger | 409; ERRCODE P0001 |
| CT04 | Armeiro assina Termo com TOTP | document_signatures+1; audit_event criado |
| CT05 | Militar assina aceitando responsabilidade com TOTP | PDF gerado; material_items.current_holder=militar |
| CT06 | Substituição: antiga=substituida; nova=ativa | material_items.active_cautelamento=nova.id |
| CT07 | Encerramento normal → item volta para `disponivel` | material_items.status=disponivel; holder=NULL |
| CT08 | Histórico de item: todos os cautelamentos de item_id | N registros ordenados por data_emissao |

### Suite de Integridade de Posse (cross-fluxo)

**Arquivo:** `apps/web/e2e/item-integrity.spec.ts` | **Projeto:** `item-integrity-suite`

| ID | Teste | Critério | Bloqueio? |
|---|---|---|---|
| IT01 | Saída de item `disponivel` → aceita | 201; status=em_saida | ✅ |
| IT02 | Cautela de item `disponivel` → aceita | 201; status=cautelado | ✅ |
| IT03 | Segunda saída do mesmo item `em_saida` | 409; trigger P0001 | ✅ BLOQUEIO |
| IT04 | Cautela de item `em_saida` | 409; trigger P0001 | ✅ BLOQUEIO |
| IT05 | Saída de item `cautelado` | 409; trigger P0001 | ✅ BLOQUEIO |
| IT06 | Segunda cautela do mesmo item `cautelado` | 409; trigger P0001 | ✅ BLOQUEIO |
| IT07 | Devolução de saída → item volta para `disponivel` + cache limpo | status=disponivel; holder=NULL | ✅ |
| IT08 | Encerramento de cautela → item volta para `disponivel` + cache limpo | status=disponivel; active_cautelamento=NULL | ✅ |
| IT09 | Operação com `item_id` de outro tenant | 404 (RLS isola) | ✅ BLOQUEIO |

---

## Testes de Segurança

| ID | Cenário | Resultado esperado |
|---|---|---|
| SEC-5-01 | Militar tenta emitir saída | 403 |
| SEC-5-02 | Armeiro tenta assinar como militar (rol errado) | 422 — validação de papel |
| SEC-5-03 | Saída/cautela de outro tenant | 404 (RLS isola) |
| SEC-5-04 | Emitir saída de item com `status_operacional=cautelado` | 409 — trigger P0001 bloqueia ✅ BLOQUEIO |
| SEC-5-05 | Emitir cautela de item com `status_operacional=em_saida` | 409 — trigger P0001 bloqueia ✅ BLOQUEIO |
| SEC-5-06 | Transição de status inválida na saída | 422 |
| SEC-5-07 | Militar tenta revogar assinatura em document_signatures | RULE bloqueia |

---

## Testes de Regressão

```bash
cd apps/web
pnpm test:e2e --project=chromium
pnpm test:e2e --project=suite
pnpm test:e2e --project=ssa-suite
pnpm test:e2e --project=nexus-suite
pnpm test:e2e --project=rate-limit
pnpm test:e2e --project=multitenant-suite
pnpm test:e2e --project=rbac-suite
pnpm test:e2e --project=audit-suite
pnpm test:e2e --project=signature-suite
pnpm test:e2e --project=saida-suite          # NOVA — saída diária
pnpm test:e2e --project=cautelamento-suite   # NOVA — cautela permanente
```

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | IT03: segunda saída do mesmo item → trigger P0001 → 409 | ✅ BLOQUEIO |
| CA02 | IT04: cautela de item `em_saida` → trigger P0001 → 409 | ✅ BLOQUEIO |
| CA03 | IT05: saída de item `cautelado` → trigger P0001 → 409 | ✅ BLOQUEIO |
| CA04 | IT07/IT08: devolução/encerramento → item volta para `disponivel` + cache limpo | ✅ BLOQUEIO |
| CA05 | SD03/CT04: assinatura do armeiro cria document_signatures | ✅ Sim |
| CA06 | CT05: Termo de Cautela com dupla assinatura gera PDF | ✅ Sim |
| CA07 | CT06: substituição preserva histórico completo | ✅ Sim |
| CA08 | audit_event para toda emissão, devolução e transição de estado | ✅ BLOQUEIO |
| CA09 | IT09: item de outro tenant → 404 (RLS + tenant_id) | ✅ BLOQUEIO |
| CA10 | Regressão completa verde (incluindo item-integrity-suite) | ✅ BLOQUEIO |

---

## Validação sob Estresse

**Integridade de Posse (item_id):**
1. Item `disponivel` → saída → `em_saida` ✓
2. Item `em_saida` → nova saída → 409 (trigger P0001) ✓
3. Item `em_saida` → cautela → 409 (trigger P0001) ✓
4. Item `cautelado` → saída → 409 (trigger P0001) ✓
5. Devolução de saída → item `disponivel`, holder=NULL, active_lending=NULL ✓
6. Encerramento de cautela inapto → item `inapto`, NÃO volta para disponivel ✓
7. Dois usuarios tentam saída do mesmo item simultaneamente → apenas um sucede; segundo recebe 409 ✓

**Saída Diária:**
1. Transição inválida na máquina de estados (devolvida → ativa) → 422
2. Divergência na devolução → status=divergencia + ocorrencia criada
3. item_id de outro tenant → 404 (RLS)

**Cautela por Tempo Indeterminado:**
1. Militar pode ter cautelas de itens DIFERENTES (correto — um item, uma posse; vários itens, vários responsáveis)
2. Substituição: antiga=substituida, nova=ativa, vínculo `substitui` preservado
3. Histórico do item (por item_id) mostra linha do tempo completa
4. Histórico do militar mostra ativas + históricas
5. UPDATE em document_signatures de cautela → RULE bloqueia

---

## Checklist de UI

- [ ] Tela `/reserva/cautelas/` separada de `/reserva/saidas/`
- [ ] Badge de status diferente para cada fluxo
- [ ] Militar vê "Minhas Cautelas" em `/cadete/minhas-cautelas/`
- [ ] PDF de Termo de Cautela com todos os campos obrigatórios
- [ ] QR Code funcional na página de verificação pública `/v/[id]`
- [ ] Mobile testado em 375px para ambas as telas

---

## Checklist de Segurança

- [ ] `tenant_id` em todas as queries de `cautelamentos`
- [ ] `military_id` verificado: militar só vê suas próprias cautelas via anon
- [ ] Armeiro não pode assinar como militar e vice-versa
- [ ] RULE imutável em `document_signatures` verificada
- [ ] Nenhum dado sensível em logs

## Checklist de Auditoria

- [ ] Emissão de saída → `audit_event` action="saida.created"
- [ ] Devolução de saída → `audit_event` action="saida.returned"
- [ ] Emissão de cautela → `audit_event` action="cautelamento.created"
- [ ] Assinatura de cautela → `audit_event` action="signature.created"
- [ ] Devolução de cautela → `audit_event` action="cautelamento.returned"
- [ ] Substituição → `audit_event` action="cautelamento.substituted"

---

## Plano de Rollback

**Nível 1 (sem downtime):**
```bash
git revert [commit-da-fase-5]
git push origin main
```

**Nível 2 (rollback de migration):**
```sql
-- Rollback migration 5b (cautela permanente)
DROP TABLE IF EXISTS cautelamentos CASCADE;

-- Rollback migration 5a (saída enterprise)
ALTER TABLE lendings
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS unidade_id,
  DROP COLUMN IF EXISTS prazo_devolucao,
  DROP COLUMN IF EXISTS observacao_emissao,
  DROP COLUMN IF EXISTS observacao_devolucao,
  DROP COLUMN IF EXISTS armeiro_signature_id,
  DROP COLUMN IF EXISTS militar_signature_id,
  DROP COLUMN IF EXISTS document_hash,
  DROP COLUMN IF EXISTS pdf_storage_path;
-- status_legacy já estava lá desde Fase 1 — mantém
```

---

## Definition of Done da Fase 5

### 1. Critérios Funcionais
- [ ] SD01-SD06: saída diária enterprise funcionando
- [ ] CT01-CT06: cautela permanente funcionando
- [ ] PDF de comprovante de saída gerado
- [ ] PDF de Termo de Cautela com dupla assinatura gerado
- [ ] Histórico de item e histórico de militar funcionando

### 2. Critérios Técnicos
- [ ] Build passa, typecheck passa
- [ ] Migrations 5a e 5b aplicadas
- [ ] Buckets `saidas-docs` e `cautelas-docs` criados e privados

### 3. Critérios de Segurança
- [ ] SD02: saída duplicada → 409 ✅ BLOQUEIO
- [ ] CT02: cautela duplicada → 409 ✅ BLOQUEIO
- [ ] SEC-5-04: saída e cautela independentes ✅ BLOQUEIO
- [ ] RULE de `document_signatures` verificada

### 4. Auditoria
- [ ] Todos os eventos de saída e cautela geram audit_events

### 5. Multi-tenant
- [ ] `cautelamentos` filtrado por tenant_id
- [ ] `lendings` (saída) filtrado por tenant_id

### 6. RBAC
- [ ] roleGuard aplicado corretamente em todos os endpoints

### 7. UI
- [ ] Telas separadas para saída diária e cautela permanente
- [ ] Militar vê suas cautelas em tela dedicada
- [ ] Mobile testado

### 8. Performance
- [ ] PDF gerado em < 3s
- [ ] Endpoints de listagem em < 800ms

### 9. Regressão
- [ ] `saida-suite`: SD01-SD06 passando
- [ ] `cautelamento-suite`: CT01-CT08 passando
- [ ] `item-integrity-suite`: IT01-IT09 passando ✅ BLOQUEIO
- [ ] Fases anteriores: todos passando

### 10. Evidências
- [ ] Screenshot `saida-suite: 6/6 passed`
- [ ] Screenshot `cautelamento-suite: 8/8 passed`
- [ ] Screenshot `item-integrity-suite: 9/9 passed`
- [ ] IT03-IT06 testados via BFF e confirmados também no banco direto (trigger ativo)
- [ ] Screenshot do PDF de Termo de Cautela com dupla assinatura
- [ ] Screenshot do histórico do item (por `item_id`)
- [ ] Output `pnpm typecheck` sem erros
- [ ] Relatório em `docs/enterprise/reports/phase-5-final-report.md`

---

*Fase 5 — Saída Diária Enterprise + Cautela por Tempo Indeterminado v1.2 — 2026-06-20*  
*Revisão: `material_items` com trigger de integridade de posse; `item_id` em `lendings` e `cautelamentos`; SEC-5-04 removida; IT01-IT09 adicionados*
