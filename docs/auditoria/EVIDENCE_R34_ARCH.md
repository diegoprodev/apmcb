# EVIDENCE — R-34: arquitetura de autorização da superfície direta Supabase (PostgREST/RLS/Storage)

> Somente arquitetura e auditoria. Nenhuma migration, policy, claim ou código funcional foi alterado.
> Produção: só leitura de **metadados** pelo conector (grants, `pg_get_functiondef`, `pg_policies`, triggers, colunas do schema `auth`, `storage.buckets`). **Nenhuma linha de dado de usuário lida**, nenhum login, nenhum JWT real, nenhum teste ofensivo.

## ESTADO
| Campo | Valor |
|---|---|
| Branch | `claude/bold-planck-6xy9fc` |
| HEAD | `4628502` (`fix(auth): enforce user mode per web session`) — presente |
| `main` | `5f91635` |
| Working tree | limpo no início |
| WIP_INFRA_HIBRIDA / WIP_BIOMETRIA | não tocadas; nenhum arquivo delas lido para escrita |

## R-34 REPRODUZIDO
**Demonstrado por análise estática e metadados de produção; não reproduzido por execução.** A tentativa de reprodução em Postgres local foi interrompida nesta sessão e não foi retomada. Em produção não se testa bypass (regra do prompt), então nenhum teste com JWT real foi feito.

A cadeia é determinística e cada elo tem prova de leitura:

1. **A sessão web em Modo Usuário existe só na iron-session do BFF.** Nada no banco nem no JWT da Supabase representa o modo (`EVIDENCE_R28.md`).
2. **O JWT da Supabase da mesma sessão web (`sb-*`) identifica o usuário, não o modo.** `auth.uid()` retorna o `sub`.
3. **`auth_role()` em produção** é `SELECT role FROM profiles WHERE id = auth.uid()` (STABLE, SECURITY DEFINER). Devolve o papel original de staff.
4. **`authenticated` tem `SELECT, INSERT, UPDATE, DELETE, TRUNCATE`** (grants de produção) em todas as tabelas de staff consultadas, exceto `tenants`, que é só leitura. **O RLS é a única barreira.**
5. **O RLS (snapshot de produção, `supabase/ci/policy-snapshot.json`) tem 27 policies de escrita de staff** que autorizam por `auth_role()` ou `reserve_memberships.role`. Exemplos: `lendings_insert`, `lendings_update`, `lendings_delete`; `cautelamentos_insert`, `cautelamentos_update`; `material_types_*`; `service_shifts_*`; `ocorrencias.occ_staff`; `profiles_update`.
6. **Nenhum fluxo do produto usa essas policies de escrita.** Escritas de staff vão pelo BFF ou pelas rotas do Next, sempre com service role (inventário abaixo).

Com isso, a mesma sessão em Modo Usuário ainda carrega uma credencial com autoridade de staff no data plane.

**Manifestação no produto, sem ferramenta nenhuma:**
- 17 páginas SSR de staff leem dados de staff com o JWT do usuário, pelo RLS, e autorizam por `profiles.role`. Nenhuma verifica o Modo Usuário.
- Só `reserva/page.tsx` redireciona, e o faz pelo cookie de UI `apmcb_mode`, que não é fonte de verdade (R-33).
- Exemplo: em Modo Usuário, abrir `/reserva/relatorios` pela URL renderiza os relatórios de staff.

## SUPERFÍCIE SUPABASE DIRETA (inventário do `apps/web/src`, sem testes)
**42 arquivos com acesso a dados (`.from`/`.rpc`/`.storage`); ~120 chamadas `.from()`.**

| Classe | Qtde | Arquivos |
|---|---|---|
| CLIENT_SIDE com dado | 2 | `app/login/page.tsx` (RPC `get_email_by_matricula`, pré-login); `hooks/use-role.ts` (`profiles` da própria linha) |
| SERVER_SIDE com JWT do usuário (RLS) | 36 | páginas SSR, `lib/*`, rotas `api/notifications/*`, `api/push/subscribe`, `api/admin/search-profiles`, `api/reserva/aging-count`, `auth/*` |
| SERVER_SIDE com service role (sem RLS) | 4 | `api/admin/almoxarifado`, `api/admin/users`, `api/auth/activate-account`, `api/auth/update-password` |

