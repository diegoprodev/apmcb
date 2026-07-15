# Changelog — APMCB Plataforma de Governança de Bens Sensíveis

> Mantido por convenção semântica. Datas em ISO 8601 (America/Recife, UTC-3).
> Roadmap completo: `docs/enterprise/02-enterprise-roadmap.md`
> DoD Canônica: `docs/enterprise/07-canonical-definition-of-done.md`

---

# 2026-07-14 - docs(security): spec Phase 1B do Biometric Bridge Windows real

### Seguranca/Arquitetura - NITGEN USB fisico integrado ao sistema cloud

* Criada spec `docs/superpowers/specs/2026-07-14-biometric-bridge-phase1b-windows-bridge-mvp-design.md` para implementar o bridge Windows real NITGEN/eNBioBSP sem SDK na VPS e sem browser chamando `localhost`.
* A spec define device-auth Ed25519 com timestamp/nonce, pareamento por codigo one-time, endpoints bridge-facing, polling/claim atomico de challenge, sync de templates para matching local e proof submit sem cookie de usuario.
* Definido MVP Windows em C#/.NET Framework 4.8 por compatibilidade com `NITGEN.SDK.NBioBSP.dll` e sample oficial C#, com validacao obrigatoria via `doctor`, pareamento e identificacao real no leitor USB.
* A spec agora declara o gate operacional para branch paralela: se Phase 1A.2/1A.3 ja existirem em branch/deploy do Claude Code, Phase 1B deve ser rebaseada sobre esse baseline; se nao, valida primeiro bridge real em `/reserva/biometria` e enrollment.
* `docs/security.md` atualizado para apontar a Phase 1B como proxima etapa canonica do bridge real, compativel com um baseline em que 1A.2/1A.3 ja tenham sido implementadas por outro agente.

---

# 2026-07-15 — fix(infra): rate limit compartilhado entre todos os clientes de produção (incidente real)

### Incidente — login bloqueado para todos os usuários

* **Causa raiz**: `apps/bff/.env` de produção nunca definiu `RATE_LIMIT_TRUST_PROXY_HEADERS`. Com `NODE_ENV=production` e a flag ausente, `getClientIp()` (`middleware/rate-limit.ts`) caía no fallback `"proxy-headers-untrusted"` — **todos os clientes de produção compartilhavam a mesma chave de rate limit**, em vez de cada IP ter sua própria cota.
* **Gatilho**: uma sessão de auditoria de segurança rodou dezenas de suítes E2E/pentest completas contra produção ao longo de várias horas, esgotando a cota compartilhada e bloqueando login de usuários reais (não só os testes).
* **Correção aplicada**: confirmado que o nginx em frente ao BFF já sobrescreve `X-Real-IP`/`X-Forwarded-For` com o IP real da conexão (`proxy_set_header X-Real-IP $remote_addr;` — nunca repassa valor vindo do cliente, então é seguro confiar nesses headers). `RATE_LIMIT_TRUST_PROXY_HEADERS=true` adicionada ao `.env` de produção do BFF (backup do `.env` anterior preservado no servidor) e ao `apps/bff/.env.example` como documentação para setups futuros. Deploy blue-green do BFF re-executado para aplicar a variável.
* **Mitigação imediata**: container do BFF reiniciado/recriado para limpar o estado em memória do rate limiter (`Map` por processo, não persistente) e desbloquear login imediatamente enquanto a correção definitiva era aplicada.

---

# 2026-07-14 — feat(security): Biometric Bridge Phase 1A.1 console do armeiro + simulator gated

### Segurança/Implementação — identificação biométrica cloud-safe

* Adicionada migration `20260714000002_biometric_phase1a1.sql` com `biometric_devices.is_simulator`, `biometric_proof_consumptions` (`unique(proof_id)`) e RPC `record_biometric_proof` para consumir challenge e inserir proof em transação única.
* BFF ganhou `GET /api/biometric/challenges/:id/result`, helpers `assertUsableBiometricProof`/`consumeBiometricProof`, `simulator_available` na listagem de devices e rota simulator registrada apenas quando `NODE_ENV !== "production"` e `BIOMETRIC_SIMULATOR_ENABLED=true`.
* `/api/biometric/devices/pair` continua sem aceitar `is_simulator`; simulator é controlado exclusivamente pelo servidor e gera proof Ed25519 para validação sem hardware real.
* Criado console `/reserva/biometria` com `BiometricBridgeStatus` e `BiometricCaptureDialog`, estados de bridge ausente/offline/revogado/ativo/simulator, challenge, pending, success, failure, expired e retry.
* Painel `/reserva` troca o card legado de identificação por bridge local da reserva, removendo hardcode ZKTeco e apontando o armeiro para o console biométrico.
* Validação local: `cd apps/bff && pnpm test` passou com 112 testes; `pnpm --filter bff typecheck` passou; `pnpm --filter web typecheck` passou; `pnpm --filter web build` passou; ESLint focado nos arquivos da tarefa passou sem erros. `pnpm --filter web lint -- --quiet` segue falhando por 5 erros pré-existentes fora do escopo em `efetivo/_materiais-uso-client.tsx` e `reserva/livro/_livro-client.tsx`.

---

# 2026-07-14 — feat(security): Phase 0 do Biometric Bridge NITGEN/eNBioBSP

### Segurança/Implementação — fundação backend para biometria cloud

* Criada migration `20260714000001_biometric_bridge_foundation.sql` com `biometric_devices`, `biometric_challenges` e `biometric_proofs`, RLS habilitado, proof imutável e `challenge_id` único para bloquear replay.
* `biometric_templates` endurecida para matching tenant-wide futuro: `tenant_id` obrigatório, `template_hash`, formato/versão SDK, qualidade, versão de chave, device de enrollment e revogação.
* `apps/bff/src/routes/biometric.ts` deixa de tentar capturar/verificar USB no VPS; endpoints legados `/identify` e `/register` falham fechado com `BIOMETRIC_BRIDGE_REQUIRED`, e a nova base expõe pareamento/listagem/revogação de bridge, challenge e proof assinada.
* Adicionados helpers de canonicalização, verificação Ed25519 e política biométrica com testes contra tampering, replay, challenge expirada/consumida, tenant/reserva/device/document mismatch, usuário esperado, score baixo e status impedido/inativo.
* Hardening operacional: bucket dedicado `/api/biometric/*` em 30 req/min e redaction de assinatura, chaves e artefatos biométricos em logs.
* Correções pós-code-review: escopo por `reserve_memberships` para `admin_reserva`/`armeiro`, enforcement de `BIOMETRIC_MIN_SCORE`/usuário esperado/status/liveness no submit de proof, consumo de challenge com checagem explícita de linha `pending`, `tenant_id` defensivo em `biometric_templates` e triggers SQL de consistência tenant/reserva/device/challenge.
* Validação local: `pnpm --filter bff test` passou com 106 testes; `pnpm --filter bff typecheck` passou.

---

# 2026-07-14 — docs(security): spec enterprise do Biometric Bridge NITGEN/eNBioBSP

### Segurança/Arquitetura — biometria cloud com leitor local

* Criada spec canônica `docs/superpowers/specs/2026-07-14-biometric-bridge-design.md` para substituir o modelo incorreto de captura biométrica no BFF/VPS por **template central por tenant + bridge local Windows + prova biométrica assinada + BFF autoritativo**.
* Incorporado relatório de auditoria `docs/security/reports/biometric-bridge-architecture-audit-2026-07-14.md`: nota 7/10 para a direção antes dos hardenings, código atual ~2/10, lacunas obrigatórias para chegar a 9/10 e bugs existentes de URL sem `/api`.
* `docs/security.md` atualizado com seção canônica de biometria NITGEN/eNBioBSP: uso tenant-wide controlado, proof com nonce/TTL/consumo único, pareamento/revogação de bridge, dados sensíveis, enrollment presencial, rate limit dedicado e liveness/anti-spoof.
* Regra de produto formalizada: biometria cadastrada uma vez no tenant pode identificar o usuário em qualquer reserva do mesmo tenant, mas nunca substitui RBAC, tenant isolation, reserve scope, turno ativo, IDOR defense ou precondições de material/documento.

---

# 2026-07-13 (v32) — security(rbac): teto de privilégio ausente em profiles.ts + superadmin fora do H-RBAC (10 rotas) + Livro Digital + Usuários unificado + harness de pentest banking-grade

### Segurança — CRÍTICO (achado em code review, corrigido antes de produção ser afetada)

* **`PATCH /api/profiles/:id` faltava o teto de privilégio que a rota irmã `/:id/status` já tinha.** Um `armeiro`/`admin_reserva` conseguia setar `registration_status:"inactive"` (suspensão de conta) no profile de um `admin_global`/`admin_reserva` da própria reserva — a única guarda existente bloqueava só `armeiro` e só para o valor `"impedimento_administrativo"`. Corrigido espelhando a lógica da rota irmã (resolve o role do alvo escopado por tenant antes do update), incluindo bloqueio de auto-alteração do próprio status — com cuidado para não bloquear edições legítimas de outros campos que reenviam `registration_status` inalterado (o dialog de edição sempre inclui esse campo no payload).
* **`superadmin` (Nexus/SaaS-only) tinha acesso indevido a 10 rotas operacionais de tenant do BFF** (`admin.ts`, `categories.ts`, `dashboard.ts`, `handovers.ts`, `ocorrencias.ts`, `realtime.ts`, `reserves.ts`, `signatures.ts`, `ssa.ts`, `totp.ts`) — violação da regra H-RBAC canônica (`docs/security.md` §21 regra 6) já corrigida antes em `profiles.ts`, mas não varrida no resto do BFF. Removido de todos os `roleGuard(...)` e checagens inline de role operacionais; mantido apenas em `totp.ts /self-validate` (Nexus step-2 auth) e nos canais `nexus-events`/`nexus-errors` (legitimamente Nexus-only). Defesa em profundidade: `POST /api/auth/login` agora zera `tenantId`/`reserveId` da sessão quando `role=superadmin`, independente do que `tenant_memberships`/`default_tenant_id` contenham.
* **`profiles.tenant_id` (coluna inexistente, era `default_tenant_id`)** — regressão real de 2+ semanas (commit `889adc2`) que quebrava editar/desativar usuário; corrigida em `dashboard.ts`, `lendings.ts` (x2), `nexus.ts` e no filtro raw do canal `admin-profiles-grid` (`realtime.ts`).
* **CORS/502 disfarçado ao trocar de armeiro para modo usuário** — `middleware/auth.ts` renovava a sessão (sliding TTL) com sua própria instância de `getIronSession()`, independente da instância usada pela rota (`session.ts` `/api/session/mode`); as duas chamavam `.save()`, produzindo 2 headers `Set-Cookie` (~1.7KB cada, carregam o JWT completo) que excediam o `proxy_buffer_size` (4KB) do nginx → 502 "upstream sent too big header", que o browser reporta como falha de CORS (nginx aborta antes de encaminhar `Access-Control-Allow-Origin`). Corrigido com `try { await next() } finally { if (!alreadyPersisted) await session.save() }`. Hardening adicional aplicado direto na VPS: `proxy_buffer_size 16k`/`proxy_buffers 4 16k`, e `proxy_hide_header` nos 3 headers de segurança que o nginx re-adiciona (elimina duplicação/conflito entre nginx e `secureHeaders()` do Hono).

### Testes — Harness de pentest dinâmico banking-grade (novo)

* `docs/security/pentest-banking-grade-spec.md` + `pentest-banking-grade-prompt.md`: metodologia audit→plano→execução→teste, taxonomia de severidade com score numérico (nota mínima 9/10), estrutura de 7 suites planejadas.
* `apps/bff/src/__tests__/pentest/` (novo, roda contra o BFF de produção real com tokens reais — prova comportamento, não intenção de código): `pentest-fixtures.ts` (cria/limpa um tenant B descartável, com compensação de falha parcial e fallback de ban+rotação de senha quando o delete de conta falha), `cross-tenant-write.pentest.test.ts` (isolamento entre tenants), `privilege-escalation.pentest.test.ts` (teto hierárquico dentro do mesmo tenant — já provou os 2 achados críticos acima antes de chegarem sozinhos em produção).
* `apps/bff/package.json`: `pnpm test` não varre mais `pentest/` (exigia credenciais de produção que o job de CI padrão não tem, quebrando o pipeline); nova script `test:pentest` dedicada.

### Feat — Livro Digital de Serviço (guard de turno + timeline + histórico)

* Guard de turno agora bloqueia a página inteira de "Nova Saída"/cautela/lending (não só o submit) quando o armeiro não tem turno ativo — antes o BFF só rejeitava no `POST`, deixando o armeiro preencher todo o formulário antes de descobrir que precisava abrir turno.
* `logShiftEvent` corrigido para `await` em todos os call sites (bug latente: response podia ser enviado antes do evento ser gravado) e integrado também no fluxo legado `/api/lendings`.
* Timeline rica, histórico paginado, bloqueio de turno duplicado na mesma reserva.

### Feat — Cadastro de Usuários unificado

* "Cadastrar Usuário" (sem login) e "Criar Login" (militar já cadastrado) unificados num único dialog com toggle interno — eram dois fluxos redundantes/confusos.
* `tenant_id` nulo na criação de usuário corrigido; checagem de teto de privilégio + escopo de tenant adicionada antes da mutação de e-mail em `existing_user_id` (achado CRÍTICO: sem isso, um armeiro conseguia sequestrar o login de um `admin_global` do mesmo tenant só sabendo o UUID do profile — coberto por `crud-usuarios-create.spec.ts` U16).

### Testes — varredura completa da suite CRUD/jornadas (148 testes, 1a execução real em CI)

* `ci.yml`: novo job `e2e-suite` roda a suite completa (antes só manual) serializado após `e2e-smoke`, não bloqueando o deploy do BFF (sem ambiente de staging).
* 1a execução real confirmou 21 falhas determinísticas (não flakiness), a maioria stale desde antes desta sessão. Corrigidas por causa raiz:
  * `waitUntil:"networkidle"` → `"load"` em 16 arquivos de spec: o SSE do sino de notificações (`notification-bell.tsx`, migrado de WebSocket para SSE nesta mesma sessão) mantém conexão aberta, arrastando `networkidle` para perto do timeout do Playwright.
  * Seletores desatualizados (`role="option"` vs `<button>` real; "Fardamento" vs "farda"; "Voltar ao login" é `<a>` role="link", não `<button>`; heading do dialog casando com o botão de submit de mesmo texto; alt do logo é "Logo", não "APMCB"; label "Identificar Militar" renomeado).
  * Testes editando a "primeira linha" de tabelas reais de produção compartilhadas entre workers paralelos — reescritos para criar fixtures próprias e descartáveis.
  * `SearchInput` só filtra a lista de fato ao pressionar Enter (autocomplete-then-confirm), não a cada tecla digitada.
* `_material-dialog.tsx` (Arsenal): botão de submit só desabilitava durante `loading`, nunca por validação de formulário — inconsistente com o padrão já usado no dialog de usuários. Adicionado `canSubmit` espelhando as validações de `handleSave` (nome/categoria/calibre/veículo/validade/quantidade); corrigida uma trava de regressão introduzida pelo próprio fix (reabrir o dialog do mesmo material sem tocar em Qtd. deixava o botão preso desabilitado — `open` faltava nas deps do `useEffect` de repopulação de itens).
* 2 bugs reais de produção encontrados mas não corrigidos nesta sessão (decisão consciente — exigem novo endpoint de backend, fora do escopo seguro de um fix rápido em sistema de inventário de armamento): dialog de edição não pré-carrega itens físicos existentes para categorias com validade obrigatória; materiais com `quantidade_total=0` carregam Qtd.=0 sem aviso claro.

---

# 2026-07-11 (v31) — fix(auth): ativação de conta e recuperação de senha quebradas em produção (cookies HttpOnly) + demais rotas afetadas

### Segurança/Correção — CRÍTICO (achado em auditoria própria, confirmado via E2E contra produção)

