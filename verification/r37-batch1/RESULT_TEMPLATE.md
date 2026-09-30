# R-37 lote 1 — resultado da verificação externa

ENVIRONMENT: Container de nuvem descartável (sessão Claude Code remota). Worktree
  destacado de `origin/claude/r37-batch1-verification` (`dcc5feb`) no scratchpad da
  sessão; nenhuma outra branch tocada, sem merge. Node v22.22.2, pnpm (lockfile
  congelado), vitest (apps/web), bun 1.4.2 via `npx -y bun@1.4.2` (igual à CI). Env de
  CI com valores dummy (SUPABASE_URL=https://dummy.supabase.co etc.,
  AMBIENTE_INFRA=SUPABASE na integração). Sem produção, sem rede para o Supabase, sem
  deploy/db push. Identidades e dados artificiais (tenants/reservas/usuários com UUIDs
  de teste).
PAGE_SHA256 / TEST_SHA256 conferidos: OK (`sha256sum -c verification/r37-batch1/SHA256.txt`)
  page.tsx       5ceffc22ba48b62ccf479c9f3203fb5c5132855dc1beb2457c1fa19e8eb491ba OK
  page.test.tsx  d267f03de430ca3a0fde876e440927b900ff0a8810475109575c3548fd1bc043 OK
PAGE_TEST_NEW (9/9?): 9/9 PASS (`npx vitest run "src/app/(dashboard)/reserva/ocorrencias/page.test.tsx"`)
PAGE_TEST_OLD (falhas esperadas): 8 failed | 1 passed, como esperado. Página antiga =
  `043d0af:page.tsx` (sha 6d1f514a…). Falharam A, B, F, G, G2, H, "nunca lê ocorrências
  direto do Supabase com o JWT do usuário" e "page.tsx não cria cliente Supabase". Página
  nova restaurada (sha 5ceffc22… conferido): 9/9.
ENDPOINT_TEST_FILE (caminho + conteúdo anexado):
  `apps/bff/src/__tests__/integration/ocorrencias-scope-real-handler.test.ts` (não
  commitado; conteúdo completo anexado na resposta). authMiddleware + ocorrenciasRoutes
  REAIS, montados como em src/index.ts; iron-session selada de verdade; banco em memória
  `fake-postgrest`. Compara o CONJUNTO exato de ids. 12 casos: A..H, B', I (extra), 401
  sem credencial e MULTI_SESSION.
ENDPOINT_RESULTS (A..H, MULTI_SESSION): 12/12 PASS, sozinho e dentro da suíte de
  integração inteira.
  A  staff A1 normal -> {A1 mil, A1 outro mil em_analise, A1 via material_type, A1 do próprio staff};
     sem A2/B1/resolvida/órfã ............................................... PASS
  B  mesmo staff em Modo Usuário -> só {A1 do próprio staff} ................... PASS
  B' Modo Usuário + Bearer do próprio staff -> continua só as próprias ......... PASS
  C  militar A -> só as próprias (4, qualquer reserva/status); outro militar de A -> só as dele PASS
  D  staff B1 -> só {B1} ........................................................ PASS
  E  staff A1 não vê A2 ......................................................... PASS
  F  cookie do militar A + Bearer staff A1 -> exatamente o conjunto do militar ... PASS
  G  staff sem tenant na sessão -> 403 .......................................... PASS
  H  Bearer staff sem sessão -> teto usuario, só {A1 do próprio staff} ........... PASS
  I  (extra) admin_global matriz A -> tenant A inteiro, nada de B1 .............. PASS
  -  sem sessão e sem Bearer -> 401 ............................................. PASS
  MULTI_SESSION X(staff)/Y(Modo Usuário), alternando X,Y,X,Y .................... PASS
  Também verificado em toda linha: `lending_id`/`material_type_id` não saem na resposta.
ENDPOINT_MUTATION_RESULT: DETECTADA. Mutações temporárias em src/middleware/auth.ts,
  revertidas com `git checkout`; sha do arquivo conferido igual ao original.
  M1 (ignorar activeMode, papel = session.role = profiles.role): falham B, B', MULTI_SESSION.
  M2 (Bearer usa profiles.role em vez do teto usuario): falha H.
  M1+M2: falham B, B', H, MULTI_SESSION.
  Dentro da suíte inteira, as mesmas mutações também derrubam os casos de
  mode-user-auth-paths.test.ts.
  Extras em src/routes/ocorrencias.ts, também revertidas:
  X1 (sem filtro de tenant): falha I. Nenhum caso A..H detecta, porque o filtro de
     reserva já exclui B1 para staff de filial; ver NOTES.
  X2 (sem filtro de reserva): falham A, E, MULTI_SESSION.
  Depois de reverter tudo: 12/12 sozinho e 148/148 na integração. `git status` só mostra
  o arquivo de teste novo (untracked).
BFF_UNIT: PASS. `node --experimental-strip-types --test "src/__tests__/*.test.ts"`, env de CI: 695/695 pass, 0 fail
BFF_INTEGRATION: PASS. `bun test src/__tests__/integration`: 148 pass / 0 fail, 15 arquivos
  (inclui o teste novo).
WEB_VITEST: PASS. `npx vitest run` (apps/web): 40 arquivos, 292/292 pass (inclui page.test.tsx 9/9)
TYPECHECK: PASS. `tsc --noEmit` do BFF com exit 0 (já incluindo o teste novo) e do web com exit 0.
  Na 1ª execução o tsc do BFF acusou 1 erro SÓ no teste novo (TS2307 no specifier
  `auth.ts?r37-ocorrencias`). Corrigido no próprio teste com specifier não-literal e
  tipo `typeof import("../../middleware/auth.ts")`. Depois disso: tsc exit 0, teste
  12/12, integração 148/148, e M1+M2 ainda detectadas na suíte inteira.
FINAL_RESULT: PASS
EXECUTED_BY / EXECUTED_AT: Claude Code (validador independente, sessão remota) / 2026-09-30 ~13:40–14:00 UTC
NOTES:
- Nenhum código de produção alterado; as mutações foram temporárias e revertidas. Sem
  commit, push ou merge.
- Ambiente, teste de integração: na 1ª versão do teste, o caso H passava sozinho e
  falhava (401) com a suíte inteira. É a armadilha descrita em ACCEPTANCE_CRITERIA: o
  SupabaseAuthProvider guarda o `fetch` do primeiro arquivo que importa o middleware, e
  o bun compartilha o cache de módulos. Corrigido SÓ no arquivo de teste: o middleware é
  importado com um specifier próprio (`auth.ts?r37-ocorrencias`), o que cria instância
  nova com o mock deste arquivo. Não é defeito do lote.
- Achado de cobertura, não de correção: os casos A..H do pacote não detectam a remoção
  do filtro de tenant (`.eq("military.default_tenant_id", tenantId)`), porque o filtro
  de reserva já confina staff de filial. O caso extra I (matriz, sem filtro de reserva)
  fecha essa lacuna.
- Durante a execução, o verificador de segurança do ambiente ficou alguns minutos sem
  responder a comandos Bash (falha transitória da plataforma). Quando voltou, toda a
  regressão foi executada.
- O arquivo de teste novo NÃO foi commitado. Se for adotado, ele entra junto com o lote
  (é o único arquivo novo; untracked no worktree de verificação).
