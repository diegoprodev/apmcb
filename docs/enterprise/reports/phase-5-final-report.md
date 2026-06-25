# APMCB — Fase 5 Enterprise: Relatório Final de Validação

**Data:** 2026-06-25  
**Branch:** main  
**Commit final:** `777e4b9`  

---

## Resumo Executivo

A Fase 5 Enterprise está **implementada, testada e validada**. Todos os 29 testes dos 4 suites passam sem falhas nem skips. Os bloqueios absolutos de integridade de posse (IT03–IT06) estão ativos via trigger PostgreSQL e confirmados por E2E.

---

## Resultados por Suite

| Suite | Testes | Resultado | Tempo |
|-------|--------|-----------|-------|
| `saida-suite` (SD01–SD06) | 6/6 | ✅ VERDE | 19s |
| `cautelamento-suite` (CT01–CT08) | 8/8 | ✅ VERDE | 24s |
| `item-integrity-suite` (IT01–IT09) | 9/9 | ✅ VERDE | 22s |
| `signature-suite` (SIG01–SIG06) | 6/6 | ✅ VERDE | 33s |
| **TOTAL** | **29/29** | **✅ VERDE** | ~98s |

---

## Cobertura Funcional

### Saída Diária Enterprise (`/api/saidas`)
- **SD01** — Emissão de saída de item disponível → 201 + `status_operacional=em_saida`
- **SD02** — Segunda saída do mesmo item → 409 Conflict
- **SD03** — Assinatura do armeiro com TOTP → `document_signatures` + `audit_events`
- **SD04** — Confirmação do militar (TOTP/biometria) → `status=ativa`
- **SD05** — Devolução → `status=devolvida` + item volta para `disponivel`
- **SD06** — Machine de estados: `status_operacional` consistente

### Cautela Permanente (`/api/cautelamentos`)
- **CT01** — Emissão de cautela → 201 + `status=cautelado`
- **CT02** — Cautela de item em saída → trigger P0001 → 409
- **CT03** — Cautela de item já cautelado → 409
- **CT04** — Assinatura armeiro (TOTP) → `document_signatures+1`
- **CT05** — Assinatura militar (TOTP) → aceita responsabilidade
- **CT06** — Substituição → `antiga=substituida; nova=ativa; vínculo preservado`
- **CT07** — Encerramento → item `disponivel`, `holder=NULL`
- **CT08** — Histórico por item ordenado por `data_emissao`

### BLOQUEIO ABSOLUTO — Integridade de Posse
- **IT01** — Saída de disponível → aceita ✅
- **IT02** — Cautela de disponível → aceita ✅
- **IT03** 🔴 — Segunda saída de `em_saida` → P0001 → 409 ✅
- **IT04** 🔴 — Cautela de `em_saida` → P0001 → 409 ✅
- **IT05** 🔴 — Saída de `cautelado` → P0001 → 409 ✅
- **IT06** 🔴 — Segunda cautela de `cautelado` → P0001 → 409 ✅
- **IT07** — Devolução → `disponivel + holder=NULL + active_lending=NULL` ✅
- **IT08** — Encerramento → `disponivel + active_cautelamento=NULL` ✅
- **IT09** 🔴 — Item de outro tenant → RLS → 404 ✅

### Assinatura Eletrônica (regressão Fase 4)
- **SIG01–SIG06** — TOTP, anti-replay, imutabilidade por RULE SQL, retificação, verificação pública — todos verdes

---

## Bugs Corrigidos Nesta Fase

| Commit | Problema | Fix |
|--------|----------|-----|
| `55af2b4` | `ip inet NOT NULL` rejeitava string `"unknown"` | Fallback para `"127.0.0.1"` em saidas/cautelamentos/signatures |
| `55af2b4` | `fullyParallel: true` com 2 workers → 2 `beforeAll` simultâneos corrompiam estado | `test.describe.configure({ mode: "serial" })` em todas as suites F5 |
| `777e4b9` | `document_signatures_document_type_check` rejeitava `"saida"`/`"cautelamento"` | Mapeado para `"lending"` (saídas) e `"handover"` (cautelamentos) |
| spec | SD05 dependia de segundo item disponível (race condition) | Redesenhado para usar `saidaId` principal do ciclo SD01→SD04 |

---

## Arquitetura Implementada

```
POST /api/saidas                    → cria lending + seta em_saida (trigger)
POST /api/saidas/:id/sign-armeiro   → TOTP/biometria → document_signatures (type=lending)
POST /api/saidas/:id/confirm        → TOTP/biometria → status=ativa
PATCH /api/saidas/:id/return        → status=devolvida + item→disponivel (trigger)

POST /api/cautelamentos             → cria cautelamento + seta cautelado (trigger)
POST /api/cautelamentos/:id/sign-armeiro  → TOTP/biometria → doc_sig (type=handover)
POST /api/cautelamentos/:id/sign-militar  → TOTP/biometria → doc_sig (type=handover)
POST /api/cautelamentos/:id/substitute   → substitui cautela mantendo histórico
POST /api/cautelamentos/:id/return       → encerramento + item→disponivel
GET  /api/cautelamentos/history/item/:id → histórico de item
```

**Trigger de bloqueio:** `_validate_item_possession` + `fn_validate_item_transition` (BEFORE UPDATE em `material_items`) — rejeita transições inválidas com `RAISE EXCEPTION 'P0001'`, propagadas como 409 pelo BFF.

**Assinatura dual:** armeiro sempre usa TOTP ou biometria; militar idem. Ambas geram registro em `document_signatures` com hash, proof, ip inet e audit_event.

---

## Segurança

- Service role key: apenas no BFF (nunca no cliente)
- TOTP: anti-replay via `last_used_token` + rate limit 5 tentativas/15min
- Biometria: challenge FIDO2 via BFF; nunca dados brutos no cliente
- RLS: `material_items` isolado por tenant — IT09 confirma bloqueio
- `document_signatures`: imutável via RULE SQL (UPDATE/DELETE bloqueados na camada DB)

---

## Pendente (Fase 6)

- [ ] Item status display com busca inteligente (disponivel / cautelado / em_posse / manutenção / extraviado / vencido / danificado)
- [ ] Filtros e busca por nome/série nos relatórios
- [ ] Spec E2E para a feature de busca/status de material