* **`/auth/confirmar-conta` (ativação de conta por convite) e `/auth/update-password` (recuperação de senha) estavam completamente quebrados** para qualquer usuário real desde o hardening "Phase 2" (cookies `sb-*` forçados a `HttpOnly`, tanto no upgrade explícito de `/auth/exchange` quanto — de forma determinística, sem race — em `lib/supabase/server.ts`/`/auth/callback`). Client components que liam a sessão via `createBrowserClient()` (`document.cookie`) passavam a rodar como `anon`. Confirmado empiricamente: suíte `invite-suite` (`invite-activate.spec.ts`) tinha **10 de 19 testes falhando** (IA03–IA07, IA09–IA13).
* Ambas as páginas foram convertidas para Server Component (leem a sessão via `next/headers`, imune a HttpOnly) + client component só para a UI interativa. A troca de senha em si passou a rodar 100% no servidor via `auth.admin.updateUserById` (service role), eliminando a dependência de uma sessão legível no navegador.
* `/api/auth/update-password` agora revoga todas as sessões/refresh tokens antigos do usuário (`auth.admin.signOut(..., "global")`) após a troca — paridade com o comportamento antigo do SDK client-side, relevante no cenário "conta comprometida" que motiva a recuperação de senha.
* **Botão "Devolver" em Saídas (`_return-button.tsx`) — falha silenciosa com falso sucesso.** Fazia `UPDATE` direto via client Supabase sem checar linhas afetadas; a RLS bloqueava a escrita (sessão `anon`), retornando `error: null` e 0 linhas — o toast de sucesso aparecia mesmo sem nada ter sido devolvido no banco. Corrigido: agora usa `PATCH /api/lendings/:id/return` (rota BFF já existente, tenant-scoped, valida `status_legacy = "ativo"` e retorna 404 em vez de sucesso vazio).
* **Upload de foto de perfil e de materiais do arsenal** — Supabase Storage também exige sessão `authenticated` real; upload direto do navegador falhava (bucket privado, RLS `TO authenticated`). Movido para rotas Next.js server-side novas: `POST /api/profiles/photo` e `POST /api/arsenal/material-photo` (esta última reimplementa o mesmo allowlist de roles da policy RLS `material_photos_staff_write`).
* **Sino de notificações (`notification-bell.tsx`)** — canal Realtime do Supabase no navegador nunca abria (`auth.getUser()` client-side retornava `null`), então notificações não chegavam ao vivo (só no fetch inicial da página, sem atualização em tempo real). Migrado para o padrão SSE já usado no resto do sistema (`useSSERefresh`, canal `notifications` novo no BFF, service role + iron-session).
* Nas duas novas páginas de auth, navegação pós-sucesso usa `window.location.href` (hard navigation), não `router.replace` — mesma causa raiz do incidente de session-bleed cross-user já corrigido no commit `7204251`; as duas páginas (Server Components) e as 4 rotas POST novas declaram `export const dynamic = "force-dynamic"` — mesma causa raiz do commit `e059f7f` (cache cross-user em adaptador `@cloudflare/next-on-pages`).
* Novo `apps/web/src/lib/password-policy.ts` (`isPasswordStrongEnough`) — validação de força de senha no servidor, espelhando a regra já aplicada na UI (antes só client-side, contornável via fetch direto).
* Revisão de código sênior obrigatória (2 rodadas): 1 CRÍTICO + 1 ALTO encontrados e corrigidos antes do commit; 1 achado adicional (revogação de sessão em update-password) endereçado proativamente.

---

# 2026-07-11 (v30) — security(rls): vazamento cross-tenant em 11 tabelas + feat(arsenal): Manutenção de materiais + feat(relatorios): overhaul completo

### Docs — planejamento anti-IDOR enterprise

* Criada spec/harness de defesa anti-IDOR cobrindo qualquer referência externa a objeto, não só `/:id`: path/query/body IDs, arrays, filtros, metadata, Storage, Realtime/SSE, PDFs públicos, busca/autocomplete, relatórios e exportações.
* Regra de privilégio mínimo formalizada para BFF com `service_role`: mutation sensível deve carregar `tenant_id`, `reserve_id` ou owner field na própria query de escrita sempre que a tabela possuir esses campos; checagens separadas viram exceção documentada.
* `docs/security.md` atualizado com seção Anti-IDOR, roles atuais e regra canônica de `superadmin` Nexus-only.

### Segurança — anti-IDOR slice 1 aplicado

* `lendings`, `saidas` e `cautelamentos`: mutations críticas de custódia agora escrevem com predicado de `tenant_id` na própria query (`update/delete`) em vez de depender apenas de checagem anterior por `id`.
* `bulk-return`, rollback de lending, assinaturas, retornos, criação de saída/cautela e substituição de cautela agora validam linha afetada quando a operação depende de write tenant-scoped, reduzindo falso sucesso em corrida ou tentativa IDOR.
* Writes críticos de assinatura/retorno/substituição carregam pré-condições de estado e assinatura na própria query (`status`, `*_signature_id`, `active_*_id`), não apenas em leitura anterior.
* Criações de custódia agora validam IDs recebidos no corpo dentro do tenant da sessão (`profiles.default_tenant_id`, `material_types.tenant_id`, `reserves.tenant_id`) antes de inserir documentos.
* Retornos de saída/cautela executam rollback tenant-scoped do documento quando a liberação do item falha, evitando sucesso parcial silencioso.
* `superadmin` removido dos role guards operacionais de saídas e cautelamentos, preservando a regra Nexus/SaaS-only.
* Novo teste BFF `idor-write-scope.test.ts` bloqueia regressão de writes por `id` puro e `superadmin` em rotas operacionais de custódia.

### Segurança — OWASP input hardening

* Novo harness BFF `owasp-input-safety-harness.test.ts` adiciona guardrails estáticos contra regressões conhecidas de SQLi/XSS/CSRF em código de aplicação: raw SQL runtime, sinks HTML/script, CSP de produção e wiring de CSRF.
* `GridPdfButton` deixou de montar documento de impressão com `document.write`/`outerHTML`; exportação agora usa DOM API segura (`createElement`, `textContent`, `appendChild`) e allowlist para URL de logo.
* `docs/security.md` atualizado com seção canônica de SQL Injection, XSS e CSRF, incluindo escopo do harness e regra atual de CSRF via iron-session + `X-CSRF-Token`.

### Segurança — rate limiting enterprise

* Novo harness BFF `rate-limit-hardening-harness.test.ts` valida comportamento real do `routeRateLimiter`: bloqueio de `/api/auth/login` na 6ª tentativa por IP, headers/body de `429`, isolamento de buckets, preferência por `CF-Connecting-IP`, buckets dedicados e `/health` fora de `/api/*`.
* `RATE_LIMIT_PROFILES` centraliza o contrato de limites (`login`, `exchange`, `sensitive`, `general`, `authMe`, `publicVerify`) para evitar drift entre código, testes e documentação.
* `docs/security.md` e spec dedicada documentam Turnstile como camada anti-bot complementar, não substituta de throttling no BFF, e registram o risco residual de storage in-memory em escala multi-instância.

### Segurança — CRÍTICO (achado em auditoria própria, não relatado por terceiros)

* **Vazamento de dados cross-tenant via RLS em 11 tabelas**: `admin_global` e `superadmin` estavam agrupados numa mesma cláusula de policy SEM checagem de `tenant_id` em `cautelamentos`, `profiles`, `audit_logs`, `biometric_templates` (dados biométricos!), `category_requests`, `lendings`, `material_items`, `material_types`, `material_requests` e `admin_approval_requests`. Qualquer `admin_global`/`superadmin` de um tenant conseguia ler (e em vários casos escrever) registros de custódia de armamento, biometria e perfis de **qualquer outro tenant** da plataforma. O achado partiu da nova página de Relatórios (que passou a consultar `cautelamentos` diretamente via Supabase SSR/RLS), tornando o vazamento diretamente explorável a partir do client, não só teórico a nível de banco.
* **Regra canônica definida com o dono do produto**: `superadmin` é papel Nexus/SaaS-only e não deve acessar dado de tenant algum, sob nenhuma circunstância; `admin_global` deve ser sempre escopado ao próprio tenant (estrutura em cascata *dentro* do tenant, nunca cross-tenant). 5 migrations aplicadas em produção corrigindo todas as policies encontradas nesse padrão, removendo `superadmin` de toda cláusula de dado de tenant e adicionando escopo de `tenant_id`/`default_tenant_id` a `admin_global` onde faltava (`20260711000001` a `20260711000005`).
* Achado correlato em code review: o branch de `admin_global` reescrito para `category_requests` usava `reserve_memberships`, tabela cuja CHECK constraint nunca aceita esse role (código morto) — corrigido com checagem direta via `reserves.tenant_id` (`20260711000005`).

### Segurança — bloqueio de item vencido antes ausente

* **`validade_item` (ex: validade de colete balístico) só gerava alerta visual, nunca bloqueava emissão**: `POST /api/cautelamentos` e `POST /api/saidas` não comparavam a validade do item contra a data atual antes de autorizar saída/cautela — um item vencido podia ser normalmente retirado. Adicionado bloqueio 409 nos dois endpoints, comparando por data local (`America/Sao_Paulo`) em vez de UTC (evita bloquear ~3h antes do fim real do último dia válido).

### Novo — Materiais em Manutenção (danificados / perdidos / administrativo)

* Nova página `/reserva/arsenal/manutencao` (armeiro, admin_reserva) e `/admin/arsenal/manutencao` (admin_global, com filtro de reserva), acessível via novo item em acordeão no menu Almoxarifado/Arsenal. Cards/tabela, checkbox + exportação PDF/CSV, busca, mesmo padrão visual do restante do Almoxarifado.
* **Lacuna funcional real corrigida**: não havia nenhum jeito de declarar um material do próprio estoque (nunca retirado) como danificado, extraviado ou furtado — só era possível via devolução de uma saída/cautela ativa. Novo modal "Registrar Ocorrência" + rota `PATCH /api/arsenal/items/:id/ocorrencia`, com concorrência otimista (evita corromper o registro se o item mudar de posse entre a leitura e a gravação) e preservação do texto de notas pré-existente do item.
* `status_operacional` de `material_items` expandido de 7 para 13 valores (`avariado`, `furtado`, `em_pericia`, `bloqueado`, `em_transito`, `aguardando_baixa` além dos originais), com exigência de nº de B.O. (registro interno, não delegacia) para itens marcados como furtados. A CHECK constraint da coluna nunca tinha sido efetivamente aplicada em produção desde a criação da tabela — corrigida junto (`20260711000002`).
* Bugs pré-existentes encontrados e corrigidos no caminho: `isActive()` do sidebar usava `startsWith` puro e marcava o item pai como ativo mesmo dentro de uma rota-irmã aninhada; `GridSearchInput` nunca expunha `data-testid`, deixando os testes `crud-arsenal.spec.ts` C9/C10 quebrados em produção silenciosamente.

### Novo — Relatórios: seleção + PDF dinâmico, paginação, autocomplete escalável, Cautelas/Livro de Serviço

* Checkbox de seleção + exportação PDF dinâmica (`GridPdfButton`, com hash de integridade) e CSV nas 3 tabelas de detalhe; paginação "Ver mais" (10/20/30) substituindo a listagem de até 500 linhas de uma vez.
* Novo autocomplete assíncrono (`AsyncComboBox`, debounce + descarte de respostas fora de ordem) para o filtro de Usuário, preparado para 10k+ cadastros por tenant — o `<Select>` nativo anterior carregava a lista inteira no client. Dropdowns menores (Material/Categoria/Calibre/Posto) ganharam busca no topo da lista (`SearchableSelect`).
* Novo filtro "Tipo de Registro": Saídas (padrão) / Cautelas / Livro de Serviço — o relatório antes só enxergava `lendings`. Trocar o tipo reseta os filtros incompatíveis (status/material/categoria/calibre/usuário) e preserva De/Até/Posto.
* Livro de Serviço no relatório enriquecido: foto do usuário, material referenciado (resolvido via `lendings`/`cautelamentos` a partir do `subject_id` polimórfico), descrição completa — antes mostrava só tipo de evento e autor.
* `superadmin` removido do guard de acesso às duas páginas de Relatórios, consistente com a regra canônica de segurança acima.
* `/admin/relatorios` e `/reserva/relatorios` compartilham agora os mesmos componentes (`RelatorioFilterPanel`, `RelatorioDetailTable`, `RelatorioExportButtons`) — antes ~95% duplicados linha por linha.

### E2E — débito técnico de suite descoberto e corrigido durante regressão completa

* Regressão completa (1020 testes, 49 projetos) revelou um padrão sistêmico: 12 páginas foram migradas para "cards" como view padrão (toggle para tabela) sem atualização dos specs, que assumiam `<table>` sempre presente. Corrigido em `crud-arsenal`, `crud-saidas`, `crud-usuarios(-create)`, `smoke`, `regression`, `stress`, `visual-full`, `status-detail`, `admin-dec-estrutura`, `historico-usuario`, `arsenal-profile-feedback`, `reserva-cadastro`.
* Rename "Militares" → "Usuários" não propagado a specs (heading, botão "Cadastrar Militar" vs. "Cadastrar Usuário") — alinhado nos testes e, onde o próprio app tinha o rename incompleto (botão de submit do dialog ainda dizia "Cadastrar Militar"), corrigido no app também.
* `crud-saidas.spec.ts` S9/S10 testavam um fluxo "Devolver" que não existe mais (substituído por "Receber"/`DesarmamentoModal`) — reescritos para o fluxo atual; corrigido de quebra um botão de fechar sem `aria-label` no modal.
* `criar-login-real.spec.ts` ML01 usava o e-mail real do desenvolvedor como fixture de "criar usuário novo" — nunca idempotente após o primeiro run bem-sucedido (409 permanente). Trocado por e-mail gerado por run.
* `login-invite.spec.ts` (20 testes) referenciava `data-testid` que nunca existiram no componente — adicionados; arquivo segue não registrado em nenhum projeto do Playwright até validação end-to-end.
* Removido `apmcb-full.spec.ts`: arquivo órfão (não registrado em nenhum projeto), com corrupção de encoding mista (mojibake de duas origens diferentes) e 100% superseded por specs dedicados já existentes.
* Corrigida a mesma corrupção de encoding (mojibake) nas 3 linhas de cabeçalho deste próprio CHANGELOG.

### Infra

* `apps/web/playwright-report/index.html` estava listado em `.gitignore` mas continuava rastreado desde antes da regra existir (artefato de teste gerado a cada run, ruído constante de diff) — destrancado do git (`git rm --cached`).
* 7 screenshots avulsos de debug manual (sem relação com nenhuma tarefa em andamento) removidos do working tree.

### Regressão E2E — nota de execução

* Suite completa (1020 testes) ficou rodando por >17h contínuas durante este ciclo; identificado que a carga concorrente sustentada de múltiplos logins simultâneos estava disparando com frequência anormal o bug pré-existente de session-bleed do Cloudflare Workers (mitigação de `def1434` reagindo corretamente, mas a taxa de disparo tornava o login pouco confiável para uso real). Suite encerrada manualmente; BFF confirmado 100% consistente em request isolado (não é regressão desta sessão). Cobertura já obtida (>900 resultados) foi suficiente para identificar e corrigir todo o débito técnico listado acima.

### Code review

* Revisado por sub-agente sênior em duas rodadas (achados de segurança + achados de produto). Rodada 1: 1 CRÍTICO (race condition na rota de ocorrência), 2 ALTO (perda de dados em `descricao_adicional`, branch morto de RLS), 4 MÉDIO — todos corrigidos e reconfirmados pelo mesmo revisor antes deste commit. `tsc --noEmit` limpo em `apps/web` e `apps/bff`.

---

# 2026-07-10 (v29) — fix(arsenal): 400 no Storage ao exibir fotos de material + achado crítico de CI

### Bug Fixes

* **Fotos de material retornando 400 (bucket `material-photos`)**: `photo_url` era renderizado diretamente como `<img src>`, mas o bucket é privado — precisa de signed URL via `createSignedUrl`. Novo helper `withMaterialPhotoDisplayUrls` (`apps/web/src/lib/storage.ts`) resolve a signed URL para um campo separado (`photo_display_url`), preservando o valor bruto de `photo_url` intacto (o formulário de edição reenvia esse valor ao salvar sem trocar a foto — sobrescrevê-lo com uma URL temporária de 1h corromperia o dado permanente). Aplicado em `admin/arsenal`, `reserva/arsenal` e no detail sheet.
* **`resolvePhotoUrl` sem tratamento de erro (achado ALTO em code review)**: a chamada de rede ao Storage podia rejeitar o `Promise.all` inteiro por causa de UMA foto, derrubando a página de listagem completa. Adicionado try/catch na função SSOT — degrada para "sem foto" e loga via `console.error`.

### CI — achado crítico

* **`apps/web/package.json` tinha `"name": "web"` em vez de `"@apmcb/web"` desde o commit inicial do projeto.** Todo o CI filtra por `pnpm --filter @apmcb/web ...`; um filtro que não casa com nenhum pacote não falha — imprime "No projects matched" e sai com código 0. Ou seja: **os steps "Typecheck web" e o job "Build Web" nunca executaram de fato**, em nenhum push/PR desde o início do projeto — sempre reportaram sucesso sem checar nada. Corrigido renomeando o pacote; verificado manualmente que `pnpm --filter @apmcb/web typecheck`/`build` passam limpos (nenhuma quebra pré-existente estava sendo mascarada).

---

# 2026-07-10 (v28) — fix(arsenal): 401 do armeiro ao solicitar categoria/material ao admin da reserva

### Bug Fixes

