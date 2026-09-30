# R-37 lote 1 — pacote de verificação externa (/reserva/ocorrencias)

Branch `claude/r37-batch1-verification` (a partir de `043d0af`). **Não é para
merge.** Serve para outro ambiente validar o lote antes de ele entrar em
`claude/bold-planck-6xy9fc`.

## O que o lote muda
`apps/web/src/app/(dashboard)/reserva/ocorrencias/page.tsx` (SSR de staff):
- antes: lia `ocorrencias` direto do Supabase com o JWT do usuário e autorizava
  por `profiles.role` (ignora o Modo Usuário, D-02);
- agora: autoriza pelo papel EFETIVO da sessão do BFF (`resolveWebSessionRole`,
  fail-closed, confere identidade) e lê de `GET /api/ocorrencias` repassando o
  cookie da sessão (`bffSessionHeaders`). Nenhum acesso direto ao Supabase.

O endpoint `GET /api/ocorrencias` (`apps/bff/src/routes/ocorrencias.ts`) **não
foi alterado**: papel efetivo pelo `authMiddleware`, tenant pelo join do militar
(`!inner`), reserva derivada de `lending_id`/`material_type_id` via
`scopedReserveIds`/`isMatriz`; papel `usuario` → só as próprias ocorrências.

## Já verificado nesta origem
- `page.test.tsx` (vitest): 9/9 com a página nova; 8/9 FALHAM com a página
  antiga (prova do defeito: em Modo Usuário a página antiga renderiza dados
  lidos direto do Supabase).
- `tsc --noEmit` do web: OK.

## O que falta verificar (tarefa do validador)
Ver `ACCEPTANCE_CRITERIA.md`: testes automatizados do endpoint real
`GET /api/ocorrencias` (authMiddleware + rota reais, iron-session selada,
banco em memória `apps/bff/src/__tests__/helpers/fake-postgrest.ts`), no padrão
de `apps/bff/src/__tests__/integration/mode-user-auth-paths.test.ts` e
`dashboard-scope-real-handler.test.ts`.

## Restrições
Só ambiente local/descartável. Nada de produção, deploy, `db push`,
`--include-all`, `migration repair`. Não alterar código de produção: se algum
critério falhar, reportar FAIL com o motivo. Identidades e dados artificiais.