- **RPC**: só `get_email_by_matricula`, que é do plano de Auth.
- **Storage**: `lib/storage.ts` gera URL assinada com o JWT do usuário, em SSR, para `material-photos` e `profile-photos`.
- **Realtime**: nenhum acesso direto no web. O BFF faz SSE (`routes/realtime.ts`) com um client de service role.

## AUTH PLANE (pode continuar direto no Supabase)
- Chamadas `supabase.auth.*`: `getUser`/`getSession`, `signInWithPassword`, `signInWithOAuth`, `exchangeCodeForSession`, `verifyOtp`, `resetPasswordForEmail`, `updateUser`, `setSession`, `signOut`, `onAuthStateChange`.
- A RPC `get_email_by_matricula`, usada no login.
- Serve para identidade, refresh e sessão da Supabase, e alimenta o exchange para a iron-session.
- **Não concede acesso a dado**: o poder vem das policies do data plane. Separar os planos é o que permite manter o Supabase Auth.

## DATA PLANE
É todo `.from()` e o Storage com o JWT do usuário. É aqui que o papel original de staff vaza.

## CLIENT-SIDE
Só leituras da própria linha (`use-role`) e a RPC de login. **Nenhuma escrita client-side via PostgREST.**

## SERVER-SIDE
Páginas SSR e rotas do Next. Elas rodam no servidor, mas usam o JWT do usuário, então o resultado é decidido pelo RLS com `auth_role()`.

## STAFF READS (JWT do usuário + RLS por papel de staff)
**17 páginas:**
- `admin/`: `page`, `arsenal`, `arsenal/manutencao`, `auditoria`, `comando`, `relatorios`, `usuarios`;
- `reserva/`: `arsenal`, `biometria`, `militares`, `ocorrencias`, `passagens`, `passagens/[id]`, `relatorios`, `saidas`, `saidas/nova`, `solicitacoes`.

Libs server-side que consultam para essas páginas: `lib/category-usage.ts`, `lib/material-items-manutencao.ts`, `components/reports/resolve-livro-material.ts`, `lib/storage.ts`.

Tabelas lidas:
- `lendings`, `cautelamentos`, `profiles` de terceiros;
- `material_*`, `ocorrencias`, `audit_logs`;
- `service_log_events`, `service_shifts`;
- `admin_approval_requests`, `category_requests`, `material_requests`;
- `reserve_memberships`, `biometric_templates`.

Leituras de nível usuario (legítimas em Modo Usuário):
- `efetivo/page.tsx` e `efetivo/solicitacoes/page.tsx` (os únicos, além de `reserva/page.tsx`, que olham o modo);
- `lib/ssa/fetch-military-requests.ts`;
- `layout.tsx` (branding e reservas);
- `lib/session-profile.ts`, `app/page.tsx` e `auth/*` (a própria linha);
- `api/notifications/*`.

## STAFF WRITES
- **Via PostgREST com JWT do usuário: nenhuma no produto.** As únicas escritas com o JWT são da própria linha: `notifications` (`read_at`) e `push_subscriptions`.
- Via service role: o BFF inteiro, mais as 4 rotas do Next (`almoxarifado` e `users` autorizadas pelo papel efetivo da sessão desde o R-31).

**Conclusão: as 27 policies de escrita de staff do RLS são superfície morta.** Só servem a quem usa o JWT fora do produto. A migration `20260910100000` já registrava o mesmo fato para `profiles` ("nenhuma escrita de perfil usa token de usuário final; tudo passa pelo BFF com service_role").

## RPC
- `get_email_by_matricula`, no login.
- As RPCs de negócio (`record_lending_batch`, `record_cautelamento_batch`, etc.) já estão com `REVOKE ALL ... FROM authenticated` e só são chamadas pelo BFF. Esse é o **precedente do modelo A dentro do próprio projeto**.

## STORAGE
- `material-photos` (privado): leitura por `can_read_material_photo(name)`; escrita por papel de staff via `profiles.role`. É o mesmo problema do R-34 no Storage.
- `profile-photos` (privado): **ver R-35 em Novos achados**.
- `reserve-logos`, `tenant-logos`: públicos por desenho.

