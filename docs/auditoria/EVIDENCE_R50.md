# EVIDENCE — R-50: gate de turno com reserva alvo em `PATCH /api/arsenal/items/:id/ocorrencia`

## Estado inicial
HEAD `6f77426` (R-48); árvore limpa; `origin/main` `70c3fa7` (não mesclado). WIP_BIOMETRIA não toca `routes/arsenal.ts` nem `lib/shift-guard.ts`. Nenhuma migration; produção não acessada; hash R-35 `d63f4b5e…551b5b` intacto.

## Finding e BEFORE
`requireActiveShift(role, userId)` (`lib/shift-guard.ts`) só compara a reserva do turno ativo com a reserva alvo se `targetReserveId` for passado. Em `PATCH /items/:id/ocorrencia` ele não era: armeiro com turno ativo em A e sessão (reserva ativa) em B registrava ocorrência em item de B usando o turno de A (regra do produto: "movimentação só com o livro da reserva aberto"). **Reproduzido em handler real:** com o código antigo, 2 testes falham (turno de A + sessão em B → 200 em vez de 403 `SHIFT_WRONG_RESERVE`; e a variante com os dois armeiros).

## Correção (uma linha + testes)
`requireActiveShift(role, userId, c.get("reserveId") ?? null)`: o turno precisa ser da reserva ativa da sessão. Admin_reserva/admin_global não operam turno (o guard retorna `ok` antes do 3º argumento): sem mudança. Sessão sem reserva ativa: sem checagem turno-reserva, mas o escopo do R-48 nega com 404 antes de qualquer escrita (teste novo). A ordem (turno 403 antes do lookup) não vaza nada: depende só do turno e da sessão do próprio armeiro.

## AFTER e contraprova
`arsenal-ocorrencia-scope.test.ts` (23): turno de A + sessão em B → 403 `SHIFT_WRONG_RESERVE`, item intacto, zero INSERT/UPDATE/RPC; turno certo → 200; armeiro de B com turno em B → só B; sem reserva ativa → 404 sem efeito; admin_reserva em sessão B → 200 (não operam turno). **Mutação** (remover o 3º argumento): DETECTED (2 testes). Regressão: BFF unit 695/695, integração 323/323, web 366/366, `tsc`, `lint:logs`, `git diff --check` OK. E2E: BLOQUEADO_AMBIENTE.

## Review
Code + security: passou, sem CRÍTICO/ALTO/MÉDIO. BAIXOS tratados: teste do armeiro sem reserva ativa (adicionado) e comentário ajustado. Não vaza existência do item; `reserveId` vem da sessão (nunca do cliente).

## Residual (NÃO corrigido; mesmo padrão, cada um precisa decidir a reserva alvo)
`routes/ocorrencias.ts:306` (PATCH /:id), `routes/arsenal.ts:294` (POST solicitação), `routes/categories.ts:327` e `:382`: a reserva da sessão já está lida em cada handler (basta passá-la). `routes/cautelamentos.ts` linhas 596, 678, 771, 888, 950, 1151, 1258, 1372, 1467: **colidem com a WIP_BIOMETRIA**; já migradas: 451 e 1047. (`ssa.ts` já passa o alvo; a variável `reservaId` ali é o `userId`, nome enganoso, sem bug de lógica.)

## Status
**R-50: DONE_VERIFIED_REPO_PENDING_DEPLOY** para o handler de ocorrência; **residual OPEN** nos call sites acima.
