# REMEDIATION_LEDGER — baseline 0 (HEAD `bf0aa0f`)

> Nada aqui foi corrigido. Cada item traz evidência verificável (arquivo:linha em `bf0aa0f`).
> Status: BACKLOG | READY | BLOCKED | WIP_EXTERNAL | WIP_INFRA | WIP_BIOMETRIA | BLOQUEADO_BFF |
> INCONCLUSIVO | DONE_VERIFIED.

---

## Parte A — Análises pedidas (modelo institucional)

### A.1 Modo Usuário (toggle) — como funciona hoje

| Pergunta | Resposta no código |
|---|---|
| Onde está | Front: `apps/web/src/hooks/use-user-menu-actions.ts:39` chama `POST ${BFF}/api/session/mode` direto. BFF: `apps/bff/src/routes/session.ts` (`/mode`). Proxy legado ainda ativo: `apps/web/src/app/api/mode/route.ts` (via Bearer). |
| Altera só a UI? | **Não.** Grava `activeMode="usuario"` + `originalRole` na **iron-session** (cookie selado, server-side). |
| Backend conhece o modo? | Sim. `middleware/auth.ts`: papel efetivo = `"usuario"` quando `session.activeMode==="usuario"` → `roleGuard` aplica de fato. |
| Altera claims/token Supabase? | Não. JWT Supabase e `profiles.role` ficam iguais → **RLS não sabe do modo** (irrelevante para o BFF, que usa service role; relevante para leituras SSR do web com JWT do usuário). |
| Estado da UI | Cookie `apmcb_mode` + `apmcb_role_info` (domínio `.pmpb.online`) lido por `app/(dashboard)/layout.tsx:259` e `reserva/layout.tsx:7` (redirect para `/efetivo`). Pode divergir da sessão (o próprio `middleware/auth.ts` limpa cookie stale). |
| Persistência | Por sessão/dispositivo (8 h, renovação deslizante). Não está no banco. |
| Reserva ativa muda? | **Não.** Em Modo Usuário, `session.reserveId` continua sendo a reserva que o armeiro administra. |
| Caminho Bearer do `/mode` | Popula sessão só com `userId/role/activeMode` — sem `tenantId`, `reserveId`, `sessionId`, `issuedAt`, `csrfToken` (`session.ts` fallback). Sessão resultante não é revogável individualmente. POTENCIAL. |

Status: FUNCIONAL COM LIMITAÇÕES (código integrado; sem evidência de execução nesta sessão — BLOQUEADO_BFF).

### A.2 Multi-reserva (armeiro / admin da reserva)

- **Identidade**: `profiles.id` (= `auth.users.id` ou `public.usuarios` on-prem).
- **Membership de tenant**: `tenant_memberships (tenant_id,user_id) UNIQUE` + `profiles.default_tenant_id` (fallback no login, `routes/auth.ts:148`). Bearer path pega `limit(1)` sem ordem → não determinístico para quem tiver 2 tenants.
- **Papel**: **um papel global** em `profiles.role` (`superadmin|admin_global|admin_reserva|armeiro|auditor|usuario`). É ele que `roleGuard` usa.
- **Reservas autorizadas**: `reserve_memberships (reserve_id,user_id) UNIQUE`, `role ∈ {admin_reserva, armeiro, auditor_reserva, usuario}`. **O papel da membership não define permissão**: só é usado como filtro "é staff? (`STAFF_RESERVE_ROLES`)". Ex.: `profiles.role=armeiro` com membership `admin_reserva` em A2 opera A2 **como armeiro**.
- **Armeiro/Admin em várias reservas**: **modelado no banco** (N linhas em `reserve_memberships`), com uma reserva ativa por vez.
- **Reserva ativa**: `profiles.active_reserve_id` (fonte do RLS e de `assert_actor_in_reserve`) espelhada em `session.reserveId` (fonte do BFF). Default no login: `lib/active-reserve.ts` (mantém atual → preferência mais usada → membership mais antiga). Troca: `POST /api/reserves/switch/:id` (`routes/reserves.ts`) exige membership para quem não é `admin_global/auditor`, grava DB + sessão atual.
- **Matriz**: `admin_global`/`auditor` sem reserva ativa veem o tenant inteiro (`lib/reserve-scope.ts`).
- **Lacunas**: ver R-11 (divergência sessão×DB entre dispositivos; remoção de membership não invalida sessão).

### A.3 Caso de segregação de funções (armeiro solicita para si e aprova)