## REALTIME
Sem superfície direta. O SSE do BFF usa service role e os canais têm `allowedRoles` no BFF. Não depende do RLS.

## RLS ATUAL (snapshot de produção, 78 policies, 37 tabelas)
| Dependência | Policies |
|---|---|
| `auth_role()` (= `profiles.role`) | **48** (24 SELECT, 9 INSERT, 9 UPDATE, 4 DELETE, 2 ALL) em 25 tabelas |
| `my_tenant_id()` | 47 |
| `auth.uid()` | 39 |
| `my_tenant_isolation_enabled()` | 38 |
| `my_active_reserve_id()` | 37 |
| `reserve_memberships` (inclui papel por reserva, ex.: `rm.role = 'admin_reserva'`) | 15 |
| claims do JWT (`auth.jwt()`) | **0** |

Helpers em produção (lidos por `pg_get_functiondef`, todos STABLE e SECURITY DEFINER):
- `auth_role()`, `my_tenant_id()` e `my_active_reserve_id()` leem `profiles` por `auth.uid()`;
- `my_tenant_isolation_enabled()` lê `tenants` via `profiles`;
- `user_in_reserve()` e `reserve_tenant_id()` completam o conjunto.

Os triggers de `profiles` (`profiles_freeze_privileged_columns` e `profiles_validate_active_reserve`) congelam `role`, `default_tenant_id`, `registration_status`, `account_activated_at` e `active_reserve_id` contra `authenticated`/`anon`. Portanto **o titular não consegue trocar a própria reserva ativa nem o próprio papel pelo PostgREST**. Uma suspeita levantada nesta sessão foi refutada: a proteção está em produção e no repositório (`20260910180739`).

## AUTH_ROLE
- Tornar `auth_role()` ciente de sessão afetaria diretamente **48 policies**.
- **Não bastaria**: 15 policies decidem papel por `reserve_memberships.role` (ex.: `material_categories_staff_*`), e o Storage usa `profiles.role` direto (`material_photos_staff_*`).
- Seriam papéis afetados: admin_global, admin_reserva, armeiro e auditor. `usuario` já é o teto e não muda.
- Interação com multi-reserva e isolamento: `my_active_reserve_id()` é por **usuário** (`profiles.active_reserve_id`), não por sessão. Isso já contraria o espírito da D-02 no RLS, porque duas sessões do mesmo usuário compartilham a reserva ativa no data plane.

## SESSION_ID ANALYSIS
| Pergunta | Resposta (evidência) |
|---|---|
| O JWT atual tem `session_id` confiável? | O GoTrue emite o claim `session_id` = `auth.sessions.id` (tabela existe em produção; `auth.refresh_tokens.session_id` referencia a sessão). É assinado e confiável **como identificador da sessão Supabase** |
| Quem emite? | O GoTrue (Supabase Auth), não o ANDRÔMEDA |
| Imutável? | Permanece no refresh (a rotação de refresh token mantém `session_id`) |
| Identifica sessão Supabase ou iron-session? | **Sessão Supabase.** A iron-session tem `sessionId` próprio (`crypto.randomUUID()` no exchange/login), sem relação com o do GoTrue |
| Relação 1:1 JWT ↔ iron-session? | **Não.** O exchange pode ser chamado várias vezes com os tokens da mesma sessão Supabase (os harness de E2E/pentest do R-28 fazem isso), gerando N iron-sessions com o mesmo `session_id`. Além disso, `POST /api/auth/login` do BFF autentica pelo AuthProvider e cria outra sessão Supabase, que não é a dos cookies `sb-*` do navegador |
| Duas sessões web podem compartilhar `session_id`? | **Sim**, pelo caso acima. O modo guardado por `session_id` vazaria de uma sessão web para outra: viola a D-02 por excesso ou por falta |
| Logout/revogação | Revogação da iron-session (`revoked_sessions`) e da sessão Supabase são independentes. Seria preciso sincronizar as duas ou aceitar divergência |
| Associação do `activeMode` | Exigiria tabela nova `(auth_session_id → mode)`, gravada pelo BFF no toggle, e helper lendo `auth.jwt()->>'session_id'` |
| TTL / limpeza | Atrelar a `auth.sessions.not_after`, com job de limpeza. É estado novo a operar |
| Banco de estado indisponível / linha ausente | Linha ausente = staff, ou seja, **fail-open** para a redução de privilégio. Fail-closed exigiria linha obrigatória por sessão, e todo login quebraria se a gravação falhasse |
| JWT antigo continua staff após entrar em Modo Usuário? | Não, se o helper consultar a tabela a cada statement (o claim não carrega o modo). Mas cada consulta RLS pagaria mais um lookup |
| Race toggle × RLS | Janela entre o commit do toggle e requisições concorrentes. É pequena, mas existe |
| Cloud × On-Prem | `auth.jwt()`/`session_id` do GoTrue não existem em ON_PREMISE (LocalAuthProvider, sem GoTrue nem PostgREST) |

