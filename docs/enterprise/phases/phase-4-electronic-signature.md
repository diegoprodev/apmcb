# Fase 4 — Assinatura Eletrônica Nível 1

> **DoD Canônica:** IMPLEMENTADO NÃO É ENTREGUE — ver `../07-canonical-definition-of-done.md`  
> **Harness ID:** PH-4  
> **Premissa:** Fase 3 concluída — audit_events com hash encadeado funcionando e AT01-AT05 passando

---

## Objetivo

Implementar assinatura eletrônica Nível 1 (TOTP + hash documental SHA-256) para fluxos críticos da plataforma, com tabela `document_signatures` imutável e rota pública de verificação de autenticidade de documentos.

---

## Escopo

- Nova tabela `document_signatures` com RULE SQL de imutabilidade
- `apps/bff/src/lib/document-hash.ts` — `hashDocument()` para hash canônico
- `apps/bff/src/lib/signature-proof.ts` — `computeSignatureProof()` para prova de assinatura
- Integração com TOTP existente: validar TOTP antes de criar assinatura
- Rota pública de verificação: `apps/web/src/app/v/[document_id]/page.tsx`
- Suite E2E SIG01-SIG06

---

## Fora do Escopo

- ❌ WebAuthn/Passkey — Nível 2 (Fase 10+)
- ❌ Gov.br OAuth2 — Nível 3 (Fase 12+)
- ❌ ICP-Brasil A1/A3 — apenas quando regulamento exigir
- ❌ Assinatura de documentos específicos (cautela, passagem) — Fases 5 e 6
- ❌ UI de listagem de assinaturas — Fase 7

---

## Premissas

| # | Premissa | Como verificar |
|---|---|---|
| P1 | Fase 3 completa — AT01-AT05 passando | `pnpm test:e2e --project=audit-suite` |
| P2 | TOTP existente funcionando | `pnpm test:e2e --project=ssa-suite` |
| P3 | TOTP anti-replay ativo | `last_used_token` em totp_secrets |

---

## Arquivos Permitidos

**BFF:**
- `apps/bff/src/lib/document-hash.ts` — CRIAR
- `apps/bff/src/lib/signature-proof.ts` — CRIAR
- `apps/bff/src/routes/signatures.ts` — CRIAR (endpoints de assinatura)

**Frontend:**
- `apps/web/src/app/v/[document_id]/page.tsx` — CRIAR (rota pública de verificação)
- `apps/web/src/app/v/[document_id]/layout.tsx` — CRIAR (sem auth guard)

**Database:**
- `supabase/migrations/20260620000004_document_signatures.sql` — nova migration

**Testes:**
- `apps/web/e2e/signatures.spec.ts` — nova suite
- `apps/web/playwright.config.ts` — adicionar `signature-suite`

## Arquivos Proibidos

| Arquivo | Motivo |
|---|---|
| `apps/bff/src/routes/totp.ts` | TOTP funciona — não alterar |
| `apps/bff/src/routes/auth.ts` | Auth separada — não tocar |
| `supabase/migrations/20260614*.sql` | Anti-replay existente — não alterar |
| `apps/web/src/components/ui/*.tsx` | Design system — não tocar |

---

## Tabelas Permitidas

| Tabela | Operação | Justificativa |
|---|---|---|
| `document_signatures` | CREATE | Nova tabela de assinaturas |

## Tabelas Proibidas

Todas as demais — assinatura é uma nova tabela, não altera schema existente.

---

## Endpoints

| Método | Path | Role | Ação |
|---|---|---|---|
| `POST` | `/api/signatures` | armeiro, admin_reserva, admin_global, usuario | Criar assinatura com TOTP |
| `GET` | `/api/signatures/:document_id` | armeiro, admin_reserva, admin_global, auditor | Verificar assinatura |
| `POST` | `/api/signatures/:id/revoke` | admin_global, superadmin | Revogar assinatura (retificação) |
| `GET` | `/api/verify/:document_id` | público (sem auth) | Verificar autenticidade pública |

---

## Migration

**Arquivo:** `supabase/migrations/20260620000004_document_signatures.sql`