* **401 Unauthorized ao armeiro solicitar nova categoria/material**: reportado em produção (`GET /api/categories` e `POST /api/categories/request` retornando 401 para role `armeiro` em `/reserva/arsenal?tab=categorias`). Causa raiz: 3 componentes client-side (`_category-manager.tsx`, `material-detail-sheet.tsx`, `_aprovacao-client.tsx`) usavam um padrão legado `getBearerHeaders()` que obtinha o token via `supabase.auth.getSession()` no browser — mecanismo que dependia das cookies `sb-*` serem legíveis por JS. Desde a migração dessas cookies (e de `apmcb_session`) para HttpOnly (`/api/auth/upgrade-session`, endurecimento de segurança anterior), `document.cookie` passou a retornar vazio e `getSession()` sempre `null`, então nenhum header `Authorization` era enviado — e como o `fetch` também não usava `credentials: "include"`, a cookie de sessão HttpOnly também não ia junto. O BFF (`authMiddleware`) não encontrava nem iron-session nem Bearer válido → 401. Reproduzido e confirmado em produção via Playwright (`document.cookie === ""` com usuário autenticado; replay exato da chamada quebrada retornou 401 idêntico ao relatado).
* **Fix**: os 3 arquivos passaram a usar `bffFetch()` (`apps/web/src/lib/bff-client.ts`), helper já existente e testado que usa `credentials: "include"` (envia a cookie HttpOnly `apmcb_session`) + header CSRF (`X-CSRF-Token`), eliminando a duplicação de `getBearerHeaders()`/`BFF_URL` copiada em 3 lugares (SRP/DRY). Corrige, no mesmo passo, o fluxo simétrico do admin (aprovar/rejeitar solicitação de material em `_aprovacao-client.tsx`) e as 3 solicitações de material do armeiro (adição, ajuste de estoque, desativação) em `material-detail-sheet.tsx`, que sofriam do mesmo bug.
* Validado em produção via Playwright: chamada replicada com o padrão corrigido (`credentials:"include"` + CSRF) retornou `201 Created` (antes: `401`).
* Novo teste de regressão E2E `CAT08` (`apps/web/e2e/bug-sprint-001.spec.ts`) exercita o submit real do formulário de solicitação de categoria pelo armeiro e falha explicitamente em caso de 401 — os testes `CAT01-03` pré-existentes só checavam visibilidade de botão/modal, sem exercitar a chamada de rede, e por isso não pegaram esta regressão.
* Revisado por sub-agente de code review (CLAUDE.md): 0 itens CRÍTICO/ALTO. Itens MÉDIO/BAIXO (cobertura de teste do submit real — endereçada com CAT08; inconsistência menor de `friendlyApiError` em `_aprovacao-client.tsx`; hidratação de CSRF token em nova aba) documentados como follow-up, não bloqueiam este commit.
* **Achado correlato, já corrigido por outro agente em paralelo**: durante a reprodução, um redirect inesperado de `/reserva/arsenal` para `/efetivo` foi observado para o mesmo usuário `armeiro` — rastreado até `apmcb_mode` cookie stale via cache cross-user em rotas GET, já corrigido em `main` pelo commit `e059f7f` ("fix(auth): causa raiz do session-bleed - GET routes cacheadas cross-user"), anterior a este.

---

# 2026-07-10 (v27) — fix(auth): session-bleed cross-user no login/logout + pendências do checklist

### Bug Fixes — CRÍTICO (incidente de produção)

* **Session-bleed cross-user no login**: usuário logava com uma conta e, momentaneamente, a UI renderizava dados de outro usuário já autenticado anteriormente na mesma aba (reproduzido em `usuario`, `admin_reserva` e `admin_global`), com erro de hidratação React #418 no console. Causa raiz (confirmada via `git blame` — bug presente desde o commit inicial do fluxo de login, não é regressão recente): navegação client-side "soft" (`router.replace`/`push`) após login/logout permitia que o Router Cache do Next.js reaproveitasse payload RSC de uma sessão anterior na mesma aba.
* **Fix**: `router.replace`/`push` trocado por `window.location.href` (hard navigation) em `login/page.tsx`, `auth/exchange/page.tsx` (fluxo de convite/reconvite — mesmo bug, encontrado em code review), `header.tsx`, `_sign-out-button.tsx` (efetivo/perfil), `registro-pendente/page.tsx`, e em toda a área `/nexus` (superadmin): `nexus/login/page.tsx`, `nexus-header.tsx`, `nexus-sidebar.tsx`, `use-nexus-guard.ts`.
* **Logout não destruía a sessão do servidor**: `handleSignOut()` chamava apenas `supabase.auth.signOut()` (limpa cookies `sb-*`), nunca o endpoint do BFF que destrói a iron-session — o cookie `apmcb_session` sobrevivia ao "logout". Corrigido: todos os pontos de logout agora chamam `POST /api/auth/logout` (ou `/api/nexus/logout`) antes de limpar os cookies do Supabase, centralizados em `apps/web/src/lib/auth-actions.ts` (`signOutAndRedirect`).
* **CSRF podia bloquear logout silenciosamente**: `/api/auth/logout` e `/api/nexus/logout` exigiam header CSRF; numa aba nova sem token em `sessionStorage`, o logout falhava com 403 sem o usuário perceber, deixando a sessão órfã no servidor. Ambas as rotas foram isentas do middleware de CSRF (`apps/bff/src/middleware/csrf.ts`) — pior caso de um logout forjado via CSRF é deslogar a própria vítima, sem escalonar privilégio nem vazar dado.
* Revisado 2x por sub-agente code-reviewer (CLAUDE.md): 1º pass achou 1 CRÍTICO (`auth/exchange/page.tsx` esquecido) + 1 ALTO (gap de CSRF) + 1 MÉDIO (duplicação); todos corrigidos e confirmados no 2º pass. Commit `7204251`.

### Pendências conhecidas (checklist DoD em andamento, não bloqueiam este commit)

* **Validação visual do fix acima**: aplicado e commitado/pushed, mas ainda sem confirmação do usuário testando ao vivo em produção.
* **Auditoria de toasts (i18n + vazamento de erro técnico)**: ~65 call sites em 33 arquivos já corrigidos por agente em background, mas o resultado está isolado em worktree não revisado nem mergeado (`.claude/worktrees/agent-a9a50856f49826ba2`, branch `worktree-agent-a9a50856f49826ba2`) — pendente review + merge em `main`.
* **Regressão E2E completa (DoD etapa 15)**: run anterior (~660+ testes) foi interrompido propositalmente para não contaminar a investigação do incidente crítico acima; precisa ser re-executado do zero e triado.
* **Relatório final do DoD (etapa 20)**: ainda não gerado em `docs/enterprise/reports/` para o ciclo desta fase (Livro Digital Fase 6-B + hardening de auth).
* Múltiplos worktrees de agentes em background de sessões anteriores ainda presentes em `.claude/worktrees/` (`git worktree list`) — avaliar quais têm trabalho aproveitável antes de limpar.

---

# 2026-07-09 (v26) — fix(livro): TOTP/biometria obrigatórios em turno + regressões de sessão HttpOnly

### Security

* **Fase E do Livro Digital**: abrir/fechar turno de armeiro agora exige TOTP ou biometria (`auth_mode` no BFF, novo `ShiftAuthDialog` no frontend). Aba de biometria fica oculta na UI até o SDK ZKTeco real estar integrado — o stub atual (`verify()` sempre `false`) e a ausência de leitor USB no VPS tornariam essa opção uma autenticação que sempre falha.
* **`POST /api/biometric/register`**: bloqueado cross-tenant para `admin_reserva`/`admin_global` — só podem registrar biometria de usuários do próprio tenant (service_role ignora RLS; validação movida para a rota).
* **`validateSelfBiometric`**: agora varre todos os templates registrados do usuário, em vez de comparar contra um template arbitrário (`.limit(1)` sem `.order()`).
* Removido `POST /api/biometric/self-verify` — endpoint morto, sem caller no frontend.
* Guard contra `FINGERPRINT_SDK=mock` em produção (`NODE_ENV=production` bloqueia o SDK de testes).

### Bug Fixes

* **TOTP 422 "Autenticador inválido" (matrícula 000003)**: catches que engoliam a exceção de decrypt/chave (`totp.ts`, `shift-auth.ts`, `biometric.ts`) agora logam a causa raiz via `lib/logger.ts` — sem isso o incidente era indiagnosticável a partir dos logs do servidor.
* **"Meu Perfil" sem UI de TOTP**: `TOTPSetupCard` adicionado a `/efetivo/perfil`; novo `POST /api/totp/reconfigure` permite regenerar o secret quando de fato está corrompido — restrito ao caso em que o secret atual falha em `readSecret()`, para não abrir bypass do rate limit de tentativas.
* **`/efetivo/historico` e páginas irmãs travadas em "Carregando..." infinito**: `getSession()` client-side (quebrado desde a migração dos cookies `sb-*` para HttpOnly) trocado por `bffFetch`/cookie de sessão em `_historico-client.tsx`, `_materiais-uso-client.tsx`, `_minhas-cautelas-client.tsx`, `TOTPDisplay`, `TOTPSetupCard`.
* **`POST /api/shifts/open`**: ordem de validação corrigida — turno já ativo e tenant são checados antes de consumir o código TOTP, evitando queimar o código numa tentativa que sempre resultaria em 409.
* **`auth.ts` login failure**: removido `catch {}` vazio — falha ao gravar `auth.login_failed` agora é logada (evento de monitoramento de segurança não pode se perder sem rastro).

### Infra

* Container Docker órfão `apmcb-nginx` (status `Created`, nunca esteve ativo) removido do VPS junto com o volume `apmcb_nginx_logs` — host nginx (systemd) é o proxy canônico deste ambiente.
* `docker-compose.yml` / `docker-compose.prod.yml`: `TOTP_ENCRYPTION_KEY` e `CORS_ORIGINS` adicionados ao ambiente do BFF (o fail-fast no boot exigia essas vars e elas não estavam sendo repassadas pelo compose); rotação de logs (`json-file`, 50m × 5) adicionada em ambos.

### Docs

* Auditoria de observabilidade de logging (`docs/enterprise/reports/observability-audit-2026-07-08.md`) e spec de implementação faseada (`docs/enterprise/specs/observability-logging-enterprise.md`).

---

# 2026-07-08 (v25) — fix(csrf): exchange page nao armazenava csrfToken + fallback localStorage

### Bug Fixes

* **`auth/exchange/page.tsx`**: após o login via exchange (magic link / fluxo de tokens), o BFF retornava `{ landAt, csrfToken }` mas a página só lia `data.landAt` e descartava `csrfToken`. Sem o token em `sessionStorage`, todas as requisições mutantes (POST/PUT/DELETE) do browser falhavam com 403 "CSRF token inválido". Adicionado `if (data.csrfToken) setCsrfToken(data.csrfToken)` após o exchange bem-sucedido.
* **`lib/csrf.ts` — `getCsrfToken()`**: adicionado fallback para `localStorage` quando `sessionStorage` está vazio. Permite que `storageState` do Playwright capture o CSRF token (que é persistido em `localStorage` pelo armeiro-auth.setup) e o reuse em testes que usam storageState sem passar pelo fluxo de login completo.
* **`e2e/setup/armeiro-auth.setup.ts`**: após login, copia o CSRF token de `sessionStorage` para `localStorage` antes de salvar o `storageState`, garantindo que testes E2E com storageState tenham o token disponível.

---

# 2026-07-08 (v24) — refactor(bff-client): centraliza fetch BFF com timeout e tratamento de 401

### Refactoring

* **`lib/bff-client.ts`** (novo): SSOT para chamadas ao BFF. Centraliza `credentials: "include"`, AbortController com timeout de 10s (previne spinner infinito quando BFF não responde), redirect automático para `/login` em 401/403, e retorno consistente `{ ok, status, data }`.
* **`_livro-client.tsx`, `_historico-client.tsx`, `_admin-livros-client.tsx`**: removidas as três cópias locais de `bffFetch` e `BFF_URL`; agora importam de `@/lib/bff-client`. Elimina DRY violation identificada em code review.

### Bug Fixes

* **Spinner infinito (LDS01, LDS04)**: timeout de 10s no AbortController garante que o `fetch()` rejeite mesmo quando o BFF não responde — `finally { setLoading(false) }` passa a ser chamado em todos os casos.

---

# 2026-07-08 (v23) — fix(livro): remove getSession/Bearer token quebrado por Phase 2 HttpOnly

### Bug Fixes

* **LivroClient, HistoricoClient, AdminLivrosClient**: após a Phase 2 de segurança, os cookies `sb-*` foram tornados HttpOnly, fazendo `supabase.auth.getSession()` no browser retornar `null`. Os três componentes do Livro Digital usavam esse token como `Authorization: Bearer` para o BFF — que agora autentica exclusivamente via `apmcb_session` (iron-session). Removido `createClient`, estado `token`, `useEffect` de `getSession`, guard `if (!token) return` e parâmetro `token` em `bffFetch`. Componentes agora chamam o BFF com `credentials: "include"` diretamente. Corrige LDS01–LDS14 (spinner infinito).
* **try/catch em fetchers**: adicionado `try/finally` em `loadData`, `loadShifts` e `toggleExpand` para garantir que os estados de loading sejam sempre resetados em caso de falha de rede, com `toast.error` descritivo.

---

# 2026-07-08 (v22) — E2E: React Hydration Guard no wrong-credentials test

### Bug Fixes

* **e2e smoke**: `wrong credentials` falhava consistentemente porque `fill()` e `pressSequentially()` rodavam antes da hidratação do React — o input controlado era resetado para `""` no mount, mantendo o botão desabilitado. Adicionado `waitForFunction` que aguarda `__reactFiber$` no `input#email` (indica que o React montou e os event handlers estão em place) antes de interagir. Também adicionado `expect(btn).toBeEnabled()` como guarda explícito antes do click.

---

# 2026-07-08 (v21) — Exchange Timeout + E2E Reliability Fixes

### Bug Fixes

* **exchange/page.tsx**: Fetch BFF sem timeout ficava suspenso até o TCP timeout do browser (~75s) quando o BFF estava indisponível — usuário travava na tela de exchange sem mensagem de erro. Adicionado `AbortController` com 15s que garante redirect imediato para `/auth/error`
* **e2e harness**: `login()` passava `TimeoutError` genérico quando exchange redirecionava para `/auth/error` (BFF fora do ar) — agora lança erro descritivo que comunica a causa real, permitindo retry automático do Playwright
* **e2e smoke**: `wrong credentials` usava `fill()` que pode não disparar `onChange` do React quando hidratação do Suspense ainda está pendente (beforeEach usa `domcontentloaded`). Trocado por `pressSequentially()` que dispara eventos de teclado por caractere

---

# 2026-07-08 (v20) — Code Review Fixes: Realtime Singleton + HttpOnly Deploy

### Bug Fixes

* **CF Pages**: `/api/auth/upgrade-session` faltava `export const runtime = "edge"` — bloqueava deploy desde o commit da Phase 2
* **BFF realtime**: `stream.sleep(25_000)` bloqueava até 25s após disconnect do cliente, mantendo Supabase WebSocket pendurado. Substituído por Promise abortável com `clearTimeout` em `onAbort`
* **BFF realtime**: `createClient()` era criado por conexão SSE (N usuários = N WebSockets de service role). Movido para singleton de módulo com `removeChannel(rtChannel)` no cleanup (em vez de `removeAllChannels()` que destruiria canais de outras conexões)
* **BFF realtime**: `admin-profiles-grid` sem filtro de tenant — service role bypassa RLS, entregando notificações de profiles de outros tenants. Adicionado `filter: tenant_id=eq.${tenantId}` (consistente com armeiro-sync e arsenal-sync)
* **E2E global-setup**: `Promise.allSettled()` engolia falhas de login silenciosamente; adicionado `console.warn` por entrada rejeitada
* **Deploy script BFF**: URL do repo estava incorreta (`diegocpro` → `diegoprodev`); corrigida no servidor

### Security

* `useSSERefresh` e BFF SSE proxy: todos os canais filtraram por sessão (userId/tenantId), nunca por input do cliente — IDOR mitigado por design

### Performance

* **E2E rate-limiting eliminado**: `login()` agora usa tokens pré-autenticados do `global-setup` (1x por user por suite) em vez de `signInWithPassword` por teste. Elimina ~37 chamadas à API Supabase Auth por run do chromium smoke suite
* **E2E**: removida navegação `/login` intermediária do `login()` — Phase 2 usa HttpOnly cookies, não localStorage. Reduz 1 CF Pages round-trip por login
* `playwright.config.ts`: projeto `chromium` com `navigationTimeout: 60s` e `retries: 2` como safety net

---

# 2026-07-08 (v19) — Phase 2 Security: SSE Realtime Proxy + HttpOnly Cookies

### Security

**Realtime migrado para SSE via BFF — JWT nunca sai do servidor**

Eliminação completa do Supabase Realtime WebSocket do browser. A constraint que impedia `sb-*` cookies de serem HttpOnly (WebSocket precisava ler JWT via `document.cookie`) foi removida.