**Veredito: `session_id` não é confiável para representar a D-02.** Ele identifica a sessão da Supabase, não a sessão do produto, e a relação com a iron-session é N:1 e não controlada. Adotá-lo exigiria redesenhar o login (1 sessão Supabase por iron-session, com vínculo forte), mais estado novo, TTL e sincronização de revogação. **Inadequado sem esse redesenho.**

## MULTI-SESSION
- A D-02 exige modos independentes por sessão do produto.
- O BFF já cumpre isso (R-28, TWO_SESSIONS_SAME_USER).
- No RLS, qualquer estado ligado a usuário (`profiles`) ou à sessão Supabase (N iron-sessions) quebra essa independência.
- A única fonte que respeita a D-02 hoje é a iron-session, que só o BFF enxerga.

## OPÇÃO A — BFF-CENTRIC
Todo o data plane de staff passa pelo BFF, onde papel efetivo, Modo Usuário, tenant e reserva já são aplicados. O `authenticated` perde a capacidade de staff no banco.

- **Segurança**
  - Uma fonte de verdade (a sessão).
  - Fail-closed (Bearer sem sessão tem teto `usuario`, provado no R-28).
  - Sem JWT stale.
  - O RLS vira defesa em profundidade de nível usuario.
- **Complexidade:** migrar 17 páginas SSR e 4 libs para endpoints do BFF. Parte já existe, por exemplo `GET /api/dashboard/stats` e as rotas `/api/lendings`, `/api/admin/*` e `/api/reserves/*`.
- **Performance:** um salto a mais (Next → BFF) nas páginas de staff, que hoje fazem N consultas diretas. Mitigável com endpoints agregados, como `/stats`.
- **Realtime:** já é via BFF. **Storage:** URLs assinadas geradas pelo BFF (service role), com escopo.
- **Offline:** sem impacto (não há cache offline de dados de staff via PostgREST).
- **On-Prem:** **compatível e necessário**. Em ON_PREMISE não há PostgREST nem JWT do GoTrue; o BFF é o único data plane possível.
- **WIP_INFRA:** alinhado. O BFF já é o ponto de abstração, e a WIP registra que "todas as rotas de dados continuam usando `services/supabase.ts`".
- **Dívida:** depois da migração, o RLS de staff e a duplicação de regra entre RLS e BFF deixam de ser necessários.

## OPÇÃO B — SESSION-AWARE RLS
Mantém o acesso direto e cria estado por sessão legível pelo PostgreSQL.

- **Sincronização:** o toggle no BFF precisa gravar estado no banco, com chave no `session_id` do GoTrue (N:1 com a iron-session, ver acima).
- **Refresh:** mantém `session_id`; resolve esse ponto.
- **Revogação:** duas fontes independentes.
- **TTL/limpeza:** estado novo a operar.
- **Multi-session:** incorreto sem redesenho do login.
- **Races:** existem.
- **Falha:** fail-open (linha ausente = staff) ou login frágil.
- **Policies afetadas:** 48 via `auth_role()`, mais 15 via `reserve_memberships`, mais as do Storage. Além disso, o isolamento por reserva continuaria sendo por usuário.
- **Cloud-only:** incompatível com ON_PREMISE.
- **Operação:** a maior complexidade das três.

