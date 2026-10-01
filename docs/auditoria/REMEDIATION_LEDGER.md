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
| R-06 | ALTO | SECURITY_SCOPE (tenant) | `GET /dashboard/stats` sem filtro de tenant/reserva (retorna `material_availability` de todos) | `routes/dashboard.ts:165-194`; frontend não usa (só `e2e/apmcb.spec.ts:359`) | — | — | unit: query recebe `tenant_id`; E3 | **DONE_VERIFIED** (2026-09-30, `EVIDENCE_R06.md`): `/command` e `/stats` escopados por tenant+reserva; 20 testes de handler (antigo 2/18 → corrigido 20/0; 5 mutações detectadas) | Modo Usuário via Bearer → R-28 |
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
| R-22 | ALTO | DATABASE | CHECK de `reserve_memberships` aceita `usuario` em produção, mas nenhuma migration do repo contém essa mudança — ambiente recriado do repo rejeita memberships `usuario` | `R-02_SUPABASE_READONLY.md` itens 3/9 | — | WIP_INFRA (on-prem usa as mesmas migrations) | criar migration idempotente e testá-la em banco local | **DONE_VERIFIED** (2026-09-30, `EVIDENCE_R22.md`): migration `20260930120000` + harness Postgres local 31/31, mutações detectadas; em produção é no-op (confirmado read-only) | Aplicar em ambientes Supabase só depois de R-23 |
| R-23 | MÉDIO | DATABASE | Migration `20260923123502` só no remoto; `20260923120000_usuarios_onprem` só no local | idem §Divergências | — | WIP_INFRA | `list_migrations` × `ls` | **DONE_VERIFIED** (2026-09-30, `EVIDENCE_R23.md`): `20260923123502` recuperada byte a byte de `schema_migrations.statements` (ORIGINAL_RECOVERED), teste 11/11; `20260923120000` = SHARED_MIGRATION_NOT_YET_DEPLOYED (não alterada) | `db push` continua BLOQUEADO até a frente INFRA decidir aplicar ou não `20260923120000` no Cloud (fora de ordem, exige `--include-all`) |
| R-24 | BAIXO | DOCUMENT_ENGINE | `POST /api/signatures` faz hash do `document_data` enviado pelo cliente, não do registro do banco | `signatures.ts` | R-01 | — | — | BACKLOG | DSE v1 |
| R-25 | MÉDIO | SECURITY_SCOPE | `POST /api/admin/users/invite` grava `body.role` (`z.string()`) em `reserve_memberships` sem filtro nem checagem de erro; `auditor`/`admin_global` com `reserve_id` são rejeitados pelo CHECK em silêncio (sem log) | `admin.ts:1239,1303` | — | — | teste de handler | BACKLOG | Mapear papel global→papel de reserva e logar falha |
| R-26 | BAIXO | QA_AUDIT | Harness `supabase/tests/r22_*.sh` não roda no CI | `.github/workflows/*` | — | WIP_INFRA (`.github`) | — | BACKLOG | Coordenar com a frente de infra |
| R-27 | ALTO | DATABASE / INFRA | `20260923120000_usuarios_onprem` (On-Prem) na cadeia comum, fora de ordem: CLI recusa `db push` no Cloud sem `--include-all` (dry-run real contra réplica); Cloud não depende dela | `EVIDENCE_MIGRATION_ARCH_120000.md` | decisão da frente INFRA | **WIP_INFRA** | dry-run contra réplica | **BLOCKED_ARCHITECTURAL_DECISION** | Dono da frente INFRA decidir A (aplicar no Cloud) × B (mover para `onprem-bootstrap/`, recomendada) |
| R-28 | ALTO | SECURITY_SCOPE | Modo Usuário (por sessão, D-02) contornável: Bearer sem sessão recebia `profiles.role` no `authMiddleware`; `POST /api/session/mode` via Bearer criava sessão de staff; Comando/SSR de staff usavam Bearer | `middleware/auth.ts`, `routes/session.ts`, web | — | WIP_INFRA (auth) — sem conflito | `mode-user-auth-paths.test.ts` (12), web `mode-user-staff-routes`/`web-session`/`_client` | **PARTIAL** (2026-09-30, `EVIDENCE_R28.md`): caminhos BFF e Next **fechados e provados** (Bearer sem sessão → teto `usuario`; `/mode` exige sessão; TWO_SESSIONS isolado; identidade mista sem mistura; contraprova antigo 6/4 → 12/0). **Aberto**: PostgREST/RLS direto com o JWT da sessão (R-34) | R-34 |
| R-29 | BAIXO | FRONTEND/DB | `cautelas_com_item_vencido` filtra `cautelamentos.validade_item` (coluna inexistente no repo) → sempre 0; agora loga `dashboard.metric.failure` | `routes/dashboard.ts` métrica 2 | — | — | teste com schema | BACKLOG | Confirmar schema e corrigir a métrica |
| R-30 | BAIXO | FRONTEND | Seletor de reserva do painel Comando aparece para admin_global em modo filial; escolher outra reserva agora dá 403 | `admin/comando/_client.tsx` | R-06 | — | — | BACKLOG | Esconder o seletor fora da matriz |
| R-31 | MÉDIO | SECURITY_SCOPE | Route handlers `/api/admin/*` (e `/api/reserva/aging-count`) do Next autorizavam por `profiles.role`, ignorando o Modo Usuário | `EVIDENCE_R28.md` | R-28 | — | `mode-user-staff-routes.test.ts` | **DONE_VERIFIED** (2026-09-30): papel efetivo da sessão do BFF (`resolveWebSessionRole`, confere `userId`, fail-closed); antigo 1/3 → 4/0 | Resíduo: tenant/reserva ainda de `profiles` (M3 do review) |
| R-32 | BAIXO | FRONTEND | Em Modo Usuário, admin_global recebia 403 em `/efetivo` (SSR Bearer → papel admin_global, não aceito por `/cautelamentos/ativos`) | `EVIDENCE_R28.md` | R-28 | — | caso R-32 em `mode-user-auth-paths.test.ts` | **DONE_VERIFIED** (2026-09-30): efeito do teto do Bearer; 403 → 200 sem tocar `cautelamentos.ts` | — |
| R-33 | BAIXO | SECURITY_SCOPE | `apmcb_mode` expira em 8h fixas e a sessão é deslizante; `session.destroy()` não apaga `apmcb_mode`; comentários diziam que o Bearer lê o cookie | `routes/session.ts`, `middleware/auth.ts` | R-28 | WIP_INFRA (auth) | — | **PARTIAL** (2026-09-30): comentário falso do middleware corrigido; proxy `app/api/mode` (com comentário falso) removido; confirmado que nenhum caminho autoriza por `apmcb_mode`. Pendente: expiração/limpeza do cookie de UI | Divergência só de UI |
| R-34 | ALTO | SECURITY_SCOPE / DATABASE | Modo Usuário (D-02) não vale no data plane Supabase: `authenticated` tem DML completo nas tabelas de staff e as policies autorizam por `auth_role()` (= `profiles.role`) / `reserve_memberships.role`; o JWT da sessão web em Modo Usuário mantém autoridade de staff | `EVIDENCE_R34_ARCH.md` (grants, helpers e policies de PROD lidos só como metadados; snapshot 78 policies, 48 via `auth_role()`) | R-28 | migrations (próximo prompt) | teste de handler real por endpoint + gate de grants | **PARTIAL_IMPLEMENTATION** (2026-09-30; arquitetura C_HYBRID). Lotes 1 (`/reserva/ocorrencias`), 2 (`/reserva/solicitacoes`), 3 (`/reserva/saidas`) e 4 (`/reserva/passagens`) migrados para o BFF, ver `EVIDENCE_R37_BATCH1.md`, `_BATCH2.md` e `_BATCH3.md`. Antes: ARCH_DECIDED: data plane de staff centralizado no BFF (onde a D-02 já é aplicada); acesso direto só para Auth e capacidades de nível usuario; `session_id` rejeitado (identifica a sessão Supabase, relação N:1 com a iron-session, Cloud-only, fail-open). Demonstrado por análise, **não reproduzido por execução**. Aberto | Migrar as 17 páginas SSR de staff para o BFF; depois a migration de grants e policies |
| R-35 | ALTO | STORAGE / DATA_EXPOSURE | Bucket privado `profile-photos`: policies davam a qualquer `authenticated` leitura, inserção e atualização condicionadas só por `bucket_id`; e o signing do BFF assinava qualquer path gravado em `profiles.foto_url` | `EVIDENCE_R35.md`; migration `20260930130000` (sha256 `d63f4b5e…551b5b`) | — | migrations (deploy separado) | validação externa hermética (Supabase local + Storage API; PASS, com contraprova) + `profile-photo-routes` 13/13 | **DONE_VERIFIED_REPO_PENDING_DEPLOY** (2026-09-30): policies removidas (deny by default para anon/authenticated) e signing só de objeto do próprio perfil. **Produção não corrigida** | Deploy: rodar `migrate-active-profile-photos.ts`, publicar o BFF, aplicar a migration |
| R-38 | MÉDIO | DATABASE | `profiles.foto_url` gravável pelo próprio titular (e por admin do tenant) via PostgREST: não está em `profiles_freeze_privileged_columns`, e `authenticated` tem UPDATE de tabela em `profiles`. Mitigado no BFF (R-35); resta griefing de disponibilidade e dependência de cada consumidor checar a posse | `EVIDENCE_R35.md` (security-review) | R-35, R-36 | migrations | teste do trigger | ABERTO | Congelar `foto_url` no trigger; grants por coluna junto do R-36 |
| R-39 | ALTO | SECURITY_SCOPE / DATA_EXPOSURE | `POST /api/ocorrencias` notificava o staff da **plataforma inteira** (sem tenant/reserva): título, material e `military_id` a staff de outros tenants; `lending_id`/`material_type_id` do cliente sem validação | `EVIDENCE_R39.md` | — | — | `ocorrencias-create-notify-scope.test.ts` (10; POST antigo 0/10; 8 mutações detectadas) | **DONE_VERIFIED_REPO_PENDING_DEPLOY** (2026-09-30): destinatários = quem vê a ocorrência pelo GET (tenant via `tenant_memberships` + cache, reserva derivada, matriz), autor excluído; referências só do tenant (lending do próprio militar); aviso best-effort. **Produção não corrigida** até o deploy do BFF | M2 (notificar membros com reserva inativa) é decisão de produto |
| R-40 | ALTO | SECURITY_SCOPE | `POST /api/handovers` tratava `body.reserve_id` do cliente como autoridade: sem checar o tenant da sessão; `admin_global` dispensa membership; snapshot lia `reserves` só por `id` (vazava nome/sigla e gravava linha tenant A + reserva de B) | `EVIDENCE_R40.md` (reproduzido: 201 com reserva cross-tenant; 8 dos 16 testes falham no código antigo) | R-37 lote 4 | `routes/handovers.ts` POST | `handovers-create-scope.test.ts` (16) + 8 mutações detectadas | **DONE_VERIFIED_REPO_PENDING_DEPLOY** (2026-09-30; BFF precisa de deploy) | Reserva validada por id + tenant da sessão antes de membership/snapshot/insert/audit; 404 igual para inexistente/outro tenant; erro de banco 500 + logFailure |
| R-41 | MÉDIO | SECURITY_SCOPE / OBSERVABILIDADE | `scopedReserveIds` (`lib/reserve-scope.ts`) engolia o erro da consulta de `reserves` (log + `[]`): falha de banco virava escopo vazio e o `GET /api/handovers` (e os demais callers) respondia 200 vazio | `EVIDENCE_R41.md` (reproduzido: matriz com erro em `reserves` → HTTP 200 `{handovers: []}`) | R-37 lote 4 | `lib/reserve-scope.ts`, `routes/handovers.ts` GET | `reserve-scope-fail-closed.test.ts` (12) + 4 de 5 mutações por comportamento | **DONE_VERIFIED_REPO_PENDING_DEPLOY** (2026-09-30; BFF precisa de deploy) | Helper lança `ReserveScopeLookupError` (vazio legítimo segue sendo sucesso); handovers: `logFailure` + 500 genérico sem consultar dados; demais callers: `app.onError` (500 genérico + log) |
| R-42 | MÉDIO | SECURITY_SCOPE | Handlers `/:id` de handovers (GET, `/pdf`, `sign-exit`, `assign-entry`, `sign-entry`, `report-divergence`) usavam `if (tenantId && …)`: com `tenantId` nulo na sessão a checagem era pulada (fail-open) | `EVIDENCE_R42_R43.md` (reproduzido no handler: tenant nulo lia passagem de outro tenant; alcançabilidade real depende de sessão de staff sem tenant) | R-40 | `routes/handovers.ts` | `handovers-id-scope.test.ts` (24) + mutações detectadas | **DONE_VERIFIED_REPO_PENDING_DEPLOY** (2026-10-01; BFF precisa de deploy) | `requireSessionTenant` (403 antes de tocar a passagem) e comparação estrita de tenant nos 6 handlers |
| R-43 | MÉDIO | SECURITY_SCOPE | Handlers `/:id` de handovers: A) escopo só por tenant (admin_reserva/auditor de A lia/atribuía/reportava em B do mesmo tenant); B) `assign-entry` sem validar `entrando_id`; C) UPDATE sem condição de status; D) resultado do UPDATE ignorado | `EVIDENCE_R42_R43.md` (A, B, C e D reproduzidos) | R-40 | `routes/handovers.ts` | `handovers-id-scope.test.ts` + mutações detectadas | **DONE_VERIFIED_REPO_PENDING_DEPLOY** para A/B/C/D no escopo do BFF; ressalva **R-45** (assinatura órfã dos `sign-*`, requer schema/transação) e regra B **inferida por simetria** (ver evidência) | A: `canAccessResourceReserve` (matriz tenant, demais reserva ativa; armeiro mantém participação; sign-* por identidade); B: entrante no tenant, papel de staff, membership na reserva da passagem (admin_global isento); C/D: UPDATE condicionado a tenant+status e linhas conferidas (409/500) |
| R-44 | BAIXO | SECURITY_SCOPE / OBSERVABILIDADE | `routes/categories.ts` tem cópia local de `scopedReserveIds` que ainda engole o erro e retorna `[]` (usos em revisão/aprovação de categorias): falha vira 404/lista vazia, mas fail-closed (nega, não vaza) | security-review do R-41 (pré-existente) | — | `routes/categories.ts` | teste de falha da query de `reserves` | **OPEN** | Importar o helper SSOT e deixar o erro subir; fora do R-41 |
| R-45 | MÉDIO | DOCUMENT_ENGINE / INTEGRIDADE | `sign-exit`/`sign-entry` inserem a assinatura (imutável: triggers `no_update/no_delete`) ANTES do UPDATE de transição; se o UPDATE condicional perde a corrida, fica assinatura órfã/duplicada (TOTP consumido, resposta 409). Antes o UPDATE perdedor era ignorado e a resposta era 200 (mesma escrita parcial, invisível) | security-review do R-42/R-43 (confiança ≥ 8) | R-43 | `routes/handovers.ts` sign-*, `document_signatures` | teste de concorrência INSERT/UPDATE | **OPEN** | Exige schema/transação: índice único parcial `(document_id, signer_role) WHERE document_type='handover'` e/ou RPC que insere assinatura e transiciona atomicamente; fora do R-43 (sem migration) |
| R-36 | BAIXO | DATABASE (hardening) | `authenticated` tem `TRUNCATE` nas tabelas de `public` (ignora RLS; não exposto pelo PostgREST) | `EVIDENCE_R34_ARCH.md` | — | migrations | gate de grants | ABERTO | Revogar na migration da C |
| R-37 | MÉDIO | FRONTEND / SECURITY_SCOPE | 17 páginas SSR de staff renderizavam dados de staff em Modo Usuário (autorizam por `profiles.role`, leem pelo RLS; só `reserva/page.tsx` redireciona, pelo cookie de UI) | `EVIDENCE_R34_ARCH.md`, `EVIDENCE_R37_BATCH1.md`, `EVIDENCE_R37_BATCH2.md`, `EVIDENCE_R37_BATCH3.md`, `EVIDENCE_R37_BATCH4.md` | R-34 | — | testes da página + endpoint real por lote | **PARTIAL_IMPLEMENTATION** (2026-09-30): lote 1 `/reserva/ocorrencias` DONE_VERIFIED (`cca1d51`); lote 2 `/reserva/solicitacoes` DONE_VERIFIED (validação por testes de página e endpoint, mutações detectadas, reviews 0 CRÍTICO/ALTO). lote 3 `/reserva/saidas` DONE_VERIFIED (`GET /api/lendings?limit` + `GET /api/reserves/active`). lote 4 `/reserva/passagens` DONE_VERIFIED (só a página SSR; a listagem já era BFF). Faltam 13 páginas (`admin/`: page, arsenal, arsenal/manutencao, auditoria, comando, relatorios, usuarios; `reserva/`: arsenal, biometria, militares, passagens/[id], relatorios, saidas/nova) + `reserva/page` (guarda só por cookie de UI) + os cards de contagem de ocorrências (`reserva/page`, `admin/page`) | Próximo lote sugerido: `/reserva/biometria` (leituras pequenas) ou `reserva/militares` |

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

---

## Decisões de produto registradas

| ID | Data | Decisão (dono do produto) | Efeito |
|---|---|---|---|
| D-01 | 2026-09-30 | Armeiro (e admin de reserva) pode administrar mais de uma reserva, mas tem **uma reserva padrão**. O militar (usuário) também tem **uma reserva padrão (lotação)**. Não haverá chevron de troca de reserva no Modo Usuário; se armar em outra reserva é pontual e se escolhe na própria solicitação (pedido remoto), não trocando o contexto. | Sem implementação agora. Pendências derivadas: o banco não garante uma única lotação (`reserve_memberships` permite N linhas `usuario`); o padrão do pedido hoje é a reserva ativa da sessão, não a lotação. |
| D-02 | 2026-09-30 | Modo Usuário é um **contexto operacional de redução de privilégios, por sessão**: com `activeMode = usuario`, todas as requisições daquela sessão têm papel efetivo `usuario`. Não é MFA, reautenticação nem trava global; não é persistido por usuário; não afeta outra sessão/dispositivo; não substitui SoD; não pode ser contornado por Bearer do fluxo daquela sessão. | R-28 (PARTIAL), R-31/R-32 DONE_VERIFIED, R-33 PARTIAL, R-34 novo (RLS). |