| Passo | Código | Resultado previsto |
|---|---|---|
| 1. Armeiro entra em Modo Usuário | `POST /api/session/mode` | 200, papel efetivo `usuario` |
| 2. Solicita material | `POST /api/ssa/requests` (`roleGuard("usuario")`, `ssa.ts:230`); sem `reserve_id` usa `session.reserveId` (`ssa.ts:296`) = **a reserva que ele administra** | 201 |
| 3. Volta ao modo Armeiro | `POST /api/session/mode {staff}` | 200 |
| 4. Aprova | `PATCH /requests/:id/approve` (`ssa.ts:582-`): checa turno, tenant e estoque; **não compara `req.military_id` com o aprovador** | 200 |
| 5. Entrega | `PATCH /requests/:id/deliver` (`ssa.ts:884-`): **sem comparação**; cria `lendings` com `military_id = master_id = ele`, `auth_mode:"totp"` sem verificar código | 200 |

Nenhum `military_id !== userId` em `ssa.ts`, `lendings.ts`, `cautelamentos.ts` nem nas RPCs
`record_lending_batch`/`record_cautelamento_batch`. Na saída direta (`lendings.ts /identify`), o
armeiro pode se identificar com o próprio TOTP obtido em `GET /api/totp/code`.

**Classificação: [CONFLITO_CONFIRMADO] estaticamente**, execução **[BLOQUEADO_BFF]** (E1 em
`BLOCKERS.md`). Nota: armeiro se armar é legítimo pelo negócio; o conflito é **aprovar/entregar
a própria solicitação sem segundo ator ou registro de exceção**. A regra correta (bloquear,
exigir outro armeiro, ou permitir com marcação auditável) é **decisão de produto**, não técnica.

### A.4 Isolamento Tenant/Reserva — estado real

| Vetor | Mecanismo | Estado |
|---|---|---|
| Tenant A → Tenant B | BFF: `tenantId` da sessão em cada query (manual, service role). DB: RLS por tenant | Funciona nas rotas lidas, **exceto** `GET /dashboard/stats` (R-06). Padrão fail-open `if (tenantId)` em ~25 pontos (R-13) |
| A1 → B1 | idem tenant | idem |
| A1 → A2 sem autorização | BFF: `scopedReserveIds`/`canAccessResourceReserve`/`assertActorReserveAccess`/`requireActiveShift(...,reserve)` — **aplicados rota a rota** | Lacunas confirmadas: SSA approve/reject/deliver (R-05), `dashboard/command` (R-10), `sign-armeiro`/`sign-militar` e rota batch de cautela usam `requireActiveShift` sem reserva e checam só tenant (R-09), revoke de assinatura só tenant |
| IDs arbitrários do cliente | `reserve_id` do body usado em 53 pontos; alguns validados (lendings `assertActorReserveAccess`, RPC `assert_actor_in_reserve`) | Parcial — cada ponto precisa verificação individual (INCONCLUSIVO no agregado) |
| Service role | Sempre no BFF → RLS nunca protege o caminho da UI | Arquitetural; isolamento depende 100% do código de rota |
| RLS | SP1–SP10, dormente com flag off; CHANGELOG diz flag ligado no PMPB | INCONCLUSIVO (sem acesso ao DB) |
| Jobs/cron | `assert_actor_in_reserve` libera `p_actor_id IS NULL AND session_user='postgres'`; `expire_material_requests` chamado de dentro do deliver sem escopo | INCONCLUSIVO |

### A.5 Documentos / Hash / QR / TOTP — estado real