```sql
-- 1. Criar tabela document_signatures
CREATE TABLE IF NOT EXISTS document_signatures (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  signer_id        UUID NOT NULL REFERENCES profiles(id),
  document_type    TEXT NOT NULL
    CHECK (document_type IN ('lending','handover','inventory','inventory_campaign')),
  document_id      UUID NOT NULL,
  document_hash    TEXT NOT NULL,   -- SHA-256 do conteúdo canônico do documento
  signature_proof  TEXT NOT NULL,   -- SHA-256(document_hash + signer_id + signed_at + ip)
  signed_at        TIMESTAMPTZ DEFAULT now() NOT NULL,
  ip               INET NOT NULL,
  user_agent       TEXT,
  totp_verified    BOOLEAN DEFAULT false,
  signature_level  INT DEFAULT 1
    CHECK (signature_level IN (1, 2, 3)),
  -- 1=TOTP, 2=WebAuthn(futuro), 3=Gov.br(futuro)
  revoked_at       TIMESTAMPTZ,
  revocation_reason TEXT,
  replaced_by      UUID REFERENCES document_signatures(id),
  created_at       TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 2. RULE de imutabilidade (mais forte que RLS)
CREATE RULE no_update_signatures AS ON UPDATE TO document_signatures DO INSTEAD NOTHING;
CREATE RULE no_delete_signatures AS ON DELETE TO document_signatures DO INSTEAD NOTHING;

-- EXCEÇÃO: revogação é feita via coluna revoked_at
-- Como UPDATE está bloqueado por RULE, a revogação usa INSERT de novo documento
-- com replaced_by apontando para o original, e o original recebe replaced_by via
-- stored function que usa SET LOCAL para bypass (apenas superadmin via BFF)

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_signatures_document ON document_signatures(document_type, document_id);
CREATE INDEX IF NOT EXISTS idx_signatures_signer ON document_signatures(signer_id);
CREATE INDEX IF NOT EXISTS idx_signatures_tenant ON document_signatures(tenant_id);

-- 4. RLS
ALTER TABLE document_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_signatures" ON document_signatures
  USING (tenant_id = (auth.jwt()->'app_metadata'->>'tenant_id')::uuid);
```

---

## Lógica de Hash Documental

**Arquivo:** `apps/bff/src/lib/document-hash.ts`

```typescript
import { createHash } from "crypto";

interface DocumentContent {
  document_type: string;
  document_id: string;
  data: Record<string, unknown>;
}

export function hashDocument(content: DocumentContent): string {
  const sorted = JSON.stringify(content, Object.keys(content).sort());
  return createHash("sha256").update(sorted, "utf8").digest("hex");
}
```

**Arquivo:** `apps/bff/src/lib/signature-proof.ts`

```typescript
import { createHash } from "crypto";

interface SignatureProofParams {
  document_hash: string;
  signer_id: string;
  signed_at: string;   // ISO string
  ip: string;
}

export function computeSignatureProof(params: SignatureProofParams): string {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  return createHash("sha256").update(sorted, "utf8").digest("hex");
}
```

---

## Fluxo de Assinatura (Nível 1 — TOTP)

```
1. Cliente: POST /api/signatures
   Body: { document_type, document_id, totp_code }
   Header: x-csrf-token

2. BFF: validar sessão (authMiddleware)
3. BFF: validar role (roleGuard)
4. BFF: buscar documento no banco (verificar que pertence ao tenant)
5. BFF: computar conteúdo canônico do documento
6. BFF: computar document_hash = hashDocument(conteúdo)
7. BFF: validar TOTP via totp_secrets (anti-replay)
8. BFF: computar signature_proof = computeSignatureProof({hash, signer, ts, ip})
9. BFF: INSERT em document_signatures
10. BFF: INSERT em audit_events (action="signature.created")
11. BFF: retornar { signature_id, document_hash, signed_at }
```

---

## Rota Pública de Verificação

**Arquivo:** `apps/web/src/app/v/[document_id]/page.tsx`

- Sem AuthGuard (público)
- Recebe `document_id` da URL
- Recebe `hash` da querystring (opcional, para verificação adicional)
- Chama `GET /api/verify/:document_id`
- Exibe: tipo do documento, signatários, data, status (válido/revogado/não encontrado)
- NÃO exibe dados sensíveis do documento
- QR Code de verificação gerado nos PDFs: `https://[dominio]/v/{id}?hash={hash}`

---

## Retificação (Fluxo de Documento Assinado com Erro)

Documento assinado NÃO pode ser alterado via UPDATE — RULE bloqueia.

**Processo de retificação:**
1. Criar novo documento com conteúdo corrigido
2. Criar nova assinatura para o novo documento
3. Marcar assinatura original como revogada: INSERT de nova assinatura com `replaced_by = id_original`
4. Marcar novo documento com `replaces = id_original`
5. INSERT em audit_events com action="signature.revoked" e metadata com motivo
6. PDF original arquivado com marca d'água "RETIFICADO" (Fase 5+)

