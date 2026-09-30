# Critérios de aceitação — R-37 lote 1

## 0. Integridade
`sha256sum` de `page.tsx` e `page.test.tsx` = `SHA256.txt`. Se não bater: INCONCLUSIVE.

## 1. Página (já existente)
`cd apps/web && npx vitest run "src/app/(dashboard)/reserva/ocorrencias/page.test.tsx"` → 9/9.
Contraprova: com `page.tsx` da `043d0af` (versão antiga) o mesmo teste deve
FALHAR (esperado: 8 falhas); restaurar a nova → 9/9.

## 2. Endpoint real `GET /api/ocorrencias` (escrever teste de integração)
Arquivo sugerido: `apps/bff/src/__tests__/integration/ocorrencias-scope-real-handler.test.ts`,
rodado com `bun test` e o env de CI do BFF (+ `AMBIENTE_INFRA=SUPABASE`).
Cenário mínimo: tenants A e B; reservas A1, A2 (tenant A) e B1; staff
`admin_reserva` com reserva ativa A1; militares de A e de B; ocorrências
abertas ligadas a lendings de A1, A2 e B1, uma ocorrência aberta reportada pelo
próprio staff (A1) e uma resolvida.

| Caso | Esperado |
|---|---|
| A. staff A1, sessão normal | só ocorrências abertas de A1 (inclui a do próprio staff), nenhuma de A2/B1, nenhuma resolvida |
| B. mesmo staff, sessão em Modo Usuário | só as ocorrências reportadas por ele mesmo |
| C. militar comum de A | só as próprias |
| D. staff de B | só as de B1 |
| E. reserva: staff A1 | nenhuma de A2 |
| F. cookie do militar A + Bearer do staff A1 | identidade/escopo só do militar (sem mistura) |
| G. staff sem tenant na sessão | 403 |
| H. Bearer do staff sem sessão | teto `usuario`: só as próprias |
| MULTI_SESSION: sessão X staff e sessão Y (Modo Usuário) do mesmo usuário | X vê A1; Y só as próprias; X continua vendo A1 depois de Y |

Contraprova do endpoint: mutar temporariamente o middleware para usar
`profiles.role` no lugar do papel efetivo (ou ignorar `activeMode`) → os
casos B/H/MULTI_SESSION devem falhar; reverter → PASS. Não commitar mutação.

Nota de ambiente: o `SupabaseAuthProvider` guarda o `fetch` global da
construção; em `bun test` com vários arquivos, o mock de `/auth/v1/user`
precisa existir antes do primeiro import do middleware (ver comentário em
`mode-user-auth-paths.test.ts`).

## 3. Regressão
BFF unit (`node --experimental-strip-types --test "src/__tests__/*.test.ts"`,
env CI), BFF integração (`bun test src/__tests__/integration`), web
`npx vitest run`, `tsc --noEmit` (BFF e web). Tudo verde.

## Resultado
PASS (tudo acima) · FAIL · INCONCLUSIVE.