| Pergunta | Resposta |
|---|---|
| O que é hasheado (cautela) | `hashDocument({document_type:"handover", document_id: id ?? "new", data})` → por causa do replacer de `JSON.stringify`, **`data` vira `{}`**; o hash só depende de `document_type` e `document_id`. Cautela nova → sempre `"new"` → **mesmo hash para todas** (`1a7c0eab…ced9`). Confirmado por execução (P1). |
| O que é hasheado (`POST /api/signatures`) | Mesmo `hashDocument` sobre `document_data` **enviado pelo cliente** (não o registro do banco) — e o conteúdo é descartado de qualquer forma. |
| Handover | `makeDocHash` próprio em `handovers.ts`: `sha256(JSON.stringify(fields)).slice(0,32)` — hash de conteúdo, dependente da ordem de chaves, truncado a 128 bits. |
| Inventário | `sha256(docContent)` (`inventory.ts:439,521`) — não auditado a fundo. |
| PDF | **Regenerado a cada download** (`GET /cautelamentos/:id/pdf`), não armazenado; hash impresso é o do banco, **não dos bytes do PDF**. |
| QR | Aponta para `${WEB_PUBLIC_URL}/v/:id` → página chama `GET /api/verify/:document_id` (público). |
| Verificação pública | Lista assinaturas e diz "válido" se houver alguma não revogada. **Não recalcula nada**. Revogação não afeta (R-07). |
| `signature_proof` | `POST /signatures`: sha256 de `{document_hash, signer_id, signed_at, ip}` (IP do `x-forwarded-for`, forjável). Cautela: string `"<hash>:<userId>:armeiro"` — não é prova. |
| Relação documento/signatário/método/timestamp | Existe em `document_signatures` (`totp_verified`/`biometric_verified`, `signed_at`), sem vínculo com o artefato final. |
| Versionamento | Não encontrado. |
| TOTP — segredo | Gerado no servidor (`/setup`), cifrado com `TOTP_ENCRYPTION_KEY` (`v1:`), **nunca mostrado ao usuário** (sem otpauth/QR). |
| TOTP — obtenção do código | `GET /api/totp/code` (qualquer papel autenticado) devolve o código atual **para a própria sessão**. |
| Mesmo cliente obtém e usa o código? | **Sim.** Fluxos que validam o TOTP **do próprio chamador** (`POST /signatures`, `sign-armeiro`, `sign-militar` quando o militar assina no próprio aparelho, `/self-validate` do Nexus, `POST /ssa/requests`) aceitam um código que a mesma sessão pode buscar. Nesses fluxos o TOTP prova "tem a sessão", não um segundo fator. No fluxo `/totp/validate` (armeiro valida código do **militar**), o código comprova presença do aparelho do militar — aí o desenho faz sentido. |
| Validação | otplib 13, só passo atual (P2), anti-replay só do último token, bloqueio após 5 falhas/15 min, auditoria em `audit_logs` no `/validate`. |
| Recovery | `/reconfigure` gera novo segredo (aplicação), `/admin reset` (`totp.ts:442`) para admin_global/superadmin. |

---

## Parte B — Ledger