## OPÇÃO C — HÍBRIDA (derivada do código)
O data plane de **staff** vai para o BFF (como na A). O acesso direto fica **só** onde o inventário mostra justificativa real:

- **Plano de Auth completo**: identidade e sessão Supabase.
- **Leituras da própria linha / nível usuario:**
  - `use-role` (`profiles` da própria linha);
  - `efetivo/*` e `fetch-military-requests`;
  - `notifications` e `push_subscriptions` do próprio usuário;
  - branding e lista de reservas no `layout.tsx`.

  São capacidades de `usuario`, idênticas em Modo Usuário: não há privilégio a reduzir.
- **RPC de login** (`get_email_by_matricula`).
- **Storage público** (logos).

Todo o resto, inclusive as URLs assinadas de fotos de staff, sai do JWT do usuário.

- **Prós:** tudo o que a A tem, com esforço menor, porque as leituras de nível usuario não migram.
- **Contras:** mantém um RLS de nível usuario para manter e testar. É pequeno e já existe.

## ON-PREM
| Componente | A | B | C |
|---|---|---|---|
| SupabaseAuthProvider | sem mudança | depende de `session_id` do GoTrue | sem mudança |
| LocalAuthProvider / `AMBIENTE_INFRA=ON_PREMISE` | compatível: BFF é o data plane | **incompatível**: sem GoTrue, sem `auth.jwt()` | compatível; a parte direta (nível usuario) precisa de um equivalente no BFF on-prem, como tudo o mais |
| PostgreSQL local / auth shim (`onprem-bootstrap/000_auth_shim.sql`) | RLS não é caminho de acesso | exigiria emular claims por sessão no shim | idem A |
| BFF | é o PEP (ponto de aplicação da política) | continua PEP e ainda sincroniza estado | é o PEP |

Nada foi alterado em WIP_INFRA; só compatibilidade avaliada.

## SERVICE ROLE RISK
O BFF usa service role e **ignora o RLS**. Mover para o BFF **não resolve sozinho**: cada endpoint novo precisa aplicar, explicitamente e com teste negativo:

1. **Papel efetivo** da sessão (`roleGuard`; Bearer sem sessão tem teto `usuario`; Modo Usuário → `usuario`).
2. **Tenant** da sessão (nunca do cliente).
3. **Reserva**: `scopedReserveIds`/`isMatriz` (lib `reserve-scope.ts`); seleção do cliente só se estiver no escopo.
4. **Fail-closed** sem tenant ou sem reserva (não-matriz).
5. **Log de toda negação** (CLAUDE.md).

O R-06 é o precedente do risco: `/api/dashboard/stats` agregava **todos os tenants** porque, sob service role, nada filtrava.

Toda migração de página exige teste de handler real com CROSS_TENANT, CROSS_RESERVE, CLIENT_SUPPLIED_SCOPE e MODE_USER, no padrão de `dashboard-scope-real-handler.test.ts`.

Operações que precisam dessa autorização ao migrar: leituras de `lendings`, `cautelamentos`, `profiles` de terceiros, `ocorrencias`, `audit_logs`, `service_*`, `*_requests`, `material_*`, `reserve_memberships`, `biometric_templates`, e URLs assinadas de fotos.

## POC
Uma leitura de staff que hoje é direta e já tem equivalente no BFF. **Nenhum código novo.**

- **Hoje (direto):** `reserva/page.tsx` lê `lendings` e `profiles` com o JWT do usuário. O resultado é decidido por `auth_role()` (papel original), e o redirect de Modo Usuário depende do cookie de UI.
- **Arquitetura proposta:** o mesmo agregado é servido por `GET /api/dashboard/stats` no BFF, autorizado pela sessão.
- **Provas executadas agora** (testes existentes, handler real), `bun test` de `dashboard-scope-real-handler` e `mode-user-auth-paths`: **32/32**. Os casos cobrem:
  - `MODE_USER_PRIVILEGE` em `/stats` → 403;
  - Bearer sem sessão → teto `usuario`;
  - TWO_SESSIONS_SAME_USER → modos independentes;
  - CROSS_TENANT e CROSS_RESERVE isolados;
  - MISSING_SCOPE → 403.