**NUNCA:** UPDATE em document_signatures ou no documento original.

---

## Testes E2E

**Arquivo:** `apps/web/e2e/signatures.spec.ts`  
**Projeto:** `signature-suite`

| ID | Teste | Critério |
|---|---|---|
| SIG01 | Assinar com TOTP válido | document_signatures +1; audit_event criado |
| SIG02 | Assinar com TOTP inválido | 400; nenhuma assinatura criada |
| SIG03 | UPDATE direto em document_signatures | RULE bloqueia — 0 rows affected |
| SIG04 | DELETE direto em document_signatures | RULE bloqueia — 0 rows affected |
| SIG05 | Retificação preserva histórico | Assinatura original com replaced_by; nova criada |
| SIG06 | Verificação pública `/v/[id]` retorna status correto | 200 com validade; sem dados sensíveis |

---

## Testes de Segurança

| ID | Cenário | Resultado esperado |
|---|---|---|
| SEC-4-01 | Assinar sem TOTP configurado | 400 |
| SEC-4-02 | TOTP já usado (anti-replay) | 400 |
| SEC-4-03 | Hash adulterado na URL de verificação | Status "inválido" |
| SEC-4-04 | Assinar documento de outro tenant | 404 ou 403 (documento não encontrado) |
| SEC-4-05 | UPDATE forjado em document_signatures | RULE bloqueia |

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
pnpm test:e2e --project=signature-suite     # NOVA
```

---

## Critérios de Aceite

| # | Critério | Bloqueio? |
|---|---|---|
| CA01 | SIG01: assinar com TOTP válido → assinatura criada | ✅ BLOQUEIO |
| CA02 | SIG02: TOTP inválido → 400, nenhuma assinatura | ✅ BLOQUEIO |
| CA03 | SIG03/SIG04: UPDATE/DELETE bloqueados | ✅ BLOQUEIO |
| CA04 | SIG06: verificação pública correta | ✅ Sim |
| CA05 | SIG05: retificação preserva histórico | ✅ Sim |
| CA06 | Regressão completa verde | ✅ BLOQUEIO |
| CA07 | audit_event para cada assinatura | ✅ Sim |

---

## Validação sob Estresse — Assinatura

1. Documento assinado → hash gerado e verificável
2. Retentativa com mesmo TOTP → anti-replay bloqueia
3. Documento assinado → UPDATE bloqueado pela RULE
4. Retificação → novo documento + assinatura revogada + audit_event
5. TOTP inválido → 400, sem assinatura
6. TOTP expirado (anti-replay) → 400, sem assinatura
7. Verificação pública → status correto sem dados sensíveis
8. Hash adulterado na URL → "documento inválido"

---

## Definition of Done da Fase 4

### 1. Critérios Funcionais
- [ ] Assinar documento com TOTP funciona
- [ ] Rota pública de verificação funcional
- [ ] Retificação cria novo documento e invalida original

### 2. Critérios Técnicos
- [ ] Build passa
- [ ] Typecheck passa
- [ ] Lint passa
- [ ] Migration aplicada

### 3. Critérios de Segurança
- [ ] RULE SQL bloqueia UPDATE/DELETE em document_signatures ✅ BLOQUEIO
- [ ] TOTP anti-replay funcionando
- [ ] Assinatura de documento de outro tenant bloqueada

### 4. Auditoria
- [ ] Toda assinatura gera audit_event com action="signature.created"
- [ ] Retificação gera audit_event com action="signature.revoked"

### 5. Multi-tenant
- [ ] document_signatures filtrado por tenant_id

### 6. RBAC
- [ ] roleGuard em endpoints de assinatura

### 7. UI
- [ ] Rota pública `/v/[id]` sem auth guard
- [ ] Mobile responsiva

### 8. Performance
- [ ] Hash computado em < 10ms
- [ ] POST /api/signatures responde em < 1s

### 9. Regressão
- [ ] `signature-suite`: 6/6 passando
- [ ] Fases anteriores: todos passando

### 10. Evidências
- [ ] Screenshot `signature-suite: 6/6 passed`
- [ ] Output `pnpm typecheck` sem erros
- [ ] Verificação: UPDATE em document_signatures retorna 0 rows affected
- [ ] Relatório em `docs/enterprise/reports/phase-4-final-report.md`

---

*Fase 4 — Assinatura Eletrônica v1.0 — 2026-06-20*