**Nova arquitetura:**
```
Browser → SSE (iron-session cookie) → BFF → Supabase Realtime (service role)
```

| Mecanismo | Antes | Depois |
|---|---|---|
| JWT em localStorage | ✅ Nunca | ✅ Nunca |
| iron-session (apmcb_session) | ✅ HttpOnly | ✅ HttpOnly |
| sb-* cookies | ⚠️ SameSite=Lax, NÃO HttpOnly | ✅ HttpOnly, SameSite=Strict |
| Supabase WebSocket no browser | ⚠️ Ativo (lê JWT) | ✅ Eliminado |

**Componentes da migração:**

* **BFF `GET /api/realtime/stream`** (novo) — endpoint SSE autenticado por iron-session. Cria subscriptions Supabase com service role server-side. Channel registry com filtros construídos da sessão (nunca do client). Role guard + nexusAuthorized check por canal. Keepalive ping 25s + `removeAllChannels()` no cleanup (garante fechamento do WebSocket).

* **`useSSERefresh` hook** (novo) — substitui `useRealtimeRefresh`. `EventSource` com `withCredentials: true`. Suporta callback opcional (`onEvent`) para componentes com estado local. `window.__rtReady = true` no evento `ready` (compatível com E2E).

* **`useRealtimeRefresh`** (deletado) — hook anterior dependia de `createBrowserClient.auth.getSession()` para obter JWT de cookies não-HttpOnly. Removido sem deprecation wrapper.

* **`GET /api/auth/upgrade-session`** (novo) — Next.js API route que re-emite `sb-*` cookies como HttpOnly imediatamente após login (`setSession` server-side força `httpOnly: true` via `setAll` override em `server.ts`).

* **`server.ts`** — `setAll` callback agora força `httpOnly: true, sameSite: "strict"` em todos os cookies Supabase SSR setados server-side.

* **Smoke test `[PASS] auth cookies are HttpOnly`** — removido `test.fail(true)`. Teste agora passa.

### Refactor

* `RealtimeEfetivoSync`, `RealtimeArmeiroSync`, `RealtimeArsenalSync` — substituídos por `useSSERefresh`; userId/tenantId removidos das props (BFF lê da sessão).
* `_users-table.tsx` — substituído canal Supabase direto por `useSSERefresh("admin-profiles-grid")` + `useEffect` que sincroniza `initialUsers` após `router.refresh()`.
* `event-table.tsx` (Nexus) — substituído canal direto por `useSSERefresh("nexus-events", onEvent)` com callback `useCallback`; BFF envia `row` completo para atualização de estado local sem refetch.
* `nexus/erros/page.tsx` — idem com `nexus-errors`; SSE só conecta após `nexusAuthorized` (guard do nexus).

### Fixos (code review pós-implementação)

* `realtime.ts` — cleanup usa `removeAllChannels()` em vez de `removeChannel()` — garante fechamento do WebSocket subjacente.
* `realtime.ts` — guard `if (alive)` antes do primeiro `writeSSE({ event: "ready" })` — previne exception não capturada se cliente desconectar durante setup.

### Process

* **Regra canônica de code review** adicionada ao `CLAUDE.md` — sub-agente sênior obrigatório antes de todo commit com código de produção.

---

# 2026-07-07 (v18)

### Fixes

**Realtime — Correção raiz: `event:"*"` + `filter` rejeitado pelo servidor**

* **Root cause**: Supabase Realtime rejeita a combinação `event:"*"` + `filter` com `system: "Unable to subscribe to changes"` APÓS confirmar o canal com `SUBSCRIBED`. Como `window.__rtReady` é setado no callback de canal (não de postgres_changes), os testes acreditavam que a subscription estava ativa.
* **Fix `use-realtime-refresh.ts`**: auto-expande `event:"*"` + filtro em INSERT + UPDATE + DELETE separados quando `filter` está presente
* **Fix em todos os componentes sync**: eventos explícitos em `RealtimeEfetivoSync`, `RealtimeArmeiroSync`, `RealtimeArsenalSync` (sem wildcard quando há filtro)

**Realtime — Session await antes de subscribe**

* **Root cause**: Componentes com canal Realtime direto (`_users-table.tsx`, `event-table.tsx`, `nexus/erros/page.tsx`) criavam canal sem aguardar `getSession()` → phx_join com JWT anon → RLS bloqueava todos os eventos
* **Fix**: todos os canais diretos agora aguardam `supabase.auth.getSession().then(...)` com flag `cancelled` para cleanup seguro

**Realtime — `removeAllChannels()` → `removeChannel(channel)`**

* `event-table.tsx` e `nexus/erros/page.tsx` usavam `supabase.removeAllChannels()` (destrutivo — remove subscriptions de TODOS os componentes)
* **Fix**: substituído por `supabase.removeChannel(channel)` com referência correta

**DB Migration — `profiles` e `notifications` na publication Realtime**

* `supabase/migrations/20260707000002_realtime_profiles_notifications.sql`: adiciona `profiles` e `notifications` com `REPLICA IDENTITY FULL`
* Sem esta migration, `RealtimeEfetivoSync` (filtro por `profiles.id`) e `NotificationBell` nunca recebiam eventos WAL

**E2E — Realtime Debug Harness**

* `e2e/harness/realtime-debug.ts`: `attachRealtimeMonitor()` + `waitForRTReady()` com diagnóstico estruturado
* `e2e/realtime-suite.spec.ts` reescrito: elimina `console.log` ad-hoc; todos os triggers aguardam `__rtReady`
* `window.__rtReady` em vez de `data-realtime-ready` em `<html>` (evita conflito com reconciliação RSC)

**Resultado pós-deploy**: `realtime-suite` — **3 passed, 3 skipped** (RT-02, RT-03, RT-05 passam; RT-01/04/06 skip por falta de dados no ambiente)

### E2E Smoke — Correções CI

* **"admin sidebar has all 5 nav items"** (CI blocker): locators scopados a `<aside>` — `BottomNav` renderiza links com os mesmos nomes causando strict mode violation (`getByRole` encontrava 2 elementos)
* **"no JWT in localStorage"**: corrigido label de `[FAIL]` para `[PASS]` — `@supabase/ssr` usa cookies, não localStorage; o teste PASSA corretamente
* **"auth cookies are HttpOnly"**: comentário atualizado com a constraint arquitetural completa (Realtime WebSocket precisa de JWT legível por JS em `sb-*` cookies)

### Auditoria de Segurança

**Estado atual documentado:**

| Mecanismo | Status |
|---|---|
| JWT em `localStorage` | ✅ Nunca armazenado (`@supabase/ssr` usa cookies) |
| `apmcb_session` (iron-session) | ✅ HttpOnly, Secure, SameSite=Strict |
| Cookies `sb-*` (Supabase SSR) | ⚠️ SameSite=Lax, NÃO HttpOnly |
| CSRF token | ✅ Dentro da iron-session criptografada |

**Constraint arquitetural — por que `sb-*` não pode ser HttpOnly hoje:**
O Supabase Realtime (`createBrowserClient`) lê o JWT de `sb-*` via `document.cookie` para autenticar o WebSocket (phx_join). Cookies HttpOnly não são acessíveis via JS → `getSession()` retorna null → WebSocket usa anon JWT → RLS bloqueia todos os eventos privados.

**Migração Phase 2 (roadmap):**
1. BFF emite token efêmero de curta duração exclusivo para Realtime
2. `createBrowserClient` configurado com storage em memória (JWT nunca persistido)
3. Server Components lêem iron-session via `IRON_SESSION_SECRET` compartilhado
4. Cookies `sb-*` eliminados — `apmcb_session` torna-se a única sessão

---

# 2026-07-07 (v17)

### Features

**Realtime completo — toda movimentação de estoque, saídas e solicitações**

**DB Migrations:**
- `material_items` e `material_types` com `REPLICA IDENTITY FULL` + `ALTER PUBLICATION supabase_realtime ADD TABLE` — almoxarifado agora dispara WAL events para clientes Realtime
- Tabelas agora na publication: `audit_logs`, `lendings`, `material_items`, `material_requests`, `material_types`

**Hook compartilhado `useRealtimeRefresh`** (`apps/web/src/hooks/use-realtime-refresh.ts`):
- SSOT para subscriptions postgres_changes; elimina código duplicado
- Aceita event `"*"` (wildcard `REALTIME_POSTGRES_CHANGES_LISTEN_EVENT.ALL`) além de INSERT/UPDATE/DELETE
- Re-cria canal automaticamente quando `channelName` ou subs mudam (suporte a `userId` dinâmico)
- Todos os 3 componentes de sync usam o hook

**Componentes de sync criados:**
- `RealtimeArmeiroSync` — `lendings` + `material_requests` filtrados por `tenant_id` — incluído em `/reserva`, `/reserva/saidas`, `/reserva/solicitacoes`
- `RealtimeArsenalSync` — `material_items` + `material_types` + `lendings` filtrados por `tenant_id` — incluído em `/reserva/arsenal` e `/admin/arsenal`
- Filtro explícito por `tenant_id` necessário: Supabase Realtime não avalia corretamente policies com `STABLE` functions (`auth_role`, `auth_tenant_id`) no contexto WAL para subscriptions sem filtro

**`RealtimeEfetivoSync` refatorado** para usar `useRealtimeRefresh`; event `"*"` substitui INSERT+UPDATE separados

**Layout `/efetivo/layout.tsx` criado:**
- Monta `RealtimeEfetivoSync` uma única vez para todas as sub-rotas do cadete
- Cobre: `/efetivo`, `/efetivo/solicitacoes`, `/efetivo/minhas-cautelas`, `/efetivo/historico`, `/efetivo/perfil`
- Removida subscription duplicada de `/efetivo/page.tsx`

**Cobertura realtime pós-v17:**

| Rota | Tabelas subscritas | Resultado |
|---|---|---|
| `/efetivo` (e sub-rotas) | lendings, material_requests, profiles | ✅ via layout |
| `/reserva` (home counts) | lendings, material_requests | ✅ novo |
| `/reserva/saidas` | lendings, material_requests | ✅ novo |
| `/reserva/solicitacoes` | lendings, material_requests | ✅ novo |
| `/reserva/arsenal` | material_items, material_types, lendings | ✅ novo |
| `/admin/arsenal` | material_items, material_types, lendings | ✅ novo |

### E2E

**`e2e/realtime-suite.spec.ts`** — RT-01..RT-06: verifica que DOM atualiza sem page.reload()
- RT-01: `/efetivo` — devolução via DB → badge "Em uso" decrementa
- RT-02: `/efetivo/solicitacoes` — aprovação via DB → status badge muda para "Aprovado"
- RT-03: `/reserva` — INSERT em material_requests → count "Pendências Remotas" incrementa
- RT-04: `/reserva/saidas` — devolução via DB → lista de ativos atualiza
- RT-05: `/reserva/solicitacoes` — INSERT em material_requests → nova linha aparece
- RT-06: `/reserva/arsenal` — UPDATE em material_items → página recarrega sem reload

**`e2e/harness/realtime.ts`** — helpers de trigger via `supabaseAdmin()`:
`getActiveLendingForCadete`, `triggerLendingReturn`, `triggerSSAInsert`, `triggerSSAApproval`, `cancelSSARequest`, `triggerMaterialItemUpdate`

Adicionado projeto `realtime-suite` em `playwright.config.ts`

### Fixes (pós-v17)

- `triggerSSAInsert`: removido `expires_at` do INSERT (violava constraint `expires_requires_approval` — pendente não pode ter validade)
- `useRealtimeRefresh`: sinaliza `data-realtime-ready` no `<html>` quando canal WS é SUBSCRIBED (sincronização de testes)
- `realtime-suite.spec.ts`: locators corretos baseados no DOM real; tests aguardam `html[data-realtime-ready]` antes de cada trigger
- `_solicitacoes-client.tsx` (armeiro): `useEffect` sincroniza `requests` com `initialRequests` quando `router.refresh()` traz novos dados
- Subscriptions do armeiro/arsenal: adicionado filtro `tenant_id=eq.${tenantId}` — Supabase Realtime falha silenciosamente para subscriptions sem filtro quando RLS usa `STABLE` functions com `auth.uid()`

---

# 2026-07-06 (v16)

### Features

**Realtime — `/efetivo` atualiza sem recarregar a página**

* **Root cause**: tabela `lendings` não estava na publication `supabase_realtime` — eventos WAL nunca chegavam ao cliente Supabase Realtime; `RealtimeEfetivoSync` subscrevia a `postgres_changes` mas nunca recebia nada
* **Migration** (`enable_realtime_lendings_material_requests`):
  * `ALTER TABLE public.lendings REPLICA IDENTITY FULL` — inclui todos os campos nos eventos WAL (necessário para filtros por coluna em UPDATE/DELETE)
  * `ALTER TABLE public.material_requests REPLICA IDENTITY FULL`
  * `ALTER PUBLICATION supabase_realtime ADD TABLE public.lendings`
  * `ALTER PUBLICATION supabase_realtime ADD TABLE public.material_requests`
* **`RealtimeEfetivoSync`** (`apps/web/src/components/efetivo/realtime-efetivo-sync.tsx`): adicionadas subscriptions a INSERT + UPDATE em `material_requests` filtradas por `military_id=eq.userId` — cobre atualização de status de solicitações SSA em tempo real
* Efeito: devoluções pelo armeiro e aprovações/rejeições de SSA agora refletem instantaneamente na página `/efetivo` do cadete sem necessidade de recarregar

---

# 2026-07-05 (v15)

### Bug Fixes

**BFF — `checkTotpForMatricula`: remoção de filtro `tenant_id` inexistente em `profiles`**

* **Root cause**: `checkTotpForMatricula` filtrava `profiles` com `.eq("tenant_id", tenantId)`. A tabela `profiles` NÃO tem coluna `tenant_id` — PostgREST retornava HTTP 400 → SDK tratava como `profErr` → retornava 404 "Credenciais inválidas" para qualquer matrícula válida
* **Fix** (`apps/bff/src/routes/totp.ts`): removido `.eq("tenant_id", tenantId)` da query de `profiles`; adicionado lookup separado em `tenant_memberships` para garantir isolamento de tenant sem depender de coluna inexistente
* Efeito: fluxo "Receber Material" (armeiro identifica o militar via TOTP) agora funciona corretamente em produção

**BFF — `POST /api/ssa/requests`: null guard defensivo no mapeamento `itemRows`**

* **Fix** (`apps/bff/src/routes/ssa.ts`): substituída asserção não-nula `availMap.get(id)!` por guard explícito que retorna 409 e faz rollback da `material_requests` se o material não for encontrado no mapa; `nome` e `categoria` têm fallback `"N/A"` para campos opcionalmente nulos
* Envolto em `try/catch` para capturar TypeError antes de propagar como 500

### E2E

* `e2e/fluxo-receber.spec.ts` — RECV-01..05: testes de regressão do fluxo "Receber Material"
  * RECV-01: `POST /api/lendings/identify` matrícula válida + TOTP errado → 401 (nunca 404 por bug de tenant)
  * RECV-02: matrícula inexistente → 404
  * RECV-03: payload inválido → 400
  * RECV-04: modal abre no clique "Receber Material"
  * RECV-05: TOTP válido do cadete → 200 com `profile`
* `e2e/fluxo-ssa.spec.ts` — SSA-01..05: testes de regressão do fluxo "Solicitar Armamento"
  * SSA-01: `GET /available-materials` retorna lista sem campos de quantidade
  * SSA-02: TOTP inválido → 400, jamais 500
  * SSA-03: payload inválido → 400 (Zod)
  * SSA-04: solicitação duplicada → 403
  * SSA-05: TOTP válido → 201 com `request_id`
* Adicionados projetos `fluxo-receber` e `fluxo-ssa` em `playwright.config.ts`

---

# 2026-07-05 (v14)

### Features

**Painel Efetivo — Reestruturação completa do dashboard /efetivo**

* **Sidebar `usuario` — "Painel" isolado**: adicionado link standalone `Painel → /efetivo` (ícone `LayoutDashboard`) separado do accordion. "Meus Materiais" permanece como accordion com filhos "Minhas Cautelas" e "Solicitações Remotas"
* **4 cards de stats**: grid 2col (mobile) / 4col (sm+) com Em uso, Histórico, Devolvidos e **Cautelas** (novo — busca via BFF `/api/cautelamentos/ativos`)
* **Seções invertidas**: "Materiais em uso" (grouped table/card) aparece PRIMEIRO após os stats; "Solicitar Armamento" (botão + histórico de solicitações) aparece ABAIXO
* **Botão "Requisitar Armamento" integrado na seção**: removido do header da página, integrado dentro da seção "Solicitar Armamento" como CTA principal da seção
* **Tabela agrupada por movimentação**: modo tabela/grid agora exibe linha separadora de grupo (data, armeiro, reserva, badge Ativo + checkbox de grupo) antes dos itens de cada movimentação — mesmo comportamento do modo card

### Bug Fixes

