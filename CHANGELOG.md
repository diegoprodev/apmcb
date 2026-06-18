# (2026-06-18)


### Bug Fixes

* **e2e:** corrige autenticação Bearer e session isolation no harness SSA ([c7bc332](https://github.com/diegoprodev/apmcb/commit/c7bc3325bc9f472bcb4a5e3901fabda06f45aace))
* **infra:** SUPABASE_SERVICE_ROLE_KEY=PREENCHA em /opt/apmcb/.env substituído pela chave real; container BFF recriado (não apenas restarted) para recarregar env vars
* **e2e:** getSupabaseToken detecta JSON plano vs base64url — @supabase/ssr v0.12 sem cookieEncoding armazena sessão como JSON direto, não base64
* **e2e:** clearCookies() antes de cada login() elimina corrupção de cookies fragmentados entre trocas de usuário na mesma page context
* **e2e:** bffCall omite Content-Type quando body ausente — evita 400 do zValidator Hono ao parsear corpo vazio em PATCH sem payload
* **tests:** increase rate limit to 100/min, fix ST01 text mismatch ([07e8c8a](https://github.com/diegoprodev/apmcb/commit/07e8c8a))


# (2026-06-17)


### Features

* **arsenal:** filtros de busca + categoria + estoque na página de almoxarifado do armeiro
* **arsenal:** clicar em material abre detail sheet com KPIs, barra de disponibilidade e status
* **arsenal:** armeiro pode solicitar ajuste de estoque ao admin (stepper +/- com mínimo = em uso)
* **arsenal:** armeiro pode solicitar adição de material em batch (vários materiais de uma vez)
* **arsenal:** solicitações ficam pendentes no dashboard admin com banner âmbar + contagem
* **arsenal:** página `/admin/arsenal/solicitacoes` com tabs Pendentes/Aprovadas/Rejeitadas/Todas
* **arsenal:** aprovação executa a ação imediatamente (UPDATE quantidade ou INSERT material_types)
* **arsenal:** rejeição exige motivo obrigatório ≥ 5 chars
* **arsenal:** armeiro recebe notificação push/in-app ao ter solicitação aprovada ou rejeitada
* **arsenal:** armeiro vê histórico das próprias solicitações na página almoxarifado (banner colapsável)
* **relatorios:** armeiro vê histórico de solicitações ao admin na mesma janela de datas
* **relatorios:** admin vê todas as solicitações de almoxarifado com coluna de revisor
* **militares:** clicar em militar abre sheet com perfil, status biométrico e dedos cadastrados
* **militares:** sheet com FingerSelector mostrando dedos registrados (verde) vs selecionado (azul)
* **militares:** modal "Cadastrar Militar" ampliado (max-w-3xl, dois colunas, biometria expandida)
* **saidas:** "Registrar Saída" exige verificação de identidade antes do submit (biometria ou TOTP)
* **db:** migration `admin_approval_requests` com RLS, índices, trigger de auditoria
* **bff:** rotas `/api/arsenal/requests` (POST/GET), `/approve`, `/reject` com notificação automática
* **ui:** botões com `cursor-pointer` e melhor contraste de hover em todos os estados
* **ui:** dropdowns/popovers com fundo sólido corrigido via `@theme inline {}` no globals.css


### Bug Fixes

* **admin:** clean up diagnostic, keep getRequestContext fallback ([207a4e1](https://github.com/diegoprodev/apmcb/commit/207a4e1bcb271cf458a459b23c994da57eaebe68))
* **admin:** posto/categoria regressões + filtros de arsenal ([4e6a89d](https://github.com/diegoprodev/apmcb/commit/4e6a89d232336183940c3f361a9d6d8f2f17e8f6))
* **admin:** read SUPABASE_SERVICE_ROLE_KEY via CF Pages getRequestContext ([595d806](https://github.com/diegoprodev/apmcb/commit/595d806603b0c4476f9154bfb9bf04d50b86e2e0))
* **auth:** dashboard layout wrong column names cause redirect loop to login ([a752e9b](https://github.com/diegoprodev/apmcb/commit/a752e9b13d27202028969437a732ac28ae7de005))
* **auth:** hardcode Supabase public keys in client.ts; remove logo frames ([f9a629b](https://github.com/diegoprodev/apmcb/commit/f9a629be671b721ea418d1ad1604abc055d63648))
* **bff+e2e:** CSRF retorna 401 p/ nao-autenticados + ssa-suite sequencial ([f8e5ec0](https://github.com/diegoprodev/apmcb/commit/f8e5ec0c698fb0595bd1be7e0501eb5d79780f21))
* **bff:** add curl to alpine image + Docker HEALTHCHECK ([9d729e7](https://github.com/diegoprodev/apmcb/commit/9d729e7ef17527aac62448f0c7e2ea4cc8951aeb))
* **bff:** replace .catch() on PostgrestBuilder with try/catch (TS2339) ([3160742](https://github.com/diegoprodev/apmcb/commit/3160742ae12b391e8db1d2eddc1cba1635a18c97))
* **bff:** skip CSRF for Bearer token requests + fix E2E harness to use Supabase token ([a30ef89](https://github.com/diegoprodev/apmcb/commit/a30ef890ac7bf10ee39efca77132aae2717e88aa))
* **biometria:** use real checkbox input for reliable state toggle ([5961868](https://github.com/diegoprodev/apmcb/commit/5961868f49e9c44d2ce381bdd2e4a38993622afc))
* **build:** inline NEXT_PUBLIC vars via next.config.ts env section ([786f1df](https://github.com/diegoprodev/apmcb/commit/786f1df3dc67407f8018e6498bbfaaa0eb74f107))
* **cadete:** fallback de saudacao Cadete -> Militar ([2b23e4e](https://github.com/diegoprodev/apmcb/commit/2b23e4e31574eaa000675bcf7669ed417b1b644d))
* **cf:** add root wrangler.toml with nodejs_compat for CF Pages Edge Worker ([295f875](https://github.com/diegoprodev/apmcb/commit/295f875d8d0fdf6aa9e80b9b8c37733808cee741))
* **cf:** add SUPABASE_ANON_KEY to wrangler.toml vars ([872de9e](https://github.com/diegoprodev/apmcb/commit/872de9e7724232387a7a8bb767355fd7dea10cac))
* **cf:** add vars section to wrangler.toml for CF Pages env bindings ([6541019](https://github.com/diegoprodev/apmcb/commit/6541019867b15fb0ede8f22a46ce98fc459d25ce))
* **ci:** remove explicit pnpm version from action-setup — reads from packageManager field ([b6671d5](https://github.com/diegoprodev/apmcb/commit/b6671d501c1c43e364ce73137aa7abd5e81a8768))
* correcoes SSA + nome_de_guerra + deploy submodule ([083b090](https://github.com/diegoprodev/apmcb/commit/083b090ed579554f9f48296622534cc1a80af9f5))
* **db:** recreate audit_material_request trigger with reserva_id column name ([21f6905](https://github.com/diegoprodev/apmcb/commit/21f6905326d5bb075e735f9d2af345c7305942a2))
* **e2e+bff:** corrige auth Bearer via cookie base64 e race condition TOTP ([33e46e2](https://github.com/diegoprodev/apmcb/commit/33e46e22897135457a162ad0f3e22a97e6327a8c))
* **e2e:** biometria checkbox label + precise finger selectors in tests ([c081734](https://github.com/diegoprodev/apmcb/commit/c081734bcb208f5376bab132ce09b26391d5f1f6))
* **e2e:** cleanupRequests reseta last_used_token TOTP entre testes ([5a8ae7a](https://github.com/diegoprodev/apmcb/commit/5a8ae7a76dad8fe5fd689b581dcd6540722cc50f))
* **e2e:** fix waitForDashboard for mobile viewport, harden login helper ([fc3d7d1](https://github.com/diegoprodev/apmcb/commit/fc3d7d1e8342f3f76593899240b3ee08ca4be419))
* **e2e:** R21 use combobox/select to detect filter panel open state ([4a79c2a](https://github.com/diegoprodev/apmcb/commit/4a79c2aef62d32471a257cb455ef67c9875e8e2e))
* **e2e:** use precise password input selector in login harness ([5dc4d53](https://github.com/diegoprodev/apmcb/commit/5dc4d53730c8d586dec1a71b5e88d6d5f69c105e))
* **infra:** health check comparison in deploy-bff.sh ([a118cfc](https://github.com/diegoprodev/apmcb/commit/a118cfc84f13ebaf66a1574324ee86a2ca4ebc21))
* **login:** PMBA -> PMPB, remove logo ring, update footer attribution ([1641189](https://github.com/diegoprodev/apmcb/commit/1641189c4b5c925286c0f4ed89840d00d3be27b9))
* logo 404, TOTP 401 loop e rota /cadete/solicitacoes ausente ([88f0997](https://github.com/diegoprodev/apmcb/commit/88f0997f4a0947b3eb12934a35f18c5cfcb12f79))
* **pnpm:** downgrade packageManager to pnpm@9 to match CF Pages env ([108c814](https://github.com/diegoprodev/apmcb/commit/108c814b9c2fbb0a1c0fc990aed794598b0742a4))
* **pnpm:** move onlyBuiltDependencies to pnpm-workspace.yaml for pnpm v11 ([642eecc](https://github.com/diegoprodev/apmcb/commit/642eecc5547b021346b3351572c4a310e8d776b6))
* **pnpm:** use allowBuilds in pnpm-workspace.yaml for pnpm v11 ([4d92f39](https://github.com/diegoprodev/apmcb/commit/4d92f394443d4f6c6295e82486c9949bbd2ff2e2))
* remove unreadCount prop + renomear emprestimo para saida no frontend ([404fcb4](https://github.com/diegoprodev/apmcb/commit/404fcb42c68140b24a27f2e51cb45489fdf2824d))
* replace apmcb.com.br with apmcb.pmpb.online across all config files ([b107bc0](https://github.com/diegoprodev/apmcb/commit/b107bc0c069a31c5d113e5bc281abe0ae49b6b8b))
* **reserva:** corrige identif. JS corrompido r.reserva em _solicitacoes-client ([488a286](https://github.com/diegoprodev/apmcb/commit/488a28613b2a87a8290c8b10677630530b70d88d))
* **security:** aplicar correções pentest V01/V02/V04/V10 + fix cadete redirect ([af20dcf](https://github.com/diegoprodev/apmcb/commit/af20dcf167943bcef59f8f414069020206bed349))
* **security:** apply remaining pentest remediations, score 7.1→8.0 ([7fa183f](https://github.com/diegoprodev/apmcb/commit/7fa183f90629213c22ef8dc145848f675ac3bf02))
* **security:** remove hardcoded Supabase keys from client.ts, update lockfile ([63e6ae2](https://github.com/diegoprodev/apmcb/commit/63e6ae29d04545fa10b70c95c4d9452e677cedc9))
* **shared:** add ReturnLending type export, add updated_at to MaterialTypeSchema ([1249b95](https://github.com/diegoprodev/apmcb/commit/1249b95b227e21300f6dcc7ee25aa0e2ecf0ecf3))
* **ssa:** Bearer auth em sheet, testid totp-code, cleanup ST beforeAll ([4dfbc91](https://github.com/diegoprodev/apmcb/commit/4dfbc91fe732f922fe693f6a8b0782b7f9854846))
* **ssa:** SA11 retry em CF Worker 1102, SR13 aguarda BFF estavel ([294cf6f](https://github.com/diegoprodev/apmcb/commit/294cf6f0b8ad303154586597d7b47b91e8676f0e))
* **ssa:** solid sheet UI, all materials list, SW cross-origin fix, military terminology ([edd0de7](https://github.com/diegoprodev/apmcb/commit/edd0de7593a5fd0bc8f5b511012115e125782671))
* **ssa:** timeout 120s, retries 5x, TOTP anti-replay retry, beforeAll robusto ([abf0422](https://github.com/diegoprodev/apmcb/commit/abf04220cc47dcb1fdb65a43851a1ce7808d8af4))
* **tests:** bffCall 7 retries, ssa-suite retries 2/150s, SR13 submit 5x15s ([19174c5](https://github.com/diegoprodev/apmcb/commit/19174c539525974034d490a10ebb84019c5cab20))
* **tests:** retry BFF 503 in harness, ST03 aceita 200/201, SR12/13 retry button ([5fae174](https://github.com/diegoprodev/apmcb/commit/5fae174b5e8bce2a37f9cb8c70434b0437f5573c))
* **tests:** SR13 bffCall health gate antes do submit + timeout 280s ([fd8ca14](https://github.com/diegoprodev/apmcb/commit/fd8ca14327b29a40e20c774b2648f89090015ed4))
* **tests:** SR13 intercept texto correto + clickFirstMaterialCard usa waitFor real ([df72bc7](https://github.com/diegoprodev/apmcb/commit/df72bc74cbc4060463fe74c86411d78644a06d35))
* **tests:** SR13 usa page.route() para interceptar submit (desacopla BFF) ([cdd9f05](https://github.com/diegoprodev/apmcb/commit/cdd9f05915e01b28593ea6bce0897726455ee785))
* **ts:** null-safe posto setter in create-user-dialog; add spec to suite ([36fb930](https://github.com/diegoprodev/apmcb/commit/36fb9301fb798745bf417b6ac4ff3b048cc7a435))
* **ui:** modais sólidos sem transparência, lightbox de foto, diagnóstico 500 admin/users ([7705337](https://github.com/diegoprodev/apmcb/commit/770533786b8a903b0f8bb0be3c4757ff8e48c694))
* **ui:** opaque dialog overlay, PDF letterhead, filter sentinel, e2e green ([814887d](https://github.com/diegoprodev/apmcb/commit/814887da9850f3003fd93cb3703bcf47072c0529))
* **ui:** remover transparência em sheet/dialog + redirect biometria + foto militar ([b795000](https://github.com/diegoprodev/apmcb/commit/b795000edfe90d334d4c618e7484cd802d90dc18))
* **ui:** solid white dialog modal - remove all transparency ([c3fdbaf](https://github.com/diegoprodev/apmcb/commit/c3fdbaf01bdabd84e061d1bfaebc0d6154446a5c))
* **web:** add edge runtime to all dynamic routes, remove proxy.ts ([5ea624d](https://github.com/diegoprodev/apmcb/commit/5ea624d8b39dfe648ff464843e37dbe39fa95feb))
* **web:** force webpack mode for CF build, fix proxy export, re-enable serwist ([5f96137](https://github.com/diegoprodev/apmcb/commit/5f961372d7d4e84b6fdbcf3d1537015f5391e3d6))
* **web:** harden E2E selectors, promote KPI test to PASS, add bottom-nav testid ([c575a24](https://github.com/diegoprodev/apmcb/commit/c575a242e80f089bd21c9672d3afd8e532b6692c))
* **web:** move createClient() into handlers/effects to fix CF Pages prerender ([ff43c0b](https://github.com/diegoprodev/apmcb/commit/ff43c0b009ac28e8f1b5547456896e52357d4ca7))
* **web:** Next.js 16 Turbopack compat + clean build for CF Pages ([82fa00f](https://github.com/diegoprodev/apmcb/commit/82fa00f53032c3693f105f915041d9c153f80b5f))
* **web:** remove registro-pendente gate — militares acessam dashboard independente de biometria ([678456d](https://github.com/diegoprodev/apmcb/commit/678456d57f2919fc0fed2f802bd7e7bfc98c50d2))
* **web:** resolve SUPABASE vars at runtime via non-public env bindings ([d9135df](https://github.com/diegoprodev/apmcb/commit/d9135df66b304f1c2f315b57cdccb05e299dbb3f))
* **web:** restore CSP compatibility with Next.js inline scripts; wire CSRF header on all BFF mutations ([3df6923](https://github.com/diegoprodev/apmcb/commit/3df69238c47fdd1a3442294315715907d16d75c6))
* **web:** skip vercel build install in monorepo, remove duplicate pnpm field ([b6719b7](https://github.com/diegoprodev/apmcb/commit/b6719b78df4dbd368a2204a9b574201b2011bb63))
* **web:** ts error nova saida form + relatorios enterprise com filtros ([2200a12](https://github.com/diegoprodev/apmcb/commit/2200a120a3b43dfada5a43a997601a50fdd8db60))


### Features

* **admin/arsenal:** audit-logged material CRUD via service_role API ([1fd957a](https://github.com/diegoprodev/apmcb/commit/1fd957a808706d685afda8e0b40bd04c3786439c))
* **admin:** criar usuário com magic link/senha, logo sidebar, campos estendidos ([8749bbd](https://github.com/diegoprodev/apmcb/commit/8749bbd4c40106510b48ff418af6045820b31671))
* **admin:** distinção Cadastrar Militar vs Criar Login + fix build speed ([f9ae60a](https://github.com/diegoprodev/apmcb/commit/f9ae60a300eeec2e0ca37590e370fde7cd8d13ca))
* **bff:** add apmcb.pmpb.online to CORS allowed origins ([4afcf79](https://github.com/diegoprodev/apmcb/commit/4afcf799490a470aa5391d9da74277adb97b6640))
* **bff:** Hono BFF + Docker Compose VPS + ZKTeco bridge + PWA manifest ([af0280d](https://github.com/diegoprodev/apmcb/commit/af0280de3701efc68865d0a573ef88fadcfde165))
* **bff:** iron-session auth endpoints + dual-mode auth middleware ([f7c3dfc](https://github.com/diegoprodev/apmcb/commit/f7c3dfc0066d1e9dfa7c0a52d8ddcf7fe49066e3))
* **cadete:** alertas de cadastro pendente (biometria + TOTP) + fix BFF URL nos testes ([2766a94](https://github.com/diegoprodev/apmcb/commit/2766a9421ba9eb8460ab50965a9050c9074495ea))
* **db:** initial schema, RLS policies, dev seed applied to remote Supabase ([d734d62](https://github.com/diegoprodev/apmcb/commit/d734d62ddb6ad98977f0719026525c0d94cea1df))
* DESIGN.md Apple-inspired premium system + refined CSS tokens + APMCB logo ([87670fd](https://github.com/diegoprodev/apmcb/commit/87670fd3e5ed788e048808a946e419313c612a47))
* **design:** severity system, military tokens, data-viz palette, WCAG AA ([add39e1](https://github.com/diegoprodev/apmcb/commit/add39e113f56e08fe04a66401305ae5a7e7bad03))
* Fase 1 completa + fix lockfile iron-session ([fce6144](https://github.com/diegoprodev/apmcb/commit/fce61444636ea5ef14c326a6a9bb0a4dd47ed4a5))
* **login:** matricula login — 6 numeric digits resolve to email via RPC ([b4c944e](https://github.com/diegoprodev/apmcb/commit/b4c944e594348d50d9f0702685091a1d16339f3b))
* **login:** split-panel layout — white form left, brand panel right ([e01e95f](https://github.com/diegoprodev/apmcb/commit/e01e95fc2713c41f773d899542dfbb89c3f78de8)), closes [#0f2460](https://github.com/diegoprodev/apmcb/issues/0f2460) [#1B3A8C](https://github.com/diegoprodev/apmcb/issues/1B3A8C) [#1e4db7](https://github.com/diegoprodev/apmcb/issues/1e4db7)
* master RBAC, photo upload, biometria UI, notifications ([f44ff18](https://github.com/diegoprodev/apmcb/commit/f44ff18c003b7d891a480183b7d91b1dbeed3219))
* Phase 1-3 — password reset, notification enhancements, PWA push ([1c6759f](https://github.com/diegoprodev/apmcb/commit/1c6759f547058ef48a84c07b5c78b972b5c428a4))
* **security:** CSP nonces, CSRF, body limit, fail2ban, VPS non-root, super admin spec ([cc16841](https://github.com/diegoprodev/apmcb/commit/cc16841a73588342207e1c0be6781e087c92e22a))
* **shared:** zod schemas for profile, material and lending ([4115034](https://github.com/diegoprodev/apmcb/commit/41150343a0cd344f440e70caae4c1e67b900f749))
* **ui:** add SeverityAlert component with 4 severity levels ([18183e8](https://github.com/diegoprodev/apmcb/commit/18183e87484f43ac16c466552b1a5dbda89c884c))
* **ui:** SSA sistema completo + UI/UX polish ([10e1251](https://github.com/diegoprodev/apmcb/commit/10e1251f436a95af8afd1e1954b4bbfa8098f366))
* **web:** add Cloudflare Pages support via next-on-pages ([194ef5e](https://github.com/diegoprodev/apmcb/commit/194ef5e377b26d04c870025fc077004912137199))
* **web:** admin sub-pages usuarios + arsenal + lending chart ([da26ab5](https://github.com/diegoprodev/apmcb/commit/da26ab5620d347b0e568eb7ad3d76b95a2d3092e))
* **web:** CRUD completo arsenal+usuarios + suite Playwright spec-driven ([b7aeb16](https://github.com/diegoprodev/apmcb/commit/b7aeb1609ae90473fd9d624ef5b21653d9aeb261))
* **web:** design system tokens, dark/light theme, providers ([2c5ae9b](https://github.com/diegoprodev/apmcb/commit/2c5ae9b07c28a645abe99d331dda929e1f317ee0))
* **web:** fase 2+3 — saidas CRUD + auditoria + relatorios ([82cd12d](https://github.com/diegoprodev/apmcb/commit/82cd12da3a5d46f2946490c5a8f9df6fab0e0041))
* **web:** layout components — sidebar, header, bottom-nav, app-shell + login placeholder ([9e793ff](https://github.com/diegoprodev/apmcb/commit/9e793ff6c708ed13ba58a804a44bdae86f0d660d))
* **web:** Next.js 15 scaffold with shadcn/ui, TanStack Query, Zustand ([0413d0e](https://github.com/diegoprodev/apmcb/commit/0413d0e77a37c43be954bab20b8cf11651de1acd))
* **web:** Sprint 1 — auth flows, middleware, role-based dashboards ([c5570e5](https://github.com/diegoprodev/apmcb/commit/c5570e5a788d55c82abe8b518d69e568a9796773))
* **web:** Supabase browser/server clients + auth hooks ([9f66d08](https://github.com/diegoprodev/apmcb/commit/9f66d08c2e9cdec4500544998403e8d04b9781a7))
* **web:** wire admin KPIs to Supabase, fix E2E selectors, add theme aria-label ([2476402](https://github.com/diegoprodev/apmcb/commit/247640234a607d2607123ac8a346d6a16613f961))
* **web:** wire cadete real data, armeiro navigation, add historico/perfil/militares pages ([5cb0c16](https://github.com/diegoprodev/apmcb/commit/5cb0c16452658004d0966757b0543bc45b7ad9c7))
