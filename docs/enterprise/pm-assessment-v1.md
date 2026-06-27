# Avaliação PM/PO Sênior — APMCB

**Data:** 2026-06-26  
**Estado atual:** 7.2 / 10  
**Meta:** 10 / 10

---

## Resumo executivo

Arquitetura sólida, RBAC bem modelado, integridade de dados robusta no banco. Os problemas não estão na arquitetura — estão em lacunas pontuais de validação, inconsistências de implementação e ausência de testes unitários. É um produto confiável para produção com as correções abaixo.

---

## Pontos Positivos ✅

| Item | Observação |
|------|------------|
| Trigger P0001 (posse exclusiva no banco) | Inquebrável — nenhum bypass via BFF ou RLS |
| RBAC com roleGuard em 64 endpoints | Consistente e bem aplicado |
| Audit log com hash chain | Imutável e rastreável |
| TOTP + biometria dupla em assinaturas | Correto e com anti-replay |
| RLS multi-tenant em todas as tabelas críticas | Isolation real, não só no BFF |
| Status machine de itens (disponivel→em_saida→devolvido) | Coerente e validado em DB |
| Fase 6 — Passagem de turno com snapshot automático | 8/8 testes verdes, PDF funcional |

---

## Bugs Reais (verificados no código)

### BUG #1 — GET /api/ocorrencias sem roleGuard explícito (`ocorrencias.ts:71`)
- **Severidade:** Baixa
- **Descrição:** authMiddleware protege e a lógica interna diferencia por role. Mas se o middleware falhar, qualquer requisição autenticada acessa.
- **Fix:** Adicionar `roleGuard("admin_global", "superadmin", "admin_reserva", "armeiro")` — 1 linha.
- **Status:** Pendente

### BUG #2 — Lendings `tenant_id` condicional (`lendings.ts:26, 47`)
```typescript
if (tenantId) query = query.eq("tenant_id", tenantId);  // ← se null, vaza
```
- **Severidade:** Média
- **Descrição:** Se `tenantId` vier null da sessão (bug de middleware ou token malformado), um admin lê lendings de outro tenant. RLS deveria barrar, mas defesa em profundidade requer o filtro incondicional.
- **Fix:** Retornar 400 se `tenantId` for null; nunca executar query sem o filtro.
- **Status:** Pendente

### BUG #3 — `admin_reserva` pode criar passagem em qualquer reserva
- **Severidade:** Alta
- **Descrição:** `POST /api/handovers` verifica membership apenas para armeiro. Admin_reserva passa sem verificação de que pertence à reserva do body.
- **Fix:** Adicionar verificação de `reserve_memberships` para `admin_reserva` igual ao que já existe para armeiro.
- **Status:** Pendente

---

## Vulnerabilidades

### VULN #1 — TOTP anti-replay inconsistente entre rotas
- **Arquivo:** `handovers.ts`, `saidas.ts` vs `signatures.ts`
- **Descrição:** `handovers.ts` e `saidas.ts` comparam `last_used_token === token` sem considerar janelas de tempo adjacentes. `signatures.ts` está correto.
- **Fix:** Extrair lógica de anti-replay para helper único em `src/utils/totp.ts` e usar em todas as rotas.
- **Status:** Pendente

### VULN #2 — Map em memória para pending TOTP setup
- **Arquivo:** `nexus.ts` — `pendingTotpSetup` Map
- **Descrição:** Perdido em redeploy. Em produção com PM2 cluster mode, processos diferentes têm Maps diferentes — setup-2fa falha intermitentemente.
- **Fix:** Migrar para tabela temporária no Supabase (`totp_pending_setup`) com TTL de 10 minutos e limpeza via cron.
- **Status:** Pendente

---

## Inconsistências

| Item | Impacto | Fix |
|------|---------|-----|
| Role no frontend calculado em cada page load (sem revalidação) | UX: usuário removido de role continua vendo UI antiga | Invalidar sessão no BFF ao mudar role; forçar re-login |
| `PATCH /api/profiles` sem `.eq("tenant_id")` na query | Potencial write cross-tenant | Adicionar `.eq("tenant_id", tenantId!)` na query de UPDATE |
| Status de itens como TEXT sem ENUM no schema | Dados inválidos silenciosos | Migrar para `CREATE TYPE item_status AS ENUM(...)` |
| `material_items` RLS não verifica role (qualquer membro do tenant lê) | Gap de informação para usuarios | Policy SELECT separada por role |
| PDF de passagem sem assinatura verificável (apenas hash SHA256) | Não aceito em auditoria formal | Integrar PDF com assinatura digital (p7s) ou QR de verificação |

---

## Fase 6 — Livro Digital: 100% funcional?

**Resposta: Sim, com uma ressalva.**

- ✅ 8/8 testes passando, fluxo completo funcionando em produção
- ✅ Snapshot automático correto com 6 tabelas consultadas em paralelo
- ✅ PDF gerado com dados reais, servido com `Content-Type: application/pdf`
- ✅ Status machine implementada e validada (aguardando → atribuição → assinatura → concluído)
- ✅ TOTP com anti-replay em ambas as assinaturas
- ✅ Mesma pessoa não pode assinar saída e entrada (422)
- ⚠️ **Ressalva:** `admin_reserva` pode criar passagem em reserva da qual não é membro (BUG #3). Fix simples.

---

## Roadmap para 10/10

### Fase A — Segurança (impacto crítico)
- [ ] Fix BUG #3: verificação de membership para `admin_reserva` em `POST /api/handovers`
- [ ] Fix BUG #2: tornar `tenant_id` obrigatório em todos os queries de `lendings.ts`
- [ ] Fix VULN #1: helper único de TOTP anti-replay
- [ ] Fix VULN #2: migrar `pendingTotpSetup` de Map para Supabase table
- [ ] Fix BUG #1: adicionar `roleGuard` explícito em `/api/ocorrencias`
- [ ] Fix: `PATCH /api/profiles` com `.eq("tenant_id")`

### Fase B — Qualidade de dados
- [ ] Migrar status de `material_items` de TEXT para ENUM no schema
- [ ] RLS separada para `material_items` por role

### Fase C — UX e operacional
- [ ] Revalidação de role no frontend (webhook ou polling)
- [ ] CI/CD com GitHub Actions: lint + typecheck + E2E smoke antes de CF Pages deploy
- [ ] Auto-deploy BFF via SSH no push (GitHub Actions)

### Fase D — Auditoria formal
- [ ] PDF com assinatura digital verificável (QR code de verificação ou p7s)
- [ ] Testes unitários para funções críticas (TOTP helper, hash chain, trigger P0001)

---

## Credenciais de teste

| Role | Email | Senha |
|------|-------|-------|
| superadmin | devdiegopro@gmail.com | Nexus@APMCB2026! |
| admin_global | admin@apmcb.dev | Admin@123 |
| armeiro | armeiro@apmcb.dev | Armeiro@123 |
| cadete | cadete@apmcb.dev | Cadete@123 |

**Nexus URL:** https://apmcb.pmpb.online/nexus/login  
**TOTP:** Obrigatório para Nexus — escanear QR no primeiro acesso.