* Restaurada label "Meus Materiais" no accordion do sidebar (v12 tinha renomeado erroneamente para "Painel")

---

# 2026-07-05 (v13)

### Features

**Sidebar — Tooltips no modo colapsado + hamburger mobile-only**

* **`header.tsx` — hamburger duplicado removido**: O botão hamburger com `className="hidden md:flex"` que chamava `toggleSidebar` e ficava visível no desktop ao lado do próprio chevron do sidebar foi removido. Apenas o botão mobile (`className="md:hidden"`) permanece, abrindo o drawer deslizante
* **`sidebar.tsx` — TooltipProvider**: Toda a sidebar envoluta em `<TooltipProvider delay={300}>` (base-ui)
* **Tooltip no chevron**: Botão de colapso `btn-sidebar-toggle` com tooltip dinâmico "Fechar menu lateral" / "Abrir menu lateral" conforme estado; detectável por `getByRole("tooltip")`
* **Tooltips em ícones simples** (sem filhos): No branch colapsado (`!sidebarOpen`), cada link de navegação simples envoluto em `<Tooltip>` com `TooltipContent side="right"` exibindo o label da página
* **Tooltips em ícones accordion** (com filhos): No branch colapsado, tanto o ícone pai quanto cada ícone filho envolvidos em `<Tooltip>` individuais com `side="right"` — usuário pode navegar para qualquer sub-rota sem abrir o menu

### E2E

* Suite `sidebar-nav` (SDB-01..05): hamburger oculto em desktop, chevron visível, tooltip "Fechar menu lateral", colapso + tooltip "Abrir menu lateral", tooltip em ícone de nav colapsado

---

# 2026-07-05 (v12)

### Features

**Painel Efetivo — Materiais em uso com agrupamento enterprise**

* **`/efetivo` — "Materiais em uso" redesenhado**: substituída a tabela plana por `<MateriaisUsoClient>` com agrupamento por `movement_id` (mesma retirada = mesmo grupo), cabeçalho de grupo com armeiro e reserva, estado vazio com ícone
* **Checkboxes para export dinâmico**: seleção por item ou por grupo inteiro (toggle group); botão "Exportar PDF" desabilitado sem seleção, habilitado e mostra contagem quando há seleção; reutiliza o endpoint `/api/usuario/historico/pdf`
* **Toggle card/tabela**: modo cards (agrupado) e modo tabela (linhas individuais com colunas Armeiro e Reserva); padrão idêntico ao histórico
* **Busca em tempo real**: filtra grupos por nome ou categoria do material
* **Sidebar label**: accordion do efetivo renomeado de "Meus Materiais" → "Painel" em `sidebar.tsx` e `mobile-nav.tsx`

### Bug Fixes

* **`button.tsx` variant `outline` — contraste global**: `bg-background` substituído por `bg-white` + `text-foreground` + `shadow-xs`; todos os botões "Filtros", "PDF", "Exportar" em todas as rotas e roles agora contrastam visualmente com o fundo cinza da página em modo claro. Dark mode mantido

### E2E

* Suite `painel-materiais` (PAINEL-01..08, BTN-01..02): sidebar label, carregamento, agrupamento, checkboxes, PDF enable/disable, toggle tabela, busca, bg-white nos botões outline

---

# 2026-07-05 (v11.1)

### Bug Fixes

**TOTP — Regressão crítica na página de efetivo corrigida**

* **BFF `GET /api/totp/code`**: Quando o `TOTP_ENCRYPTION_KEY` diferia do key usado para criptografar o secret do militar, a desencriptação AES-GCM falhava e o endpoint retornava 500 causando regressão visível na página de efetivo. Agora retorna 422 com `{ needs_reconfigure: true }` para todos os endpoints TOTP (`/code`, `/validate`, `/self-validate`)
* **Frontend `totp-display.tsx`**: Tratamento explícito de 422 — para o polling (polling periódico desnecessário em caso de dados corrompidos), exibe mensagem orientando o militar a reconfigurar o autenticador no perfil. Antes mostrava genérico "Erro ao obter código." e continuava tentando a cada 5s
* **DB**: Secret inválido do cadete (matricula 000003) removido da tabela `totp_secrets`; `totp_configured = false` para que o fluxo de setup seja apresentado automaticamente no próximo acesso
* **Root cause**: `TOTP_ENCRYPTION_KEY` nunca pode ser alterado após uso em produção — todos os secrets criptografados com a key anterior tornam-se irrecuperáveis. Regra canônica reforçada em `totp_architecture.md`

---

# 2026-07-04 (v11)

### Features

**SSA — Overhaul UX Armeiro + Efetivo (v11)**

* **Armeiro `/reserva/solicitacoes`**: Cards redesenhados — seção "MATERIAIS SOLICITADOS" com label visível, categoria e quantidade; `remote_reason` em box âmbar para solicitações externas; `cancellation_reason` para canceladas; `armeiro_nota` em box verde; `is_external_request` badge "Externa"
* **Armeiro — Ação inline por card**: Substituídos os dois botões `Aprovar/Rejeitar` de largura total por `<select>` nativo por card + campos condicionais (textarea de nota para aprovar, input de motivo para rejeitar) + botão de confirmação compacto; estado `cardActions: Record<string, CardAction>` elimina dialogs globais
* **Armeiro — Toggle card/tabela**: Ícones `LayoutGrid`/`Table2` com estado `viewMode`; modo tabela com colunas Militar | Materiais | Status | Data | Ação
* **Armeiro — Paginação "Ver mais"**: `hasMore` via `limit + 1` no SSR; dropdown [20, 30] para selecionar quantidade; `?tab=&limit=` preservado na URL
* **Efetivo `/efetivo/solicitacoes`**: Convertido de SSR puro para SSR+cliente interativo; busca por material em tempo real; tabs de status (Todas/Pendentes/Aprovadas/Rejeitadas/Retiradas/Canceladas); toggle card/tabela; paginação "Ver mais" [20, 30]; cards renderizam `SolicitacaoStatusCard` (reaproveitamento total — sem duplicação)
* **Sidebar**: `usuario` — "Meus Materiais" agora é accordion com chevron; filhos: "Minhas Cautelas" + "Solicitações Remotas"; grupos auto-abertos quando rota filha está ativa; sidebar recolhida mostra ícones pai + filhos diretamente; `master` — link "Solicitações" → `/reserva/solicitacoes` adicionado
* **Mobile nav**: Mesma estrutura `NavItem` com `children?`; filhos sempre expandidos com indent visual; sem accordion (mobile já tem espaço vertical)
* **E2E**: Nova suite `ssa-ui-suite` (ARM01-ARM10, EFT01-EFT10) validando materiais, ação inline, toggle, paginação, accordion do sidebar

### Bug Fixes

* `_solicitacoes-client.tsx`: Interface `Request` agora inclui `remote_reason`, `is_external_request`, `cancellation_reason` — antes esses campos chegavam mas eram silenciosamente ignorados
* `reserva/solicitacoes/page.tsx`: `cancellation_reason` adicionado ao SELECT do Supabase; `searchParams.limit` suportado para paginação SSR

---

# 2026-07-04 (v10)

### Bug Fixes

**SSA — `POST /api/ssa/requests` retornava 500 (TOTP Base32 inválido)**
* Causa: `ssa.ts` chamava `verifySync({ secret: totpData.secret, ... })` com o blob criptografado `v1:...` diretamente como secret Base32 — a mesma correção feita no `totp.ts` na v8 nunca foi aplicada ao SSA
* Fix: `readSecret` agora exportado de `totp.ts` e importado/usado em `ssa.ts` antes de qualquer chamada a `verifySync`; ambas as chamadas (POST /requests e endpoint de re-validação) cobertos com try/catch explícito para não propagar throw do otplib → 500 global

**SSA — Autocomplete de material exibia lista completa por padrão**
* Causa: `filteredMaterials` retornava `materials` inteiro quando a busca estava vazia
* Fix: retorna `[]` quando `materialSearch` está vazio; filtra para `disponivel === true` apenas; 3 estados de UI: "Digite para buscar" (vazio), "Nenhum material disponível" (sem resultado), lista agrupada (com resultados)

### DB Changes

**`reserve_memberships` — role `usuario` adicionado ao check constraint**
* Constraint expandido: `('admin_reserva','armeiro','auditor_reserva','usuario')` — permite registrar usuários regulares como membros de uma reserva sem papel de staff
* Cadete (matricula 000003) inserido como `role='usuario'` na reserva APMCB — elimina o aviso "reserva fora da sua unidade" e o step de motivo ao selecionar a APMCB

---

# 2026-07-04 (v9)

### Bug Fixes

**SSA — 9 bugs críticos corrigidos no fluxo de Solicitação Remota**

* **BUG-RR-01 (CRÍTICO)** `allow_remote_requests` — migration SQL nunca havia sido aplicada; coluna existia com `DEFAULT true` sem controle real. Migrations aplicadas via Supabase MCP: `allow_remote_requests BOOLEAN NOT NULL DEFAULT false`, `remote_allowed_categories TEXT[] NOT NULL DEFAULT '{}'`
* **BUG-RR-02 (CRÍTICO)** `notifyAllArmeios()` enviava notificações push sem filtro de `tenant_id` — qualquer nova SSA notificava armeios de outros tenants. Substituído por `notifyArmeiosOfTenant(tenantId)` que filtra por `default_tenant_id`
* **BUG-RR-03 (CRÍTICO)** RLS `ssa_military_select` e `ssa_staff_update` sem cláusula `tenant_id` — armeiro podia ver e atualizar SSAs de outros tenants. Migrations D corrigiram ambas as policies
* **BUG-RR-04 (ALTO)** `reserve_id`, `tenant_id`, `is_external_request` e `remote_reason` nunca eram salvos no INSERT de `material_requests` — campos sempre nulos. BFF corrigido para incluí-los no INSERT
* **BUG-RR-05 (ALTO)** Push deep link enviado ao armeiro apontava para `/efetivo/solicitacoes` (página do efetivo) em vez de `/reserva/solicitacoes`. Corrigido via parâmetro `url` em `notifyUser`
* **BUG-RR-06 (MÉDIO)** `GET /api/ssa/available-materials` não verificava `allow_remote_requests` nem `remote_allowed_categories` para usuários externos. BFF agora rejeita requests de reservas bloqueadas e filtra categorias não autorizadas
* **BUG-RR-07 (MÉDIO)** Listagem do armeiro em `/reserva/solicitacoes` não filtrava por `tenant_id` no front (RLS apenas não é suficiente para defense-in-depth). Query agora com `.eq("tenant_id", profile.default_tenant_id)`
* **BUG-RR-08 (MÉDIO)** Contagens de pendências no dashboard do armeiro (`ssaPendingCount`, `retiradaCount`) sem filtro de tenant — exibia totais globais. Corrigido com filtro condicional por `default_tenant_id`
* **BUG-RR-09 (BAIXO)** Sem limite de quantidade no stepper de materiais — usuário podia solicitar qualquer número. Adicionado `Math.min(10, ...)` no front e `.max(10)` no schema Zod do BFF

### Features

**SSA — 8 novos requisitos implementados (RR-01..RR-08)**

* **RR-01** Combobox com autocomplete substituindo lista plana: campo de busca com filtro em tempo real, dropdown com click-outside, badge "Membro" para reservas de membership
* **RR-02** Filtro de reservas disponíveis: `GET /api/reserves/mine` agora retorna apenas reservas com `allow_remote_requests = true` ou onde o usuário é membro; flag `is_member` incluída na resposta
* **RR-03** Toggle admin para habilitar/desabilitar acesso remoto da reserva: `PATCH /api/reserves/:id/settings` aceita `allow_remote_requests` (booleano); `ReserveRemoteAccessToggle` atualizado; migration SQL aplicada
* **RR-04** Controle granular por categoria: `remote_allowed_categories TEXT[]` em `reserves`; BFF filtra materiais por categoria quando usuário é externo (não-membro); `PATCH /api/reserves/:id/settings` aceita o array
* **RR-05** Campo "motivo" obrigatório para externos: step `"motivo"` inserido no fluxo quando `!reserve.is_member`; `Textarea` com validação mínima de 10 chars; sugestões rápidas de texto; `remote_reason` salvo no banco
* **RR-06** Autocomplete de material: input de busca no step de seleção com filtro em tempo real via `useMemo`; estado vazio explícito; itens com `data-testid="ssa-material-item-{id}"`
* **RR-07** Armeiro: notificações tenant-safe via `notifyArmeiosOfTenant`; listagem e painel filtrados por tenant; `approve`, `reject`, `deliver` agora verificam `tenant_id` antes de agir (403 se discrepante)
* **RR-08** Efetivo: cancelamento com motivo obrigatório (min 10 chars) — novo endpoint `PATCH /api/ssa/requests/:id/cancel`; botão "Cancelar solicitação" em cards `pendente` e `aprovado`; dialog de confirmação; RLS `ssa_military_cancel` extendida para status `aprovado`; armeiro notificado via push

### Tests

**E2E — `remote-requests.spec.ts` (40 testes, todos `test.skip` — harness pendente de dados)**
* Grupos: RR01-RR30 (fluxo funcional), SEC-RR01-05 (isolamento cross-tenant), ADM-RR01-05 (controles admin)
* Suite adicionada ao `playwright.config.ts`: `remote-requests-suite` (1 worker, 60s timeout)
* Testids documentados: `ssa-reserve-combobox`, `ssa-reserve-search`, `ssa-reserve-option-{id}`, `badge-membro`, `ssa-motivo-textarea`, `btn-motivo-next`, `ssa-material-search`, `ssa-material-item-{id}`, `ssa-materials-empty`, `btn-cancelar-solicitacao`, `ssa-cancel-reason`, `btn-confirm-cancel`

---

# 2026-07-04 (v8)

### Bug Fixes

**TOTP — Corrige 500 em `/api/totp/code` (regressão crítica)**
* `readSecret`: antes retornava blob `v1:...` criptografado como plaintext quando `TOTP_ENCRYPTION_KEY` ausente — `generateSync` explodia fora do try/catch. Agora lança `TOTP_SECRET_ENCRYPTED_BUT_NO_KEY` antes de passar garbage ao otplib
* `GET /code`: `generateSync({ secret })` movido para dentro do bloco try/catch — qualquer throw é capturado e retorna 500 com JSON de erro, não Hono 500 opaco
* `/validate` e `/self-validate`: adicionado try/catch em torno de `readSecret` — antes qualquer throw virava 500 sem mensagem útil
* DB: deletado secret criptografado do cadete (matricula 000003) armazenado com chave diferente — cadete re-provisiona via `/api/totp/setup` automaticamente

**UI — React #418 (hydration mismatch)**
* `apps/web/src/app/layout.tsx`: adicionado `suppressHydrationWarning` em `<body>` — browser extensions modificam atributos de `<body>` causando mismatch que disparava #418

**BFF — `.env.example` documentado**
* `TOTP_ENCRYPTION_KEY`: documentado com aviso crítico — nunca alterar após existirem secrets criptografados no banco (chave diferente = todos os secrets inválidos → TOTP 500 em cascata)

### Tests

**E2E — `totp-regression.spec.ts` (TOTP-R01..R11) — 11/11 passing**
* TOTP-R01..R04: shape do payload `{ code, seconds_remaining, period }`, `code` = 6 dígitos, `seconds_remaining` ∈ [1,30], `period === 30`
* TOTP-R05: sem autenticação → 401
* TOTP-R06: 3 chamadas consecutivas nunca retornam 500
* TOTP-R07: user sem TOTP configurado → 404 (não 500)
* TOTP-R08: `POST /validate` token inválido → 200 `{valid:false}` ou 404/429, nunca 500
* TOTP-R09: `POST /self-validate` token inválido → nunca 500
* TOTP-R10: UI `TOTPDisplay` exibe 6 dígitos no card expandido (não "Erro ao obter código")
* TOTP-R11: console sem React #418 ao carregar dashboard

---

# 2026-07-04 (v7)

### Tests

**E2E — Bug Sprint 001: 45/46 passando (1 skipped por dados ausentes)**
* `e2e/harness.ts`: corrigido `landAt: "/registro-pendente"` → `"/efetivo"` para cadete com `registration_status: complete`
* `e2e/bug-sprint-001.spec.ts`: 5 correções de locators/lógica:
  - FLT01: `text=/sem estoque/i` trocado por `[data-testid='arsenal-card'] span.badge-danger` (badge real é "Crítico")
  - FLT05: locators corrigidos para `arsenal-card` / `arsenal-row` (testids reais do componente)
  - PDF04: test agora seleciona o segundo `<select>` (Reserva, não Departamento) antes de verificar botão
  - CAT02: input locator atualizado para `#req-nome` / fallback genérico (sem `name="nome"`)
  - GRP/EF/CAT07 (10 testes): desbloqueados pela correção do `landAt`

---

# 2026-07-03 (v6)

### Bug Fixes