| ID | SEV | ÁREA | PROBLEMA | EVIDÊNCIA | DEPENDÊNCIAS | WIP RELACIONADO | TESTE NECESSÁRIO | STATUS | PRÓXIMA AÇÃO |
|---|---|---|---|---|---|---|---|---|---|
| R-01 | CRÍTICO | DOCUMENT_ENGINE | `hashDocument` ignora o conteúdo; todas as cautelas novas têm o mesmo hash; integridade documental inexistente | `lib/document-hash.ts:10-11`; `cautelamentos.ts:145-150,510,607,1523`; `signatures.ts:106,229`; sonda P1 | Decidir o que é o "documento canônico" (registro do banco, não payload do cliente) | WIP_BIOMETRIA toca `cautelamentos.ts` | unit: conteúdos diferentes → hashes diferentes; mesma entrada em ordem diferente → mesmo hash; Q2 no banco | **R-01A DONE_VERIFIED** (commit `9b5dfa7`: 23 testes unit + 2 handler; defeito reproduzido antes da correção) / R-01B primitive pronta, integração adiada (DSE v1) | Hash de cautela ainda não é recalculável a partir do registro (`data_emissao` do BFF ≠ do banco; `document_id:"new"`) — exige `cautelamentos.ts`, fora desta execução |
| R-02 | CRÍTICO | SECURITY_SCOPE / DATABASE | Contas com senha pública no repo (`Admin@123` para admin_global etc.) criadas por migration; repo afirma que existem em produção | `supabase/migrations/20260611000003_seed_dev.sql`; `apps/bff/src/__tests__/pentest/pentest-fixtures.ts:32-35`; comentário em `privilege-escalation.pentest.test.ts:16` | Acesso ao DB; decisão sobre onde ficam contas de teste | — | Q3; tentativa de login (quando BFF voltar) deve falhar | **CONFIRMADO parcialmente** (2026-09-30, `R-02_SUPABASE_READONLY.md`): 5 contas `@apmcb.dev` em produção (admin_global, admin_reserva, superadmin, 2 usuario); senhas NÃO VERIFICADO | Decisão operacional do dono: rotacionar senhas/desativar ou mover para ambiente não produtivo |
| R-03 | ALTO | SECURITY_SCOPE (TOTP) | Código TOTP de autoassinatura é obtido pela própria sessão | `routes/totp.ts:285-325` (sem roleGuard); consumidores `signatures.ts:48-98`, `cautelamentos.ts validateTotp`, `totp.ts /self-validate` | Decisão de produto: TOTP em app externo (otpauth) vs. biometria vs. manter como "confirmação" | WIP_BIOMETRIA (biometria como fator real) | E6 | BACKLOG | Brainstorm de desenho antes de código |
| R-04 | ALTO | SECURITY_SCOPE (SoD) | Autoaprovação/autoentrega SSA; autoemissão de saída | §A.3 | Regra de negócio | — | E1, Q6 | BLOQUEADO_BFF | Decisão de produto → guard pequeno no approve/deliver |
| R-05 | ALTO | SECURITY_SCOPE (reserva) | SSA approve/reject/deliver sem checagem de reserva (A1 opera A2) | `ssa.ts:582-640, 695-730, 884-920` (só tenant, fail-open) | — | — | unit com handler real + E2 | READY | `canAccessResourceReserve(role, session.reserveId, req.reserve_id)` + teste |
| R-06 | ALTO | SECURITY_SCOPE (tenant) | `GET /dashboard/stats` sem filtro de tenant/reserva (retorna `material_availability` de todos) | `routes/dashboard.ts:165-194`; frontend não usa (só `e2e/apmcb.spec.ts:359`) | — | — | unit: query recebe `tenant_id`; E3 | READY | Filtrar por tenant/reserva ou remover endpoint não usado |
| R-07 | ALTO | DOCUMENT_ENGINE | Revogação não altera status público de verificação | `signatures.ts:195-300`; trigger `_block_signature_update` (`20260625000004`) impede marcar a original | R-01 | — | unit do verify; E5; Q5 | READY | Verify considerar linhas `replaced_by` |
| R-08 | ALTO | SECURITY_SCOPE / dados | `deliver` SSA não atômico (lendings antes do update condicional) → duplicidade; `auth_mode:"totp"` sem verificação | `ssa.ts:935-970` | R-04/R-05 (mesmo handler) | — | teste de concorrência; E7 | READY | Update condicional primeiro (ou RPC transacional) |
| R-09 | MÉDIO | DOCUMENT_ENGINE | `sign-armeiro`/`sign-militar` sem checagem de reserva; rollback por DELETE anulado pelo trigger (assinatura órfã); `signature_proof` não é prova | `cautelamentos.ts:663-760, 735, 835`; `20260625000004` | R-01 | **WIP_BIOMETRIA reescreve esses handlers** | unit handler real | WIP_BIOMETRIA | Aguardar merge da branch biométrica |
| R-10 | MÉDIO | SECURITY_SCOPE | `dashboard/command` aceita `?reserve_id` do cliente para `admin_reserva` | `routes/dashboard.ts:27` | — | — | unit | READY | Ignorar query param fora de matriz |
| R-11 | MÉDIO | SECURITY_SCOPE | `session.reserveId` × `profiles.active_reserve_id` divergem entre dispositivos; remoção de membership não invalida sessão | `routes/reserves.ts:176-200`; `lib/session-guard.ts` (só role/invalidated); `profiles.ts:569` | — | INFRA (sessão) | E8 | BLOQUEADO_BFF | Avaliar ler reserva ativa do DB (com cache) no middleware |
| R-12 | BAIXO | TOTP | Só aceita passo atual (comentário diz ±1) → falha perto da virada de 30 s | `lib/totp-guard.ts:34-36`; sonda P2 | R-03 | — | unit com `epoch` | BACKLOG | Junto de R-03 |
| R-13 | MÉDIO | SECURITY_SCOPE | Padrão fail-open `if (tenantId)` / `tenantId && x.tenant_id &&` | ~25 ocorrências (`ssa.ts`, `cautelamentos.ts`, `handovers.ts`, `signatures.ts`, `saidas.ts`) | — | parcial com WIP_BIOMETRIA | unit sessão sem tenant → 4xx | BACKLOG | Levantar quando `tenantId` pode ser null; tornar fail-closed |
| R-14 | MÉDIO | QA_AUDIT | E2E/pentest apontam para produção por default; pentest já alterou dado real | `playwright.config.ts:34`; `privilege-escalation.pentest.test.ts:13-19` | B-04 | — | — | BACKLOG | Exigir `E2E_BASE_URL` explícito; ambiente não produtivo |
| R-15 | MÉDIO | QA_AUDIT | Não existe banco local para testar RLS/RPC; cadeia não aplica fora do Supabase | T11 | Docker/`supabase start` | WIP_INFRA (on-prem) | — | BACKLOG | Sessão dedicada: `supabase start` local |
| R-16 | MÉDIO | INFRA | ON_PREMISE: só auth abstraído; dados continuam em supabase-js | `services/supabase.ts`; `MIGRATION_SPEC.md §12` | — | **WIP_INFRA** | — | WIP_INFRA | Não tocar |
| R-17 | BAIXO | QA_AUDIT | Testes de integração não herméticos (rede real, mocks de `audit_events` faltando sem falhar) | T5 | — | — | — | BACKLOG | Endurecer mocks |
| R-18 | BAIXO | FRONTEND | `public/sw.js` gerado e versionado — build suja árvore | T10 | — | — | — | BACKLOG | Decidir: ignorar no git ou gerar no deploy |
| R-19 | BAIXO | SECURITY_SCOPE | Checagem de revogação de sessão fail-open em erro (loga) | `lib/session-guard.ts:95-105` | — | — | unit | BACKLOG | Decidir fail-open×fail-closed |
| R-20 | BAIXO | SECURITY_SCOPE | Bearer: tenant via `limit(1)` sem ordem; `/mode` Bearer cria sessão incompleta | `middleware/auth.ts` (fallback); `session.ts` fallback | — | WIP_INFRA (auth) | unit | BACKLOG | Coordenar com frente infra |
| R-21 | INCONCLUSIVO | DATABASE | Migration `lending_rpcs_liveness_null` fora de `main`; correções "ao vivo" em prod (CHANGELOG v53) → possível drift | `WIP_REGISTRY` | B-03 | WIP_BIOMETRIA | Q4 | INCONCLUSIVO | Comparar `schema_migrations` × repo |
| R-22 | ALTO | DATABASE | CHECK de `reserve_memberships` aceita `usuario` em produção, mas nenhuma migration do repo contém essa mudança — ambiente recriado do repo rejeita memberships `usuario` | `R-02_SUPABASE_READONLY.md` itens 3/9 | — | WIP_INFRA (on-prem usa as mesmas migrations) | criar migration idempotente e testá-la em banco local | READY | Migration que só formaliza o estado de produção (DROP/ADD CONSTRAINT com a mesma definição) |
| R-23 | MÉDIO | DATABASE | Migration `20260923123502` só no remoto; `20260923120000_usuarios_onprem` só no local | idem §Divergências | — | WIP_INFRA | `list_migrations` × `ls` | READY | Trazer o arquivo remoto para o repo; decidir se `usuarios_onprem` vai para SaaS |
| R-24 | BAIXO | DOCUMENT_ENGINE | `POST /api/signatures` faz hash do `document_data` enviado pelo cliente, não do registro do banco | `signatures.ts` | R-01 | — | — | BACKLOG | DSE v1 |

