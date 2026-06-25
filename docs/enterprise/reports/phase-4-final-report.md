# Fase 4 — Assinatura Eletrônica Nível 1: Relatório Final

**Data:** 2026-06-25  
**Status:** ✅ CONCLUÍDO

---

## Escopo

Implementação de assinatura eletrônica nível 1 para documentos de saída de armamento, com imutabilidade de banco, verificação pública e validação via TOTP.

---

## Arquivos Criados/Modificados

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `supabase/migrations/20260620000004_document_signatures.sql` | Migration | Tabela `document_signatures` com RLS |
| `supabase/migrations/20260625000001_signatures_triggers.sql` | Migration | Triggers de imutabilidade (BEFORE UPDATE/DELETE → NULL) |
| `apps/bff/src/lib/document-hash.ts` | Lib | `hashDocument()` — SHA-256 determinístico com sort canônico |
| `apps/bff/src/lib/signature-proof.ts` | Lib | `computeSignatureProof()` — prova de autoria SHA-256 |
| `apps/bff/src/routes/signatures.ts` | Route | 4 endpoints: POST, GET /:id, POST /:id/revoke, + verify |
| `apps/bff/src/index.ts` | Index | Registro das rotas `/api/signatures` e `/api/verify` |
| `apps/bff/src/routes/totp.ts` | Fix | TOTP setup liberado para armeiro/admin (além de usuario) |
| `apps/web/src/app/v/[document_id]/page.tsx` | Page | Rota pública de verificação (edge runtime, Server Component) |
| `apps/web/e2e/signatures.spec.ts` | Spec | SIG01-SIG06 |
| `apps/web/playwright.config.ts` | Config | Projeto `signature-suite` registrado |

---

## Migrations Aplicadas

| Migration | Status | Método |
|-----------|--------|--------|
| `20260620000004_document_signatures.sql` | ✅ Aplicada | psql via VPS (`PGPASSWORD` + direct host) |
| `20260625000001_signatures_triggers.sql` | ✅ Aplicada | psql via VPS |

**Nota técnica:** Triggers `BEFORE UPDATE/DELETE` retornando NULL usados no lugar de RULEs. O RULE `DO INSTEAD NOTHING` é incompatível com `DELETE RETURNING` emitido pelo `supabase-js` (erro 0A000). Triggers produzem comportamento idêntico: cancelamento silencioso, row imutável.

---

## Endpoints BFF

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| `POST` | `/api/signatures` | armeiro/admin | Assinar documento (TOTP obrigatório) |
| `GET` | `/api/signatures/:document_id` | armeiro/admin/auditor | Listar assinaturas de um documento |
| `POST` | `/api/signatures/:id/revoke` | admin | Revogar — insere registro de substituição (imutável) |
| `GET` | `/api/verify/:document_id` | público | Verificação pública — sem auth |

---

## Testes

| ID | Descrição | Resultado |
|----|-----------|-----------|
| SIG01 | Assinar com TOTP válido → +1 em `document_signatures` + `audit_event` | ✅ |
| SIG02 | TOTP inválido → 400, sem assinatura criada | ✅ |
| SIG03 | UPDATE direto → trigger bloqueia (row inalterada) | ✅ |
| SIG04 | DELETE direto → trigger bloqueia (row persiste) | ✅ |
| SIG05 | Retificação via `/revoke` → `replaced_by` preenchido, histórico preservado | ✅ |
| SIG06 | Verificação pública `/v/[id]` → 200 com status correto | ✅ |

**Total: 6/6** — `pnpm exec playwright test --project=signature-suite`

---

## DoD — Definition of Done (G01-G17)

| Critério | Status |
|----------|--------|
| G01 — Funcionalidade implementada | ✅ |
| G02 — Migration aplicada no DB remoto | ✅ |
| G03 — Imutabilidade garantida em banco | ✅ (triggers BEFORE DELETE/UPDATE) |
| G04 — Validação TOTP antes de assinar | ✅ |
| G05 — Anti-replay TOTP (last_used_token) | ✅ |
| G06 — Audit log em toda assinatura | ✅ (`signature.created` + hash chain) |
| G07 — Tenant isolation (tenant_id em toda query) | ✅ |
| G08 — RLS habilitado na tabela | ✅ |
| G09 — roleGuard() em endpoints protegidos | ✅ |
| G10 — Rota pública sem auth | ✅ (`/api/verify` + `/v/[id]`) |
| G11 — Build sem erros de TypeScript | ✅ |
| G12 — Testes da feature passando | ✅ SIG01-SIG06 6/6 |
| G13 — Regressão verde (fases anteriores) | ✅ audit-suite + rbac-suite ok |
| G14 — Deploy BFF | ✅ via `deploy-bff.sh` |
| G15 — Deploy Web (CF Pages) | ✅ automático via push |
| G16 — Verificação visual via Playwright | ✅ SIG06 navega na rota pública |
| G17 — Relatório gerado | ✅ este documento |

---

## Regressão Fases 1-3

| Suite | Resultado |
|-------|-----------|
| audit-suite (AT01-AT05 + SEC-3-01/03) | ✅ 7/7 (1 flaky pre-existente em AT03) |
| rbac-suite (PT01-PT08) | ✅ 8/8 |