**UI — Inputs brancos com contraste em todas as páginas**
* Todos os campos de busca/autocomplete agora usam `bg-white dark:bg-card` — contraste 100% branco contra o fundo cinza da página
* Botões inativos (status tabs, toggle card/grade, "Ver mais", pills de filtro) passam de `bg-background`/`bg-card` para `bg-white dark:bg-card` com hover na cor primária do tenant (`hover:bg-primary/10 hover:border-primary/40`)
* Arquivos afetados: `grid-search-input`, `historico-client`, `minhas-cautelas-client`, `saidas-client`, `admin-saidas-client`, `militares-table`, `cautelas-client`, `arsenal-client`, `arsenal-filters`, `admin-livros-client`, `aprovacao-client`

### Tests

**E2E — Bug Sprint 001 spec harness**
* `e2e/bug-sprint-001.spec.ts`: 35 testes cobrindo GRP01-05 (agrupamento), AC01-07 (autocomplete), FLT01-05 (filtros), CHK01-05 (checkbox), PDF01-06 (PDF enterprise), MOV01-06 (movement grouping), CAT01-07 (categoria request), EF01-05 (feature parity efetivo)

### Features

**Listagem — Busca + filtro status em arsenal, militares e minhas-cautelas**
* `admin/arsenal/_arsenal-filters.tsx`: filtro por estoque (Todos/Disponível/Em uso/Sem estoque) via pill tabs
* `reserva/militares/_militares-table.tsx`: busca livre por nome/matrícula/posto com estado vazio
* `efetivo/minhas-cautelas/_minhas-cautelas-client.tsx`: busca por material/categoria/armeiro + filtro status (Todas/Ativas/Devolvidas/Em revisão/Substituídas); tabela e cards iterando sobre `filtered`

---

# 2026-07-04 (v5)

### Bug Fixes (Sprint 001)

**TOTP 500 regression corrigida**
* `apps/bff/src/routes/totp.ts`: `readSecret` agora detecta prefix `v1:` antes de descriptografar — secrets legados em plaintext (sem encryption key no container antigo) são retornados diretamente, eliminando o 500

**Bug 4 — Checkbox click area**
* `_saidas-client.tsx` + `_admin-saidas-client.tsx`: todos os `<input type="checkbox">` recebem `onClick={(e) => e.stopPropagation()}`, `size-5` e `relative z-10` para área de clique correta

**Bug 6 — PDF enterprise**
* `grid-pdf-button.tsx`: reescrito com header profissional (logo tenant, nome do armeiro, nome da reserva, data/hora de emissão, total selecionado), filtro por `selectedGroupKeys`, hash SHA256 no footer, loading spinner durante geração
* `page.tsx` da reserva/saidas: busca `reserve_memberships` para obter nome da reserva e logo; passa `reserveName`, `armeiroName`, `tenantLogoUrl` para `SaidasClient`

**Bug 8 — Agrupamento por movement_id**
* `nova/_form.tsx`: `movementId` sempre gerado via `crypto.randomUUID()` (não mais `null` para 1 item)
* `_saidas-client.tsx` + `_admin-saidas-client.tsx`: fallback de `groupByRetirada` trunca `issued_at` ao minuto — saídas quasi-simultâneas de mesmo militar são agrupadas
* Cards de itens devolvidos agora exibem hora de `returned_at`

### Features

**Bug 7 — Armeiro solicita nova categoria**
* Migration `category_requests`: tabela com RLS (armeiro vê próprias, admin vê todas do tenant)
* BFF: `POST /api/categories/request`, `GET /api/categories/requests`, `POST .../approve`, `POST .../reject`
* `_category-manager.tsx`: botão "Adicionar categoria" visível para armeiro, abre modal com nome/ícone/descrição e botão "Solicitar aprovação do admin"

---

# 2026-07-03 (v4)

### Features

**Padrão universal de listagem — P3 a P9 (todas as páginas restantes)**

* `/admin/saidas` (`_admin-saidas-client.tsx`): checkboxes por grupo e por item com indeterminate; `selectedIds` state; exportação dinâmica (disabled sem seleção, mostra contador); `displayLimit` client-side com "Ver mais" dropdown 20/30; tooltips toggle renomeados para padrão canônico; `data-testid="admin-saidas-group"` adicionado
* `/admin/arsenal` (`_arsenal-filters.tsx`): toggle card/grade (default cards); novo componente `MaterialCard` com foto, quantidades, `AvailabilityBar`, `StockStatusBadge` e `MaterialRowActions`; checkboxes em card e em tabela (thead indeterminate); exportação dinâmica; `displayLimit` client-side com "Ver mais"
* `/admin/usuarios` (`_users-table.tsx`): toggle card/grade (default cards); novo componente `UserCard` com foto, matrícula, role badge, status badge e ações; checkboxes em card e em tabela; exportação dinâmica; `displayLimit` client-side com "Ver mais"; `useMemo` para filtro
* `/reserva/militares` (`_militares-table.tsx`): toggle card/grade (default cards); novo componente `MilitarCard` com foto, nome, status bio/TOTP, badge "em uso"; checkboxes; exportação dinâmica; `displayLimit` client-side com "Ver mais"; ações preservadas; lightbox e sheet `MilitarSheet` intactos
* `/reserva/ocorrencias` (`page.tsx` + novo `_ocorrencias-client.tsx`): página SSR refatorada com `limit` searchParam (default 10, max 30); novo client component com toggle card/grade, busca por texto, checkboxes, exportação dinâmica, "Ver mais" via `router.push`; `data-testid="ocorrencia-card"`
* `/admin/inventario` (`page.tsx`): toggle card/grade; checkboxes com indeterminate em tabela; exportação dinâmica; `displayLimit` client-side com "Ver mais"; cards com `data-testid="inventario-card"`
* `/efetivo/minhas-cautelas` (`_minhas-cautelas-client.tsx` + `page.tsx`): `page.tsx` SSR com `limit` searchParam; client component recebe `hasMore` + `currentLimit`; toggle card/grade; checkboxes; exportação dinâmica; "Ver mais" com redirect; botão PDF por item preservado em ambos os modos

---

# 2026-07-03 (v3)

### Bug Fixes

**React #418 + 401 race condition corrigido**
* `hooks/use-role-guard.ts`: primeiro check do BFF adiado 3s para dar tempo ao iron-session estabelecer após login Supabase; eliminado `router.push` durante hidratação

### Features

**Padrão universal de listagem — Armeiro Saídas**
* `reserva/saidas/page.tsx`: paginação SSR via `?limit=N` (default 10, max 30); busca `limit+1` para detectar `hasMore`; slicing correto antes de resolver foto URLs
* `reserva/saidas/_saidas-client.tsx`: props `hasMore` + `currentLimit`; estado `selectedIds` (Set); checkboxes com indeterminate em GroupCard (grupo) e por item; checkbox "selecionar todos" na thead da tabela; "Ver mais" dropdown 20/30 com `router.push`; exportação dinâmica: botão Exportar desabilitado sem seleção, mostra contador `(N)` quando selecionado, filtra `data-group-key` no DOM ao imprimir; títulos de toggle corrigidos para `"Ver em cards agrupados"` e `"Ver em grade"`; `data-testid="saidas-group"` e `data-testid="saidas-item"` adicionados
* `components/shared/grid-pdf-button.tsx`: props `disabled` e `selectedGroupKeys` adicionadas; handlePrint filtra grupos por `data-group-key` quando `selectedGroupKeys` fornecido

**Dashboard Armeiro — bugs e UX**
* `reserva/page.tsx`: link "Devoluções Pendentes" corrigido de `?status=pendente` para `?status=ativo`; `ActionCard` recebe `group relative` e tooltip CSS no padrão MiniStatLink (aparece acima do card no hover)

**Histórico do Efetivo — default cards**
* `efetivo/historico/_historico-client.tsx`: `viewMode` defaulta para `"cards"` (era `"table"`)

### Tests (E2E)
* `e2e/armeiro-saidas.spec.ts`: novo spec AS01-AS25 (paginação, filtros, toggle, seleção/export, link dashboard, tooltips)
* `e2e/admin-saidas.spec.ts`: novo spec ADS01-ADS20
* `e2e/admin-arsenal.spec.ts`: novo spec AAR01-AAR15
* `e2e/admin-usuarios.spec.ts`: novo spec AU01-AU15
* `e2e/reserva-militares.spec.ts`: novo spec ML01-ML15
* `e2e/reserva-ocorrencias.spec.ts`: novo spec OC01-OC15
* `e2e/admin-inventario.spec.ts`: novo spec INV01-INV15
* `e2e/efetivo-cautelas.spec.ts`: novo spec MC01-MC15
* `e2e/historico-usuario.spec.ts`: HU02/03/08 atualizados para clicar toggle antes de assertions de tabela
* `playwright.config.ts`: 8 novos projetos de suite (armeiro-saidas, admin-saidas, admin-arsenal, admin-usuarios, reserva-militares, reserva-ocorrencias, admin-inventario, efetivo-cautelas)

---

# 2026-07-03 (v2)

### Features

**Histórico do Efetivo — toggle card/grade + agrupamento por movimentação**
* `efetivo/historico/_historico-client.tsx`: adicionado toggle `LayoutGrid` / `Table2` idêntico ao armeiro; modo cards agrupa lendings por `movement_id` (fallback `issued_at`) via novo componente `HistoricoCardView`; tabela original preservada como vista "grade" sem alterações; "Ver mais" com dropdown 20/30 registros aparece quando limite foi atingido
* `bff/src/routes/usuario.ts`: `movement_id` adicionado ao SELECT; param `limit` (default 500, max 500 — cards passam 10/20/30); `toHistoricoLending` mapeia o campo novo
* `bff/src/lib/pdf/historico-pdf.ts`: `movement_id: string | null` adicionado em `HistoricoLending`

**Armeiro saídas — hora da saída no GroupCard**
* `reserva/saidas/_saidas-client.tsx`: `formattedDate` no `GroupCard` agora inclui hora (`"02 jul. 2026 · 21:28"`); assinatura de `onReceber` extendida para `(ids, militaryMatricula?)` em `GroupCard`, `SaidasTable` e callbacks pai

**Modal "Receber Material" — fluxo 80/20 + observações**
* `reserva/saidas/_saidas-client.tsx`: estado `militaryMatricula` adicionado ao `SaidasClient`; ao clicar "Receber" num grupo, matrícula do militar é passada automaticamente para a modal; reset ao fechar
* `reserva/saidas/_desarmamento-modal.tsx`: prop `militaryMatricula?` adicionada; quando preenchida, oculta input de matrícula TOTP e exibe banner "Identificando Mat. XXXXX"; estado `observacoes` + textarea opcional na fase 2; `bulk-return` envia `notes` quando preenchido

### Tests (E2E)
* `e2e/historico-usuario.spec.ts`: HU11-HU15 adicionados (toggle, modo cards, hora, limit param, busca em cards)
* `e2e/desarmamento-receber.spec.ts`: novo spec DM01-DM04 (hora no GroupCard, banner matrícula pré-preenchida, campo observações, modal geral sem pré-preenchimento)
* `playwright.config.ts`: projeto `desarmamento-suite` adicionado (depende de `armeiro-setup`)

---

# 2026-07-03

### Fixes (E2E — armeiro-suite + criar-armeiro-suite + livro-suite)

* **playwright.config.ts:** Removido projeto `livro-setup` duplicado — `livro-suite` agora depende de `armeiro-setup` (ambos usavam o mesmo setup file e escreviam no mesmo `.auth/armeiro.json` concorrentemente; race condition corrompia o arquivo mid-run, causando login redirect em AR12-AR18 e LDS09+)
* **e2e/criar-armeiro.spec.ts:** Seletor de e-mail no login corrigido de `[name=email], input[type=email]` para `#email` — o campo no login tem `type="text"` e `id="email"` sem atributo `name`, causando fill silencioso e falha de login em CA01/CA02
* **e2e/livro-digital.spec.ts:** Regex `/turno ativo/i` substituída por `/turno ativo —/i` em todas as guards condicionais — a versão anterior também batia em "Sem turno ativo" (badge do estado inativo), fazendo LDS04 sempre pular (skip) e LDS05-LDS14 nunca pularem quando deveriam

---

# 2026-07-02 (v2)

### Fixes

* **e2e/invite-privilege:** `apiLogin` não retornava `csrfToken` do corpo JSON do BFF — `callInvite` usava token hardcoded "e2e-test" que nunca correspondia ao token armazenado na iron-session; causa raiz dos falhos INV-01/03/05/07. Refatorado para usar `LoginResult { cookie, csrfToken }` em toda a suite.

### Docs

* **PRD §13/18/22/25/26:** Estado atual reescrito — Fase 7C concluída, RLS/RF24/ENT11/ENT12 marcados ✅, RF26/RF27/ENT13 adicionados
* **Roadmap v1.1:** Fase 7C marcada concluída; Fase 7D 🔵 EM PROGRESSO com spec detalhada (ícones de unidade + painel admin_reserva)

---

# 2026-07-02

### Features (Saídas Enterprise — Fase 7C continuação)

* **db/security:** `profiles_update` RLS recriada sem roles legados (`admin`, `military`) — self-update agora inclui `armeiro` e `auditor`
* **shared/combobox:** `ComboBox<T>` extraído de `_form.tsx` para `components/shared/combobox.tsx` — reutilizável em toda a aplicação
* **reserva/saidas:** filtros de data (from/to) com client-side filtering, toggle Cards↔Tabela, botão Exportar PDF via `GridPdfButton`
* **admin/saidas:** nova página `/admin/saidas` — monitor de saídas por reserva para admin_global; seletor Departamento→Reserva, filtros search/data/status, toggle Cards↔Tabela, exportar PDF
* **bff/admin:** `GET /api/admin/saidas` com RBAC admin_global/superadmin + validação cross-tenant (reserve.tenant_id === caller.tenantId)
* **sidebar/admin:** link "Saídas" adicionado ao nav do admin (entre Arsenal e Estrutura)

### Security

* **Fase 7C — Bug 1:** `requireNexusSession` já continha `role !== "superadmin"` — verificado e confirmado seguro
* **Fase 7C — Bug 2:** `material_availability` com `security_invoker = on` — confirmado via query no DB
* **Fase 7C — Bug 3:** RLS policies verificadas no DB — todas usam novos roles; `profiles_update` corrigida

---

# 2026-07-01 (v2)

### Features (Nexus — CRUD completo + UX)

* **nexus/superadmins:** CRUD completo por linha — botão Editar (dialog com nome, matrícula, posto, status) e Remover (confirm dialog que revoga role→usuario + desativa); guard impede auto-remoção
* **nexus/tenants:** aba "Cadastro" dentro de cada accordion com campos: valor contrato, vigência início/fim, responsável nome/e-mail/telefone, endereço, observações — salva via `PATCH /api/nexus/tenants/:id`
* **nexus/tenants:** formulário de criação de tenant inclui todos os campos contratuais (seção "Informações Contratuais")
* **bff/nexus:** `PATCH /api/nexus/superadmins/:id` + `DELETE /api/nexus/superadmins/:id` com audit log e guard anti-auto-remoção
* **nexus/tenants:** tooltips em todos os badges (Res:, Us:, Status, Tipo, Structure) via `@base-ui/react/tooltip`
* **nexus/tenants:** `userCount` corrigido — query separada no BFF elimina o `profiles(count)=0` causado por FK não descoberto pelo PostgREST
* **nexus/tenants:** remoção do TabsList externo; lista direta com toggle "+ Novo Tenant" no header (menos fricção, sem card desnecessário)

### Fixed

* **nexus/metrics-grid:** valores invisíveis no tema claro — `text-white` hardcoded → `text-gray-900 dark:text-white`
* **nexus/header:** header branco no tema dark — classe duplicada `dark:bg-white` após `dark:bg-[#0D0D14]` sobrescrevia; removida a duplicata
* **nexus/sidebar:** label "Controle" e links de nav invisíveis no tema claro — cores condicionadas a `dark:` variants
* **e2e/apmcb.spec:** `x-content-type-options` usa `toContain` em vez de `toBe` — BFF + Nginx duplicam o header (`nosniff, nosniff`)

---

# 2026-07-01

### Fixed

* **auth/exchange:** Supabase invite usa PKCE flow (`?code=` query param), não implicit flow (hash). `exchange/page.tsx` detecta `?code=` primeiro e chama `exchangeCodeForSession()` — eliminava "Falha na autenticação" ao clicar no link de convite.
* **mobile/hamburger:** Botão hamburger mobile agora abre drawer deslizante (`MobileNav`) com todos os itens do menu por role (admin=8, master=8, usuario=3). Desktop continua colapsando sidebar lateral. `ui.store` ganhou `mobileMenuOpen`, `toggleMobileMenu`, `closeMobileMenu`.
* **estrutura/crud:** Botões editar e excluir adicionados para OrgUnit (header do card) e Reserve (ações na linha). Dialogs de edição com formulário completo (nome, sigla, tipo/status, ícone). Dialog de confirmação destrutiva para exclusões.