---

## Parte C — Prioridade proposta

**P0** (dano real a dados/evidência ou acesso indevido, independentes das frentes WIP):
1. **R-02** credenciais públicas — ação operacional imediata assim que Q3 confirmar (não precisa de código).
2. **R-01** hash documental — base de toda evidência de cautela/assinatura; tudo de documento depende dele.
3. **R-05 + R-08** SSA sem escopo de reserva e entrega não atômica — mesmo handler, mesma rodada.
4. **R-06** vazamento cross-tenant em `/dashboard/stats`.

**P1** (dependem de decisão de produto ou de outra frente):
R-04 (SoD — decisão de negócio), R-03/R-12 (desenho do TOTP), R-07 (verify após R-01),
R-09 (após merge WIP_BIOMETRIA), R-10, R-11, R-13, R-14.

**P2**: R-15, R-16 (WIP), R-17, R-18, R-19, R-20, R-21.

### Top 10 por dependência e risco
1. R-02 (operacional) → 2. R-01 → 3. R-06 → 4. R-05 → 5. R-08 → 6. R-07 → 7. R-04 (após decisão) → 8. R-03 (após desenho) → 9. R-10 → 10. R-14.

---

## Processo (proposta para as próximas sessões)

Cada item: hipótese → teste que falha → menor correção → testes locais (`pnpm --filter @apmcb/bff test` com env do CI, typecheck) → code review (skill `code-review`/`security-review` disponíveis aqui; o sub-agente `code-reviewer` do `CLAUDE.md` precisa existir ou ser substituído — decisão pendente) → atualização deste ledger com o teste que comprovou → `DONE_VERIFIED` só com evidência de execução (itens `BLOQUEADO_BFF` recebem `DONE_VERIFIED` apenas após a fila E1–E8).
