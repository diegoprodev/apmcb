# Harness Loop — Fases 4 e 5 (Assinatura Eletrônica + Saída/Cautela Enterprise)
# Projeto: c:\projetos\apmcb
# Uso: /loop <este prompt>
# Comportamento: a cada iteração, detecta o estado real, executa 1 passo, valida, reporta.

## REGRA CANÔNICA
IMPLEMENTADO NÃO É ENTREGUE.
ENTREGUE = implementado + testado + validado + regressão verde + relatório gerado.
Se qualquer critério de BLOQUEIO falhar → parar, reportar, aguardar.

## CONTEXTO
Fases 1-3 concluídas (TT01-14, PT01-08, AT01-05 passando).
Roadmap: docs/enterprise/02-enterprise-roadmap.md
Harnesses: docs/enterprise/phases/phase-4-*.md e phase-5-*.md
DoD: docs/enterprise/07-canonical-definition-of-done.md

## ESTADO A DETECTAR A CADA ITERAÇÃO

### PASSO 1 — Ler o estado atual (sempre fazer isso primeiro)
Verifique em ordem:

FASE 4 — Assinatura Eletrônica:
[F4-1] Migration `20260620000004_document_signatures.sql` existe?
        → Supabase MCP: list_migrations | Glob supabase/migrations/*signatures*
[F4-2] `apps/bff/src/lib/document-hash.ts` existe com `hashDocument()`?
[F4-3] `apps/bff/src/lib/signature-proof.ts` existe com `computeSignatureProof()`?
[F4-4] `apps/bff/src/routes/signatures.ts` existe com 4 endpoints?
[F4-5] `apps/web/src/app/v/[document_id]/page.tsx` existe (rota pública)?
[F4-6] `apps/web/e2e/signatures.spec.ts` existe com SIG01-SIG06?
[F4-7] `signature-suite` registrada em `playwright.config.ts`?
[F4-8] Testes SIG01-SIG06 passando?
        → Run: cd apps/web && pnpm test:e2e --project=signature-suite
[F4-9] Regressão completa verde (audit-suite + fases anteriores)?
[F4-10] Relatório `docs/enterprise/reports/phase-4-final-report.md` existe?

FASE 5 — Saída Diária + Cautela Permanente (só iniciar se F4-10 = ✅):
[F5-1] Migration `20260620000005_saida_enterprise.sql` existe?
[F5-2] Migration `20260620000005b_cautelamentos.sql` existe?
[F5-3] `apps/bff/src/routes/cautelamentos.ts` existe com 10 endpoints?
[F5-4] `apps/bff/src/lib/pdf/saida-pdf.ts` existe?
[F5-5] `apps/bff/src/lib/pdf/cautela-pdf.ts` existe?
[F5-6] `apps/web/src/app/(dashboard)/reserva/cautelas/page.tsx` existe?
[F5-7] `apps/web/e2e/saidas.spec.ts` com SD01-SD06 existe?
[F5-8] `apps/web/e2e/cautelamentos.spec.ts` com CT01-CT08 existe?
[F5-9] `apps/web/e2e/item-integrity.spec.ts` com IT01-IT09 existe?
[F5-10] Testes saida-suite (SD01-SD06) passando?
[F5-11] Testes cautelamento-suite (CT01-CT08) passando?
[F5-12] Testes item-integrity-suite (IT01-IT09) passando? ← BLOQUEIO
[F5-13] Relatório `docs/enterprise/reports/phase-5-final-report.md` existe?

## LÓGICA DE EXECUÇÃO

Com base nos checks acima, execute EXATAMENTE UM dos passos abaixo:

### Se F4-1 = ❌ → PASSO: Criar migration document_signatures
- Ler harness fase 4 (migration section): docs/enterprise/phases/phase-4-electronic-signature.md
- Aplicar via Supabase MCP execute_sql com o SQL do harness
- Verificar via list_migrations
- Reportar resultado

### Se F4-2 = ❌ → PASSO: Criar document-hash.ts
- Criar apps/bff/src/lib/document-hash.ts com hashDocument()
- Implementação exata do harness (sort canônico + SHA-256)

### Se F4-3 = ❌ → PASSO: Criar signature-proof.ts
- Criar apps/bff/src/lib/signature-proof.ts com computeSignatureProof()
- Implementação exata do harness

### Se F4-4 = ❌ → PASSO: Criar routes/signatures.ts
- Criar com 4 endpoints: POST /api/signatures, GET /api/signatures/:document_id,
  POST /api/signatures/:id/revoke, GET /api/verify/:document_id
- Registrar em apps/bff/src/index.ts
- authMiddleware + roleGuard em todos exceto /api/verify (público)
- Validação Zod para cada endpoint
- auditLog() em POST /api/signatures (action="signature.created")
- Validar TOTP antes de criar assinatura (anti-replay via totp_secrets.last_used_token)

### Se F4-5 = ❌ → PASSO: Criar rota pública /v/[document_id]
- Criar apps/web/src/app/v/[document_id]/page.tsx
- Criar layout.tsx sem auth guard
- Chama GET /api/verify/:document_id
- Exibe: tipo, signatários, data, status (válido/revogado/não encontrado)
- NÃO exibe dados sensíveis
- Institucional dark, mobile-first

### Se F4-6 = ❌ → PASSO: Criar e2e/signatures.spec.ts
- SIG01: assinar com TOTP válido → document_signatures+1 + audit_event
- SIG02: TOTP inválido → 400, sem assinatura
- SIG03: UPDATE direto → RULE bloqueia (0 rows affected)
- SIG04: DELETE direto → RULE bloqueia (0 rows affected)
- SIG05: retificação preserva histórico (replaced_by preenchido)
- SIG06: verificação pública /v/[id] → 200 com status correto

### Se F4-7 = ❌ → PASSO: Registrar signature-suite em playwright.config.ts
- Adicionar projeto signature-suite com testMatch: ["e2e/signatures.spec.ts"]

### Se F4-8 = ❌ → PASSO: Debug e fix da suite signature-suite
- Rodar: cd apps/web && pnpm test:e2e --project=signature-suite
- Analisar falhas
- Corrigir (BFF ou spec)
- Rodar novamente
- BLOQUEIO: SIG01, SIG02, SIG03 são críticos — não avançar se falharem

### Se F4-9 = ❌ → PASSO: Corrigir regressão
- Identificar qual suite falhou
- Corrigir sem alterar comportamento das fases anteriores
- Rodar a suite específica + audit-suite + multitenant-suite + rbac-suite

### Se F4-10 = ❌ e F4-1 a F4-9 = ✅ → PASSO: Encerrar Fase 4
- Criar docs/enterprise/reports/phase-4-final-report.md
- Seguir template de docs/enterprise/07-canonical-definition-of-done.md
- Preencher: escopo, arquivos, migrations, endpoints, testes, build, DoD checklist
- Atualizar CHANGELOG.md com entrada da Fase 4
- Atualizar docs/enterprise/02-enterprise-roadmap.md: Fase 4 = ✅ Concluído
- Commit: "feat(fase4): Assinatura Eletrônica Nível 1 — SIG01-SIG06 passando"
- Push: git push origin main
- Deploy BFF via SSH:
    ssh -i /c/Users/dgapc/.ssh/apmcb_hetzner root@91.99.113.89 "bash /opt/apmcb/scripts/deploy-bff.sh"
- Reportar: "FASE 4 CONCLUÍDA. Iniciando Fase 5 na próxima iteração."

### Se F4-10 = ✅ e F5-1 = ❌ → PASSO: Criar migration saida_enterprise
- Ler harness fase 5, seção Migration 1: docs/enterprise/phases/phase-5-electronic-custody.md
- Aplicar via Supabase MCP execute_sql
- ATENÇÃO: `status_legacy` já existe de Fase 1 — nova coluna é `status` com valores canônicos

### Se F4-10 = ✅ e F5-2 = ❌ → PASSO: Criar migration cautelamentos
- Ler harness fase 5, seção Migration 2
- Aplicar via Supabase MCP execute_sql
- CRÍTICO: incluir trigger de integridade de posse em material_items
  (item em_saida ou cautelado → RAISE EXCEPTION P0001 em nova saída/cautela)

### Se F5-3 = ❌ → PASSO: Criar routes/cautelamentos.ts com 10 endpoints
- Ver harness fase 5, seção Endpoints — Cautela Permanente
- Transação atômica obrigatória: validar item → criar cautelamento → UPDATE material_items
- auditLog() em todas as ações (cautelamento.created, returned, substituted)

### Se F5-4 = ❌ → PASSO: Criar pdf/saida-pdf.ts
- Verificar qual lib de PDF está disponível: cat apps/bff/package.json
- Conteúdo mínimo: identificação da saída, item, militar, armeiro, data, QR code da URL /v/[id]

### Se F5-5 = ❌ → PASSO: Criar pdf/cautela-pdf.ts
- Conteúdo obrigatório: exatamente o template descrito no harness (Termo de Cautela)
- Hash documental, signatários, QR Code de /v/[id]

### Se F5-6 = ❌ → PASSO: Criar /reserva/cautelas/page.tsx
- Separada de /reserva/saidas/
- Badge de status próprio para cautelas
- Listar cautelas ativas do armeiro/admin com card por item

### Se F5-7 = ❌ → PASSO: Criar e2e/saidas.spec.ts (SD01-SD06)
### Se F5-8 = ❌ → PASSO: Criar e2e/cautelamentos.spec.ts (CT01-CT08)
### Se F5-9 = ❌ → PASSO: Criar e2e/item-integrity.spec.ts (IT01-IT09)
- Registrar saida-suite, cautelamento-suite, item-integrity-suite em playwright.config.ts

### Se F5-10, F5-11 ou F5-12 = ❌ → PASSO: Debug e fix
- Priorizar item-integrity-suite (BLOQUEIO absoluto)
- IT03-IT06 testam trigger de banco — verificar se migration foi aplicada
- NUNCA avançar se item em em_saida aceitar nova saída

### Se F5-1 a F5-12 = ✅ e F5-13 = ❌ → PASSO: Encerrar Fase 5
- Criar docs/enterprise/reports/phase-5-final-report.md
- Atualizar CHANGELOG.md
- Atualizar roadmap: Fase 5 = ✅ Concluído
- Commit + push + deploy BFF
- Reportar: "FASES 4 E 5 CONCLUÍDAS. Loop encerrado."
- NÃO agendar próxima iteração.

### Se F4-10 = ✅ e F5-13 = ✅ → LOOP ENCERRADO
- Reportar sumário final: suites passando, relatórios gerados, deploy feito
- NÃO continuar.

## REGRAS DO LOOP

1. SEMPRE detectar estado antes de qualquer ação
2. NUNCA assumir que algo foi feito — verificar em artefatos reais (arquivos, banco, testes)
3. NUNCA implementar dois passos em uma iteração (exceto se o segundo leva < 30s e não tem risco)
4. NUNCA alterar migrations já aplicadas — criar nova migration
5. NUNCA alterar suites de fases anteriores (1-3)
6. SEMPRE rodar o teste da feature antes de declarar passo concluído
7. SEMPRE incluir auditLog() em toda ação sensível (obrigação de Fase 3)
8. SEMPRE incluir tenant_id em toda query nova
9. SEMPRE incluir roleGuard() em todo endpoint protegido
10. Se um teste falha após 2 tentativas de fix → PARAR e reportar bloqueio ao usuário

## RELATÓRIO A CADA ITERAÇÃO (resposta obrigatória)

ITERAÇÃO N — [hora]
Estado detectado:
  Fase 4: [lista F4-1 a F4-10 com ✅/❌]
  Fase 5: [lista F5-1 a F5-13 com ✅/❌ — apenas se F4 concluída]

Passo executado: [descrição]

Resultado: ✅ Sucesso / ❌ Bloqueio
[Evidência: output de teste ou trecho de código]

Próximo passo: [nome do próximo passo]