### Security

* **bff/csrf:** CSRF token migrado de cookie duplo-submit para iron-session criptografada — cookies stale entre deploys causavam 403 CSRF em todos os PATCHs/POSTs após redeploy do BFF.
* **bff/invite:** `supabase.auth.admin.inviteUserByEmail()` via SDK substitui fetch manual para `/auth/v1/admin/invite` (retornava 404) — endpoint correto é `/invite` via GoTrue client.

### Fixed

* **db/reserves:** `status` corrigido de `"active"/"inactive"` para `"ativa"/"inativa"` — violava constraint `reserves_status_check`; afetava criação e atualização de reservas.
* **db/inventory:** `material_availability` query em `inventory.ts` corrigida para `.eq("status", "ativa")`.
* **auth/header:** `ROLE_DASHBOARD["superadmin"]` apontava para `/nexus` (loop 401); corrigido para `/nexus/login`.

### Note

* **supabase/invite:** Emails `@apmcb.dev` rejeitados por validação MX no Supabase GoTrue — requer desabilitar "Validate email addresses" em Authentication > Settings no dashboard Supabase. Domínios com MX (gmail, institucional) funcionam normalmente.

### Features (saídas enterprise)

* **saidas/grid:** UI `/reserva/saidas` reescrita com cards agrupados por `movement_id`, busca client-side, tabs Todas/Ativas/Devolvidas e botão "Receber Material"
* **desarmamento/identity-first:** modal `_desarmamento-modal.tsx` — identificação (TOTP/biometria/manual) → confirmação de itens com countdown TTL 2min
* **lendings/movement_id:** nova coluna `UUID` nullable agrupa múltiplos itens da mesma operação em 1 card; migration `20260701000001_lendings_movement_id.sql`
* **bff/lendings/identify:** `POST /api/lendings/identify` discriminatedUnion (totp|biometria|manual), pendingIdentity iron-session TTL 2min
* **bff/lendings/bulk-return:** `POST /api/lendings/bulk-return` devolução atômica; valida military_id + tenant_id; Phase 5 compat material_items
* **bff/totp/identify:** `checkTotpForMatricula()` exportado de `totp.ts`, reutilizado em `lendings.ts` (SSOT, sem duplicação)
* **bff/biometric/minScore:** `BIOMETRIC_MIN_SCORE=0.92` env-configurável em `biometric.ts` e `lendings.ts`
* **grid/shared:** `useGridState`, `GridSearchInput`, `GridSortHead`, `GridPdfButton`, `GridRowCheckbox` em `components/shared/`
* **arsenal/armeiro:** grade/lista toggle + busca + PDF — modo lista com `GridSortHead`, modo grade preserva cards
* **arsenal/admin:** `GridSearchInput` + `GridSortHead` + `GridPdfButton` em `_arsenal-filters.tsx`
* **efetivo/materiais:** `MateriaisTable` com `useGridState` + `GridSortHead` + busca substitui lista estática

### Bug Fixes (saídas enterprise)

* **saidas/ativas:** `page.tsx` filtrava `.eq("status", status)` — coluna certa é `status_legacy`; fix: `.eq("status_legacy", status)`
* **e2e/harness:** `USERS.cadete.landAt` corrigido de `/cadete` para `/efetivo` (BFF auth exchange roteia usuarios para `/efetivo`)

### Validation (saídas enterprise)

* Suite `saidas-enterprise-suite`: **12 passed, 5 skipped (intencionais), 0 failed**
* Build ✅ · Typecheck ✅ · BFF green slot :3002 · commit `6052ebd`
* Report: `docs/enterprise/reports/saidas-enterprise-final-report.md`

---

# 2026-06-30

### Security

* **bff/nexus:** `requireNexusSession` corrigido — condição `role !== "admin_global" && role !== "superadmin"` invertida permitia admin_global em todos os endpoints Nexus; fix: `role !== "superadmin"`.
* **db/views:** `material_availability` restaurado com `security_invoker = on` — migration `20260629000002` havia desfeito o fix de `20260629000007`.
* **rbac/invite-ceiling:** INVITE_CEILING SSOT em `apps/bff/src/lib/invite-ceiling.ts` — cada role só convida até seu teto (superadmin→admin_global, admin_global→{admin_global,admin_reserva,armeiro,usuario}, admin_reserva→{armeiro,usuario,auditor}, armeiro→{usuario}).

### Features

* **nexus/invite:** `POST /api/nexus/tenants/:id/invite` — superadmin convida admin_global via Nexus com TOTP.
* **nexus/patch:** `PATCH /api/nexus/tenants/:id` — altera `structure_mode` (simple/structured) com confirmação no UI.
* **admin/invite:** `POST /api/admin/users/invite` — endpoint unificado com validação de Privilege Ceiling.
* **reserva/convidar:** página `/reserva/criar-armeiro` renomeada para "Convidar para Reserva" com role selector por nível RBAC.
* **estrutura/icones:** org_units ganham `icon_name` com picker de 18 ícones Lucide; ícone dinâmico exibido no header de cada unidade.
* **estrutura/admin-reserva:** `ReserveRow` exibe admin_reserva atual ou link inline "Convidar admin"; dialog de convite com `reserve_id` pré-preenchido.
* **estrutura/gate:** "Nova Unidade" só aparece em `structure_mode=structured` (ativado pelo superadmin via Nexus).
* **nexus/ui:** Nexus tenants page ganha dialog de convite + badge clicável de structure_mode com confirmação antes de alterar.

### Database

* **supabase:** migration `20260629000006_requirenexus_fix.sql` — view security fix (já aplicada).
* **supabase:** migration `20260630000003_fix_material_availability_security_invoker.sql` — restaura `security_invoker=on`.
* **supabase:** migration `20260701000001_org_units_icon_name.sql` — ADD COLUMN `icon_name` em `org_units`.

### Tests

* `apps/web/e2e/invite-privilege.spec.ts` — INV-01..INV-08 + SEC-02 + SEC-03 (Privilege Ceiling + nexus guard).

### Validation

* `pnpm typecheck` OK (web + bff). `pnpm --filter web build` OK.
* BFF deployado em 91.99.113.89 — Health OK.
* CF Pages deploy via push to main.

---

# 2026-06-29

### Security

* **rls/auditoria:** auditoria global de seguranÃ§a â€” 14 achados em 4 categorias (crÃ­tico/alto/mÃ©dio/baixo). Migrations `000001`â€“`000005` aplicadas ao banco real.
* **rls/tenant-isolation (C1):** backfill de `default_tenant_id` + `tenant_memberships` + `reserve_memberships` para todo staff scoped (admin_reserva 17/17, armeiro 8/8, auditor 9/9). RLS com filtro de tenant enforÃ§ado em 6 tabelas: `profiles`, `lendings`, `material_types`, `audit_logs`, `biometric_templates`, `material_items`.
* **rls/roles (C2):** policies de 6 tabelas atualizadas para roles novas (`admin_global`, `superadmin`, `armeiro` etc.) â€” roles antigas `admin`/`master` removidas de todos os predicados.
* **storage (C4):** buckets `profile-photos` e `material-photos` passaram de `public = true` para privados; policies de leitura exigem usuÃ¡rio autenticado.
* **nginx/hsts (A4):** HSTS `max-age=31536000; includeSubDomains; preload` + `X-Frame-Options: DENY` + `Referrer-Policy` + `Permissions-Policy` aplicados no nginx host (Certbot-managed), que Ã© o nginx real de produÃ§Ã£o.
* **auth/callback (A2):** parÃ¢metro `next` validado contra whitelist de paths; open redirect fechado.
* **rls/material-items (A5):** policy N+1 unificada em EXISTS Ãºnico; sem subquery duplo por linha.
* **rls/notifications (A6):** INSERT de notificaÃ§Ãµes com `EXISTS (SELECT 1 FROM profiles)` â€” sem `WITH CHECK (true)`.

### Bug Fixes

* **auth/login:** spinner eterno intermitente corrigido â€” `supabase.signOut()` dentro do `catch` podia lanÃ§ar exceÃ§Ã£o em rede instÃ¡vel, impedindo `setLoading(false)`; agora wrappado em try/catch interno.
* **auth/login:** edge case defensivo â€” `data.session = null` sem `error` (rate-limit Supabase etc.) agora exibe toast e libera o botÃ£o.
* **auth/login:** fetch ao BFF sem timeout corrigido â€” `AbortController` com deadline de 10 s evita spinner eterno quando VPS estÃ¡ lento.
* **auth/exchange:** `auditor` redirecionava para `/cadete` em vez de `/nexus`; corrigido `landAt` no BFF.
* **auth/supabase:** corrigida regressao de login em producao causada por recursao infinita nas policies RLS de `profiles` e `reserve_memberships`; server components voltam a ler perfil e membership apos `/auth/exchange`.
* **audit/logging (M7):** `auditLog()` refatorado de fire-and-forget para `Promise<void>`; fallback `console.error` estruturado quando insert Supabase falha.
* **ui/dead-code (B1):** componentes `inventory-card.tsx` e `severity-alert.tsx` removidos (nÃ£o importados em lugar algum).

### Database

* **supabase:** migration `20260629000001_fix_rls_security_audit.sql` â€” policies iniciais + buckets privados.
* **supabase:** migration `20260629000002_fix_material_availability_reserve_id.sql` â€” view `material_availability` recriada com `tenant_id` e `reserve_id`.
* **supabase:** migration `20260629000003_fix_rls_populate_tenant_and_correct_policies.sql` â€” tentativa de populate via reserve_memberships (parcial).
* **supabase:** migration `20260629000004_rls_safe_roles_only.sql` â€” policies backward-compat com roles novas sem enforÃ§amento de tenant (correÃ§Ã£o da regressÃ£o AR01-AR18).
* **supabase:** migration `20260629000005_tenant_isolation_backfill.sql` â€” populate definitivo de memberships + RLS com tenant enforÃ§ado.

### Docs

* **docs/enterprise/supabase-access-canonical.md:** regra canÃ´nica de acesso ao Supabase (Management API PowerShell, SSH fallback, token env var).
* **docs/enterprise/specs/tenant-isolation-backfill.md:** spec tÃ©cnica da dÃ­vida C1, diagnÃ³stico, fases de soluÃ§Ã£o e validaÃ§Ã£o.

### Validation

* `pnpm typecheck` OK (web + bff).
* AR01â€“AR18: 17 passed (armeiro-suite) apÃ³s migration 000004+000005.
* E2E full suite em andamento.

---

# 2026-06-28

### Features

* **arsenal/categorias:** Almoxarifado agora tem aba de categorias para `admin_reserva`, com cadastro/edicao logica de categorias, flags de calibre, validade, numero de serie, veiculo e alertas configuraveis.
* **reserva/almoxarifado:** rota `/reserva/arsenal` agora exibe abas `Materiais` e `Categorias` para `admin_reserva` e `armeiro`; o dropdown de categoria tem seta explicita para listar categorias ja criadas e botao `+` separado para criacao rapida.
* **arsenal/ux:** dialogos de adicionar material no admin e de solicitar material no armeiro ganharam seletor-criador de categoria com botao `+`, mantendo a categoria no dropdown e ativando campos contextuais sem trocar de tela.
* **arsenal/veiculos:** categoria de veiculos passa a exigir placa e modelo, com campos de cor e ano opcionais para viaturas, carros, motos, vans e categorias equivalentes.
* **arsenal/metadados:** cadastro de material agora suporta categoria livre, descricao opcional, calibre obrigatorio para armas, controle opcional de numero de serie e validade obrigatoria para coletes com alertas configuraveis de 1 ano, 6 meses e 90 dias.
* **arsenal/rbac:** solicitacoes de armeiro carregam os novos metadados e continuam indo para aprovacao exclusiva do `admin_reserva`; `admin_global` deixou de ser role de mutacao direta em `/api/admin/almoxarifado`.
* **notificacoes:** criada base de deduplicacao `material_validity_alert_events` e rotina BFF para gerar notificacoes de validade para armeiros, admins da reserva e militar com posse ativa.
* **relatorios:** filtros avancados de admin/reserva agora incluem categoria e calibre quando categoria `arma` e exportacoes CSV/Excel incluem coluna `Calibre`.

### Bug Fixes

* **arsenal/usuarios:** abas `Materiais/Categorias` agora ficam no topo do Almoxarifado para `admin_reserva` e `armeiro`; modal de adicionar material foi ampliado, foto do perfil no header usa carregamento imediato, `/admin/usuarios` aceita `admin_reserva`, busca/autocomplete reutiliza o endpoint existente e o cadastro de militar permite perfil inicial `usuario` ou `armeiro` conforme RBAC.
* **reserva/ui:** abas do Almoxarifado foram separadas da area de acoes para ficarem sempre visiveis, solicitacao de material do armeiro agora abre em dialogo largo e o botao de recolher sidebar volta a ser o primeiro controle do menu.
* **arsenal/ux:** botao `Criar categoria` ganhou camada propria nos dialogs de material, evitando interceptacao de clique por campos vizinhos em viewports menores.
* **usuarios/ux:** botoes `Cadastrar Militar` e `Criar Login` aguardam hidratacao do toolbar antes de aceitar clique, evitando clique perdido no carregamento inicial.
* **auth/cloudflare:** server components em runtime Edge agora leem `SUPABASE_URL` e `SUPABASE_ANON_KEY` tambem dos bindings `getRequestContext().env`, evitando redirect indevido para `/login` apos login em Cloudflare Pages.
* **auth/layout:** dashboard deixou de selecionar `profiles.reserve_id` inexistente no banco real; a reserva atual agora vem de `reserve_memberships`, removendo redirect indevido para `/login` apos autenticacao valida.

### Database

* **supabase:** aplicada no banco real a migration `20260628000004_material_category_ux.sql`, ampliando `material_categories`, relacionando `material_types.category_id`, incluindo campos de veiculo e recriando `material_availability` com os novos metadados.
* **supabase:** aplicada no banco real a migration `20260628000003_material_metadata_alerts.sql`, com `material_types.categoria` em texto livre, `categoria_slug`, `calibre`, flags de serie/validade, `validity_alert_days`, indices e view `material_availability` ampliada.

### Validation

* `node --experimental-strip-types --test apps/bff/src/__tests__/audit-hash.test.ts apps/bff/src/__tests__/totp-guard.test.ts apps/bff/src/__tests__/material-metadata.test.ts` = 24 passed.
* `pnpm typecheck` OK.
* `pnpm lint` OK.
* `pnpm --filter web build` OK.
* `supabase migration list` confirma `20260628000004` local/remoto aplicado.

---

# 2026-06-27

### Features

* **arsenal/perfil/feedback:** fotos opcionais de materiais com bucket `material-photos`, upload/captura em cadastro de material, perfil do usuario com foto/preferencias, rota `/suporte` para problema/sugestao/critica/elogio e regressao E2E `arsenal-profile-feedback` (3/3).
* **arsenal/rbac:** fluxo de solicitacao do armeiro para adicao/desativacao/ajuste de material com aprovacao exclusiva por `admin_reserva`; `superadmin` permanece restrito a gestao global/tenants/saude/branding, sem dados internos da reserva.