Nenhuma implementação funcional foi feita ou commitada.

## DECISÃO
**C_HYBRID** (data plane de staff centrado no BFF; acesso direto só para Auth e para capacidades de nível usuario).

Critérios:
- menor superfície de autorização (um PEP);
- uma fonte de verdade (a iron-session);
- fail-closed já provado;
- D-02 e multi-session corretos (TWO_SESSIONS);
- Cloud e On-Prem;
- nenhuma policy "especial" por sessão;
- sem JWT stale;
- testável com handler real.

A **B** foi rejeitada: `session_id` não representa a sessão do produto, é Cloud-only e fail-open.

## MIGRATION NECESSÁRIA?
**Sim, depois da migração dos consumidores.** Não foi implementada nem reservada. Finalidade (desenho para o próximo prompt):

1. **Revogar a escrita direta** de `authenticated`/`anon` (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`) nas tabelas de staff, no padrão já aplicado em `tenants`. Mantém as exceções da própria linha: `notifications.read_at` e `push_subscriptions`.
2. **Remover as 27 policies de escrita de staff**, que viram superfície morta.
3. **Reduzir as policies de SELECT de staff** a nível usuario (própria linha / próprio tenant, só o necessário para as leituras diretas mantidas na C). Isso só **depois** de migrar as 17 páginas SSR, senão elas quebram.
4. **Storage:** escrita de `material-photos` e `profile-photos` só por service role; leitura com escopo (ver R-35).
5. **Gate de CI:** estender `ci_policy_snapshot`/allowlist de grants para impedir que `authenticated` recupere DML de staff.

Ordem obrigatória: (a) endpoints no BFF com testes; (b) páginas consumindo o BFF; (c) migration de grants e policies; (d) regressão.

## RISCOS
- **Performance** das páginas de staff (mais um salto): mitigar com endpoints agregados.
- **Service role** sem escopo em endpoint novo (classe R-06): mitigar com o teste de handler obrigatório.
- **Janela de transição:** até a migration, o JWT continua com autoridade de staff no PostgREST. O R-34 segue aberto até lá.
- `my_active_reserve_id()` é por usuário; o isolamento por reserva no RLS continua por usuário até que o RLS deixe de ser caminho de staff.
- O JWT ainda aparece no payload RSC de `reserva/passagens` (achado do R-28): aumenta a exposição do token até o R-34 fechar.

## PRÓXIMO PASSO
Implementar a C por página, começando pelas leituras de `/reserva/relatorios` e `/admin/relatorios`. Para cada uma: endpoint no BFF com o teste de handler real (MODE_USER, CROSS_TENANT, CROSS_RESERVE, CLIENT_SUPPLIED_SCOPE), depois a página consumindo o BFF. A migration de grants e policies entra só quando as 17 páginas estiverem migradas.

## NOVOS ACHADOS
- **R-35 (ALTO, Storage `profile-photos`, só por leitura de policy; nada testado):** bucket privado, mas:
  - `profile_photos_auth_read`: `bucket_id = 'profile-photos'`. **Qualquer autenticado lê qualquer foto de perfil, de qualquer tenant** (exposição de dado pessoal).
  - `profile_photos_authenticated_insert`/`_update`: `bucket_id = 'profile-photos'`. **Qualquer autenticado grava ou sobrescreve qualquer foto** (integridade: a foto serve para identificar o militar).
  - As escritas legítimas passam pelo BFF (service role), então restringir não quebra fluxo de upload.
  - Correção pertence à migration da C (item 4).
- **R-36 (BAIXO, hardening):** `authenticated` tem `TRUNCATE` nas tabelas de `public`. TRUNCATE ignora RLS, mas não é exposto pelo PostgREST, então não é explorável pela API. Revogar junto na migration da C.
- **R-37 (MÉDIO, produto):** 17 páginas SSR de staff renderizam dados de staff em Modo Usuário. Só `reserva/page.tsx` redireciona, e pelo cookie de UI. É a manifestação visível do R-34 e se resolve com a C.
- Suspeita refutada: autoalteração de `active_reserve_id` pelo PostgREST está bloqueada por trigger em produção e no repositório.