* **fase-d:** PDF de passagem de turno com QR code verificÃ¡vel â€” endpoint pÃºblico `GET /api/handovers/:id/verify` embutido como matrix QR via `pdf-lib` rectangles (pure JS, zero canvas)
* **fase-d:** `apps/bff/src/lib/totp-guard.ts` â€” `checkTotpGuard()` funÃ§Ã£o pura extraÃ­da; TOTP anti-replay consolidado em `handovers.ts`, `saidas.ts` e `cautelamentos.ts` (elimina VULN #1)
* **fase-d:** testes unitÃ¡rios BFF â€” 15/15 passando com `node --experimental-strip-types`:
  - `audit-hash.test.ts` â€” 8 casos: determinismo, encadeamento SHA-256, JSON canÃ´nico, tamper detection
  - `totp-guard.test.ts` â€” 7 casos: anti-replay, rate-limit 5/15min, expiraÃ§Ã£o de janela, verificaÃ§Ã£o criptogrÃ¡fica

### Bug Fixes

* **suporte:** removido seletor redundante de tipo de contato; pagina mantem apenas canal unico, email, copiar email, envio por email e prazo de resposta.
* **auth/login:** login por senha agora cria sessao HttpOnly no BFF via `/api/auth/exchange` antes do redirect, evitando 401 em `/api/auth/me` e retorno para `login?reason=session_expired`.
* **suporte:** rota `/suporte` simplificada para canal unico, email `suporteonix@arckosia.com.br`, selecao de tipo de contato, botao de copiar email e prazo de resposta de ate 3 dias uteis.
* **reserva/arsenal:** botao `Adicionar Material` restaurado para `armeiro`; agora abre solicitacao de adicao via aprovacao do `admin_reserva`, sem permitir gestao direta interna por `superadmin`.
* **reserva/sw:** service worker deixou de cachear navegacoes autenticadas (`/reserva`, dashboard etc.) com `NetworkFirst`, evitando `sw.js no-response` em rotas dinamicas de sessao.
* **reserva/cautelas:** lista inicial carrega via cookie BFF sem aguardar `supabase.auth.getSession()`; endpoint reduziu payload do SELECT e recebeu indices compostos `tenant/status/created_at` e `tenant/militar/created_at`.
* **reserva/ui:** Sheet fecha por `Escape`, evitando overlay preso apos cancelar a solicitacao de material em testes e uso real.
* **bff/inventory:** verificacao publica de inventario movida para rota sem auth antes do middleware, preservando QR/hash publico em producao.
* **deploy/bff:** workflow do VPS agora usa `fetch/reset`, `set -euo pipefail`, remove container antigo `apmcb-bff` e recria o servico, evitando falso verde quando `git pull` ou `docker compose up` falham.
* **supabase:** migrations `20260627000002_material_photos_arsenal_rbac` e `20260627000003_cautelamentos_performance` aplicadas e verificadas no banco real; bucket `material-photos`, coluna `material_types.photo_url` e indices de cautelas confirmados.
* **deploy/cloudflare:** runtime Edge restaurado nas rotas dinamicas do App Router para compatibilidade com `@cloudflare/next-on-pages`.
* **arsenal:** botao/modal de Adicionar Material restaurado; `admin_reserva` gerencia direto e `armeiro` solicita aprovacao.
* **playwright/local:** smoke local estabilizado removendo runtime Edge das rotas dashboard afetadas pelo crash RSC no Next Windows; teste HTTPS continua valido em deploy e e pulado somente em `localhost`.

### Validation

* `pnpm typecheck` (web) OK; `pnpm --filter @apmcb/bff typecheck` OK; `pnpm lint` OK com warnings existentes; `pnpm build` OK; Playwright `chromium + rbac-suite + arsenal-profile-feedback` = 53 passed, 1 skipped local HTTPS.

### Bug Fixes (E2E)

* **e2e:** DEC13 â€” filtro de reserva localizado por `aria-label` (compatÃ­vel com produÃ§Ã£o); `name="reserve"` adicionado ao componente `_client.tsx`
* **e2e:** smoke brand panel â€” expectativa atualizada para "Plataforma de Controle" (texto padrÃ£o sem `?tenant=` param)
* **e2e:** smoke Reserva action cards â€” card renomeado para "Cadastrar Biometria" (era "Cadastrar Militar")
* **e2e:** M03 â€” `#create-role` nÃ£o renderizado para armeiro (MASTER_ROLES.length=1); teste corrigido
* **e2e:** M04 â€” seletor escopo `dialog#create-role` para nÃ£o capturar opÃ§Ãµes de outros `<select>` na pÃ¡gina
* **e2e:** F02/F03 â€” `img[alt='PrÃ©via']` (era "PrÃ©via da foto"); botÃ£o X via seletor CSS sibling
* **e2e:** playwright.config.ts â€” projeto `dec-suite` adicionado (DEC01-DEC15)

### Rastreabilidade

* `supabase/migrations/20260626000001_rls_material_items_role_based.sql` â€” formaliza RLS Fase B.2 aplicada via psql

---

# 2026-06-26

### Features

* **fase7:** Dashboard de Comando Enterprise â€” rota `/(dashboard)/admin/comando`, endpoint `GET /api/dashboard/command` com 14 cards de exceÃ§Ã£o e conformidade, filtro por reserva, auto-refresh 30s; suite dec-suite DEC01-DEC15 (15/15 âœ…)
* **fase6:** Livro Digital de ServiÃ§o â€” tabela `service_handovers`, 8 endpoints de passagem de turno, snapshot JSONB automÃ¡tico de 6 tabelas, assinatura dupla TOTP, PDF verificÃ¡vel, notificaÃ§Ãµes push para armeiro entrante; suite handover-suite HT01-HT08 (8/8 âœ…)
* **admin:** CRUD completo de org-units e reserves para `admin_global` em `/admin/estrutura` â€” spec ES01-ES15
* **bff:** endpoint `GET /api/categories` para categorias customizadas por tenant
* **ci/cd:** GitHub Actions â€” lint + typecheck + E2E smoke bloqueiam deploy CF Pages; auto-deploy BFF via SSH em push para main
* **security (fase-a):** consolidaÃ§Ã£o de 6 fixes crÃ­ticos do pm-assessment:
  - BUG #1: `roleGuard` explÃ­cito em `GET /api/ocorrencias`
  - BUG #2: `tenant_id` obrigatÃ³rio em `lendings.ts` â€” retorna 400 se null
  - VULN #1: anti-replay movido para ANTES de `verifySync` em `signatures.ts` (padrÃ£o consistente)
  - VULN #2: `pendingTotpSetup` migrado de `Map` em memÃ³ria para `iron-session` (stateless, sobrevive redeploy)
  - Fix: `PATCH /api/profiles` e `PATCH /api/profiles/:id/status` com `.eq("tenant_id")`
  - Fix: docker-compose.prod.yml sem devices USB para VPS limpa
* **security/ux (fase-b/c):**
  - RLS `material_items_staff_select` + `material_items_usuario_select` â€” staff vÃª tudo; usuÃ¡rio sÃ³ vÃª itens prÃ³prios ou disponÃ­veis
  - `sessions_invalidated_at` adicionado Ã  tabela `profiles`
  - Hook `useRoleGuard` â€” polling 5min + `window.focus` para revalidaÃ§Ã£o de sessÃ£o
  - `RoleWatcher` integrado ao dashboard layout
  - `/api/auth/me` valida role DB vs sessÃ£o; force re-login se divergir
  - `issuedAt` adicionado Ã  `SessionData` para invalidaÃ§Ã£o por timestamp

### Bug Fixes

* **handovers:** `document_type` correto para constraint (`lending | handover | inventory`)
* **handovers:** `tenant_id` adicionado no SELECT `GET /:id`; spec com `reserveId` fixo e membership check
* **handovers:** HT05 busca profile do cadete via Supabase REST (Bearer token)
* **rbac:** armeiro removido de `POST /api/admin/militares`; fix `dashboard.ts` TS2339
* **build:** `useSearchParams` em login wrappado em `Suspense boundary`; FK hint em cautelamentos
* **totp:** parar polling quando servidor retorna 404 (TOTP nÃ£o configurado)
* **lint:** `eslint.config.mjs` â€” ignora `e2e/`, `playwright-report/`, `public/sw.js` (212 erros â†’ 0 erros)
* **docker:** remover USB device do compose base; criar `docker-compose.biometric.yml` override
* **bugs:** 5 falhas crÃ­ticas de produÃ§Ã£o corrigidas (bff auth, fetch direto Supabase)

### Docs

* `docs/enterprise/reports/pm-assessment-fase-bc-report.md` â€” relatÃ³rio completo Fases B+C com checklist G01-G17
* `docs/enterprise/pm-assessment-v1.md` â€” Fases A, B, C marcadas como `[x]`

---

# 2026-06-25

### Features

* **fase5b:** Nexus Enterprise completo â€” BFF + frontend:
  - Sidebar colapsÃ¡vel com branding accordion
  - Login dinÃ¢mico por tenant (slug param)
  - Setup 2FA via `/nexus/setup-2fa`
  - GestÃ£o de usuÃ¡rios completa com reset TOTP
  - suite nexus-enterprise-suite NE01-NE16
* **fase5:** SaÃ­da DiÃ¡ria Enterprise (item-based) â€” `POST /api/saidas` e fluxo completo:
  - Dual-auth TOTP + biometria em `sign-armeiro` / `sign-militar`
  - Status machine: `pending` â†’ `signed_armeiro` â†’ `active` â†’ `returned`
  - suite saida-suite SD01-SD06 (6/6 âœ…)
* **fase5:** Cautela Permanente â€” tabelas `lendings` enterprise + `cautelamentos` + trigger P0001 (posse exclusiva):
  - PDFs com hash verificÃ¡vel
  - UI cautelas com `SignDialog` dual-auth
  - Bucket `custody-docs` no Supabase Storage
  - suite cautelamento-suite CT01-CT08 (8/8 âœ…)
  - suite item-integrity-suite IT01-IT09
* **fase4:** Assinatura EletrÃ´nica NÃ­vel 1:
  - Tabela `document_signatures` com RULE de imutabilidade
  - `apps/bff/src/lib/document-hash.ts` â€” `hashDocument()`
  - `apps/bff/src/lib/signature-proof.ts` â€” `computeSignatureProof()`
  - Rota pÃºblica `/v/[document_id]` para verificaÃ§Ã£o
  - suite signature-suite SIG01-SIG06 (6/6 âœ…)
* **e2e:** visual-full-suite â€” bateria visual ponta-a-ponta VF01-VF35

### Bug Fixes

* **bff:** `document_type` correto para constraint Supabase (`lending` vs `handover`)
* **bff/e2e:** `ip` invÃ¡lido em `inet NOT NULL`; suites F5 em serial mode
* **bff:** substituiÃ§Ã£o de `supabase.auth.getUser/signInWithPassword` por `fetch` direto (BFF iron-session)
* **fase4:** edge runtime na pÃ¡gina `/v/[document_id]` para CF Pages
* **totp:** `armeiro` e `admin` roles podem chamar `totp/setup` para document signing
* **layout:** mapeia roles RBAC Fase 2 para nav UI (`armeiroâ†’master`, `admin_globalâ†’admin`)
* **e2e:** NE14 usa `domcontentloaded` para evitar timeout no fetch de branding

---

# 2026-06-23

### Bug Fixes

* **types:** corrige `UserData` duplicado em `_edit-dialog.tsx` e `_user-actions.tsx` â€” tipo canÃ´nico exportado de `_edit-dialog`
* **types:** remove `@ts-expect-error` obsoleto em `e2e/rbac.spec.ts:34`
* **frontend:** role checks e `status_legacy` corrigidos em admin/usuarios, reserva/militares

### Docs

* **reports:** relatÃ³rios finais das Fases 1, 2 e 3 gerados em `docs/enterprise/reports/`
* **roadmap:** Fase 3 marcada como concluÃ­da; Fase 2B renumerada para 7B

---

# 2026-06-22

### Features

* **fase3:** `audit_events` com hash SHA-256 encadeado, RULE SQL de imutabilidade, snapshots before/after, middleware fire-and-forget em todos os endpoints sensÃ­veis
* **fase3:** `computeEventHash()` em `apps/bff/src/lib/audit-hash.ts` â€” cadeia de hash verificÃ¡vel (`previous_hash` do evento N+1 = hash do evento N)
* **fase3:** suite `audit-suite` â€” AT01-AT05 + SEC-3-01 + SEC-3-03 (7/7 âœ…)
* **fase2:** RBAC Enterprise â€” 6 roles institucionais: `superadmin`, `admin_global`, `admin_reserva`, `armeiro`, `usuario`, `auditor`
* **fase2:** migraÃ§Ã£o de dados: `adminâ†’admin_global`, `masterâ†’armeiro` aplicada via Supabase SDK (service_role)
* **fase2:** `roleGuard` atualizado em 10+ rotas BFF; `HonoVariables` com tipo `Role` expandido
* **fase2:** `landAt` corrigido: `armeiroâ†’/reserva`, `admin_globalâ†’/admin`, `auditor/admin_reservaâ†’/reserva`
* **fase2:** suite `rbac-suite` â€” PT01-PT08 + SEC-2-* (10/10 âœ…)
* **fase1:** suite `multitenant-suite` â€” TT01-TT14 (14/14 âœ…); Slice 1A completo
* **e2e:** `global-setup.ts` â€” fix permanente do ENOTEMPTY no Playwright (rimraf recursivo)
* **infra:** `playwright.config.ts` â€” workers:2, mobile-safari removido do run principal, invite-activate deduplicado

### Bug Fixes

* **auth:** `exchange` com role `master` redirecionava para `/cadete` apÃ³s migraÃ§Ã£o â€” corrigido `armeiroâ†’/reserva`
* **e2e:** harness.ts USERS atualizado: `admin_global` e `armeiro` como role values pÃ³s-migraÃ§Ã£o

### Breaking Changes

* Roles `"admin"` e `"master"` **removidos** do tipo `Role` e `SessionData`. Usar `"admin_global"` e `"armeiro"`.

---

# 2026-06-19

### Features

* **auth:** tela de ativaÃ§Ã£o de conta por convite (`/auth/confirmar-conta`) com formulÃ¡rio de primeira senha, medidor de forÃ§a, visibility toggle e redirecionamento por role
* **auth:** `/api/auth/activate-account` â€” edge route que marca `account_activated_at` via service_role apÃ³s definiÃ§Ã£o da primeira senha
* **auth:** melhoria em `/auth/update-password` â€” visibility toggle em ambos os campos, exibiÃ§Ã£o contextual do e-mail, checklist visual de requisitos
* **e2e:** suite `invite-suite` â€” IA01-IA17 (17 testes cobrindo ativaÃ§Ã£o, reset, routing PKCE e proteÃ§Ã£o de API)

### Bug Fixes

* **auth:** `inviteUserByEmail`/`generateLink` redirecionavam para `/login` que nÃ£o processa cÃ³digo PKCE â€” alterado para `/auth/callback?next=/auth/confirmar-conta`
* **auth:** callback route suporta fluxo de convite via parÃ¢metro `next` + fallback `token_hash + type` (OTP flows)
* **e2e:** flakiness SD05-SD07 eliminada usando `tr[data-testid^='saida-row-']` para aguardar hidrataÃ§Ã£o React
* **deploy:** `docker-compose.yml` corrigido com `SESSION_SECRET` e `INTERNAL_API_SECRET` no environment do BFF

---

# 2026-06-18

### Bug Fixes

* **e2e:** corrige autenticaÃ§Ã£o Bearer e session isolation no harness SSA
* **infra:** `SUPABASE_SERVICE_ROLE_KEY` no `/opt/apmcb/.env` substituÃ­do pela chave real; container BFF recriado para recarregar env vars
* **e2e:** `getSupabaseToken` detecta JSON plano vs base64url â€” `@supabase/ssr` v0.12 sem `cookieEncoding` armazena sessÃ£o como JSON direto
* **e2e:** `clearCookies()` antes de cada `login()` elimina corrupÃ§Ã£o de cookies fragmentados entre trocas de usuÃ¡rio
* **e2e:** `bffCall` omite `Content-Type` quando body ausente â€” evita 400 do zValidator Hono ao parsear corpo vazio
* **tests:** rate limit aumentado para 100/min; fix ST01 text mismatch

---

# 2026-06-17

### Features

* **arsenal:** filtros de busca + categoria + estoque na pÃ¡gina de almoxarifado do armeiro
* **arsenal:** clicar em material abre detail sheet com KPIs, barra de disponibilidade e status
* **arsenal:** armeiro pode solicitar ajuste de estoque ao admin (stepper +/- com mÃ­nimo = em uso)
* **arsenal:** armeiro pode solicitar adiÃ§Ã£o de material em batch; solicitaÃ§Ãµes pendentes no dashboard admin
* **arsenal:** pÃ¡gina `/admin/arsenal/solicitacoes` com tabs Pendentes/Aprovadas/Rejeitadas/Todas
* **arsenal:** aprovaÃ§Ã£o executa a aÃ§Ã£o imediatamente; rejeiÃ§Ã£o exige motivo obrigatÃ³rio â‰¥ 5 chars
* **arsenal:** armeiro recebe notificaÃ§Ã£o push/in-app ao ter solicitaÃ§Ã£o aprovada ou rejeitada
* **militares:** clicar em militar abre sheet com perfil, status biomÃ©trico e dedos cadastrados
* **saidas:** "Registrar SaÃ­da" exige verificaÃ§Ã£o de identidade antes do submit (biometria ou TOTP)
* **db:** migration `admin_approval_requests` com RLS, Ã­ndices, trigger de auditoria
* **bff:** rotas `/api/arsenal/requests` â€” POST/GET/approve/reject com notificaÃ§Ã£o automÃ¡tica
* **ui:** dropdowns/popovers com fundo sÃ³lido corrigido via `@theme inline {}` no globals.css

---

# Releases anteriores (prÃ©-2026-06-17)

Consultar git log completo: `git log --oneline` â€” histÃ³rico disponÃ­vel desde o commit inicial de 2026-05-x.

Marcos principais:
- **2026-06-17:** Arsenal enterprise â€” solicitaÃ§Ãµes, detail sheet, biometria
- **2026-06-16:** SSA sistema completo + UI/UX polish
- **2026-06-15:** Security hardening â€” CSP nonces, CSRF, body limit, fail2ban, super admin spec
- **2026-06-14:** BFF Hono + Docker Compose VPS + ZKTeco bridge + PWA manifest
- **2026-06-13:** Next.js 16 Turbopack + CF Pages edge runtime + auth flows completos
- **2026-06-12:** Scaffold inicial â€” Next.js 15, shadcn/ui, TanStack Query, Zustand, Supabase
